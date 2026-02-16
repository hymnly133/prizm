/**
 * Agent 路由 - 会话 CRUD、流式对话、停止生成
 */

import type { Router, Request, Response } from 'express'
import type { IAgentAdapter } from '../adapters/interfaces'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  ensureStringParam,
  getScopeForCreate,
  requireScopeForList,
  getScopeForReadById,
  hasScopeAccess
} from '../scopeUtils'
import { scopeStore, DEFAULT_SCOPE } from '../core/ScopeStore'
import { MEMORY_USER_ID } from '@prizm/shared'
import { buildScopeContextSummary } from '../llm/scopeContext'
import { buildSystemPrompt } from '../llm/systemPrompt'
import { scheduleTurnSummary } from '../llm/conversationSummaryService'
import { getAgentLLMSettings, getContextWindowSettings } from '../settings/agentToolsStore'
import { listRefItems } from '../llm/scopeItemRegistry'
import { listAtReferences } from '../llm/atReferenceRegistry'
import { registerBuiltinAtReferences } from '../llm/atReferenceRegistry'
import { getSessionContext } from '../llm/contextTracker'
import type { ScopeActivityRecord } from '../llm/scopeInteractionParser'
import { deriveScopeActivities, collectToolCallsFromMessages } from '../llm/scopeInteractionParser'
import { registerBuiltinSlashCommands, tryRunSlashCommand } from '../llm/slashCommands'
import { autoActivateSkills, getActiveSkills, loadAllSkillMetadata } from '../llm/skillManager'
import { loadRules, listDiscoveredRules } from '../llm/rulesLoader'
import { loadAllCustomCommands } from '../llm/customCommandLoader'
import { listSlashCommands } from '../llm/slashCommandRegistry'
import { getAllToolMetadata } from '../llm/toolMetadata'
import {
  isMemoryEnabled,
  listAllUserProfiles,
  searchUserAndScopeMemories,
  searchThreeLevelMemories,
  addMemoryInteraction,
  addSessionMemoryFromRounds
} from '../llm/EverMemService'
import { recordTokenUsage } from '../llm/tokenUsage'
import { getTerminalManager } from '../terminal/TerminalSessionManager'
import {
  appendSessionTokenUsage,
  appendSessionActivities,
  readSessionTokenUsage
} from '../core/mdStore'
import { genUniqueId } from '../id'
import type { TokenUsageRecord } from '../types'

const log = createLogger('Agent')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

/**
 * 将 memoryGrowth 写回已持久化的 assistant 消息。
 * appendMessage 在 addMemoryInteraction 之前调用，因此 memoryGrowth 需要事后补写。
 */
function persistMemoryGrowth(
  scope: string,
  sessionId: string,
  messageId: string,
  memoryGrowth: unknown
): void {
  try {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) return
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return
    ;(msg as unknown as Record<string, unknown>).memoryGrowth = memoryGrowth
    scopeStore.saveScope(scope)
  } catch (e) {
    log.warn('Failed to persist memoryGrowth:', messageId, e)
  }
}

/** 正在进行的 chat 流 AbortController 注册表，按 scope:sessionId 隔离 */
const activeChats = new Map<string, AbortController>()

function chatKey(scope: string, sessionId: string): string {
  return `${scope}:${sessionId}`
}

export function createAgentRoutes(router: Router, adapter?: IAgentAdapter): void {
  if (!adapter) {
    log.warn('Agent adapter not provided, routes will return 503')
  }

  // GET /agent/tools/metadata - 工具元数据（显示名、文档链接等），供客户端 ToolCallCard 使用
  router.get('/agent/tools/metadata', async (_req: Request, res: Response) => {
    try {
      const metadata = getAllToolMetadata()
      res.json({ tools: metadata })
    } catch (error) {
      log.error('get tool metadata error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/debug/scope-context - 调试用：获取当前 scope 的上下文摘要预览
  router.get('/agent/debug/scope-context', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const summary = buildScopeContextSummary(scope)
      res.json({ summary, scope })
    } catch (error) {
      log.error('get scope context error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/system-prompt - 获取发送消息前注入的完整系统提示词（含工作区上下文、能力说明、上下文状态、工作原则）
  router.get('/agent/system-prompt', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const sessionId =
        typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
          ? req.query.sessionId.trim()
          : undefined
      const systemPrompt = buildSystemPrompt({
        scope,
        sessionId,
        includeScopeContext: true
      })
      res.json({ systemPrompt, scope, sessionId: sessionId ?? null })
    } catch (error) {
      log.error('get system prompt error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/scope-items - 可引用项列表（用于 @ 自动补全）
  router.get('/agent/scope-items', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      registerBuiltinAtReferences()
      const refTypes = listAtReferences().map((d) => ({
        key: d.key,
        label: d.label,
        aliases: d.aliases ?? []
      }))
      const items = listRefItems(scope)
      res.json({ refTypes, items })
    } catch (error) {
      log.error('get scope-items error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/slash-commands - slash 命令列表（用于 / 下拉菜单）
  router.get('/agent/slash-commands', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      registerBuiltinSlashCommands()
      const commands = listSlashCommands().map((c) => ({
        name: c.name,
        aliases: c.aliases ?? [],
        description: c.description,
        builtin: c.builtin,
        mode: c.mode ?? 'action'
      }))
      res.json({ commands })
    } catch (error) {
      log.error('get slash-commands error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/capabilities - 聚合所有可用能力（工具 + 命令 + skills + rules）
  router.get('/agent/capabilities', async (_req: Request, res: Response) => {
    try {
      registerBuiltinSlashCommands()
      const slashCommands = listSlashCommands().map((c) => ({
        name: c.name,
        aliases: c.aliases ?? [],
        description: c.description,
        builtin: c.builtin,
        mode: c.mode ?? 'action'
      }))
      const customCommands = loadAllCustomCommands().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        mode: c.mode,
        source: c.source,
        enabled: c.enabled
      }))
      const skills = loadAllSkillMetadata().map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        source: s.source
      }))
      const rules = listDiscoveredRules()
      const metadata = getAllToolMetadata()
      res.json({
        builtinTools: metadata,
        slashCommands,
        customCommands,
        skills,
        rules
      })
    } catch (error) {
      log.error('get capabilities error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id/context - 会话上下文追踪状态（含 scope 交互）
  router.get('/agent/sessions/:id/context', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const state = getSessionContext(scope, id)
      let parsedActivities: ScopeActivityRecord[] = []
      if (adapter?.getSession) {
        const session = await adapter.getSession(scope, id)
        if (session?.messages?.length) {
          const collected = collectToolCallsFromMessages(session.messages)
          const all: ScopeActivityRecord[] = []
          for (const { tc, createdAt } of collected) {
            all.push(...deriveScopeActivities([tc], createdAt))
          }
          parsedActivities = all
        }
      }
      // 合并 contextTracker 中的 activities 与 parser 中的 parsedActivities，按 timestamp 排序去重
      const trackerActivities = state?.activities ?? []
      const mergedMap = new Map<string, ScopeActivityRecord>()
      for (const a of [...trackerActivities, ...parsedActivities]) {
        const key = `${a.toolName}:${a.action}:${a.itemKind ?? ''}:${a.itemId ?? ''}:${a.timestamp}`
        if (!mergedMap.has(key)) mergedMap.set(key, a)
      }
      const activities = [...mergedMap.values()].sort((a, b) => a.timestamp - b.timestamp)
      if (!state) {
        return res.json({
          sessionId: id,
          scope,
          provisions: [],
          totalProvidedChars: 0,
          activities
        })
      }
      res.json({
        sessionId: state.sessionId,
        scope: state.scope,
        provisions: state.provisions,
        totalProvidedChars: state.totalProvidedChars,
        activities
      })
    } catch (error) {
      log.error('get session context error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id/stats - 会话级统计（token 总用量 + 该会话创建的记忆）
  router.get('/agent/sessions/:id/stats', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      // 1. Token 使用：从 session 级 token-usage.md 聚合
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const tokenRecords = readSessionTokenUsage(scopeRoot, id)
      const tokenSummary = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        rounds: tokenRecords.length,
        byModel: {} as Record<
          string,
          { input: number; output: number; total: number; count: number }
        >,
        byScope: {} as Record<
          string,
          { input: number; output: number; total: number; count: number }
        >
      }
      for (const r of tokenRecords) {
        tokenSummary.totalInputTokens += r.inputTokens
        tokenSummary.totalOutputTokens += r.outputTokens
        tokenSummary.totalTokens += r.totalTokens
        const m = r.model || 'unknown'
        if (!tokenSummary.byModel[m]) {
          tokenSummary.byModel[m] = { input: 0, output: 0, total: 0, count: 0 }
        }
        tokenSummary.byModel[m].input += r.inputTokens
        tokenSummary.byModel[m].output += r.outputTokens
        tokenSummary.byModel[m].total += r.totalTokens
        tokenSummary.byModel[m].count += 1
        // 按功能分类聚合
        const s = r.usageScope || 'chat'
        if (!tokenSummary.byScope[s]) {
          tokenSummary.byScope[s] = { input: 0, output: 0, total: 0, count: 0 }
        }
        tokenSummary.byScope[s].input += r.inputTokens
        tokenSummary.byScope[s].output += r.outputTokens
        tokenSummary.byScope[s].total += r.totalTokens
        tokenSummary.byScope[s].count += 1
      }

      // 2. 记忆创建：从 messages 的 memoryGrowth 字段聚合
      let memorySummary = {
        totalCount: 0,
        byType: {} as Record<string, number>,
        memories: [] as Array<{
          id: string
          memory: string
          memory_type?: string
          messageId: string
        }>
      }
      if (adapter?.getSession) {
        const session = await adapter.getSession(scope, id)
        if (session?.messages) {
          for (const msg of session.messages) {
            const mg = msg.memoryGrowth
            if (mg && typeof mg === 'object' && mg.count > 0) {
              memorySummary.totalCount += mg.count
              for (const [type, cnt] of Object.entries(mg.byType)) {
                memorySummary.byType[type] = (memorySummary.byType[type] ?? 0) + cnt
              }
              if (Array.isArray(mg.memories)) {
                for (const mem of mg.memories) {
                  memorySummary.memories.push({
                    id: mem.id,
                    memory: mem.memory,
                    memory_type: mem.memory_type,
                    messageId: mg.messageId
                  })
                }
              }
            }
          }
        }
      }

      res.json({
        sessionId: id,
        scope,
        tokenUsage: tokenSummary,
        memoryCreated: memorySummary
      })
    } catch (error) {
      log.error('get session stats error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions - 列出 scope 下会话
  router.get('/agent/sessions', async (req: Request, res: Response) => {
    try {
      if (!adapter?.listSessions) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return

      const sessions = await adapter.listSessions(scope)
      res.json({ sessions })
    } catch (error) {
      log.error('list agent sessions error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions - 创建会话
  router.post('/agent/sessions', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const scope = getScopeForCreate(req)
      const session = await adapter.createSession(scope)
      res.status(201).json({ session })
    } catch (error) {
      log.error('create agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id - 获取会话及消息
  router.get('/agent/sessions/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const session = await adapter.getSession(scope, id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      res.json({ session })
    } catch (error) {
      log.error('get agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /agent/sessions/:id - 更新会话（摘要等）
  router.patch('/agent/sessions/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const { llmSummary } = req.body ?? {}
      const session = await adapter.updateSession(scope, id, { llmSummary })
      res.json({ session })
    } catch (error) {
      log.error('update agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /agent/sessions/:id - 删除会话
  router.delete('/agent/sessions/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      // 先 abort 正在进行的 chat stream
      const key = chatKey(scope, id)
      activeChats.get(key)?.abort()
      activeChats.delete(key)

      // 清理关联终端
      try {
        getTerminalManager().cleanupSession(id)
      } catch (termErr) {
        log.warn('terminal cleanup on session delete failed:', termErr)
      }
      await adapter.deleteSession(scope, id)
      res.status(204).send()
    } catch (error) {
      log.error('delete agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions/:id/chat - 发送消息，返回 SSE 流
  router.post('/agent/sessions/:id/chat', async (req: Request, res: Response) => {
    try {
      if (!adapter?.chat || !adapter?.appendMessage) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const session = await adapter.getSession?.(scope, id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const { content } = req.body ?? {}
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'content is required' })
      }

      const bodyModel = req.body?.model
      const agentSettings = getAgentLLMSettings()
      const model =
        typeof bodyModel === 'string' && bodyModel.trim()
          ? bodyModel.trim()
          : agentSettings.defaultModel?.trim() || undefined
      const {
        mcpEnabled,
        includeScopeContext,
        fullContextTurns: bodyA,
        cachedContextTurns: bodyB
      } = req.body ?? {}
      const ctxWin = getContextWindowSettings()
      // 记忆和 token 统一使用固定 userId，不按客户端隔离
      const memoryUserId = MEMORY_USER_ID

      // 追加用户消息
      await adapter.appendMessage(scope, id, {
        role: 'user',
        content: content.trim()
      })
      scheduleTurnSummary(scope, id, content.trim(), memoryUserId)

      // Slash 命令：若为首位 / 且命中注册命令，根据 mode 决定行为
      // - action 模式：直接返回结果，不调用 LLM
      // - prompt 模式：将命令内容注入为 system message，继续 LLM 对话
      let promptInjection: string | null = null
      if (content.trim().startsWith('/')) {
        const cmdResult = await tryRunSlashCommand(scope, id, content.trim())
        if (cmdResult != null) {
          if (cmdResult.mode === 'prompt') {
            // prompt 模式：保存注入内容，后续作为 system message 发送给 LLM
            promptInjection = cmdResult.text
          } else {
            // action 模式：直接返回结果
            await adapter.appendMessage(scope, id, {
              role: 'system',
              content: cmdResult.text
            })
            res.setHeader('Content-Type', 'text/event-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('Connection', 'keep-alive')
            res.setHeader('X-Accel-Buffering', 'no')
            res.flushHeaders?.()
            res.write(
              `data: ${JSON.stringify({ type: 'command_result', value: cmdResult.text })}\n\n`
            )
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
            res.flush?.()
            res.end()
            return
          }
        }
      }

      // A/B 滑动窗口：A=完全上下文轮数，B=缓存轮数；满 A+B 时将最老 B 轮压缩为 Session 记忆
      const fullContextTurns = Math.max(1, bodyA ?? ctxWin.fullContextTurns ?? 4)
      const cachedContextTurns = Math.max(1, bodyB ?? ctxWin.cachedContextTurns ?? 3)

      const chatMessages = session.messages.filter(
        (m) => m.role === 'user' || m.role === 'assistant'
      )
      const completeRounds = chatMessages.filter((m) => m.role === 'assistant').length
      let compressedThrough = session.compressedThroughRound ?? 0

      // 压缩：当未压缩区 (cache) 达到 A+B 轮时，将最老 B 轮压缩（每 B 轮一批）
      const uncompressedRounds = completeRounds - compressedThrough
      const shouldCompress = uncompressedRounds >= fullContextTurns + cachedContextTurns

      if (shouldCompress && adapter?.updateSession) {
        const toCompress = cachedContextTurns
        const startIdx = 2 * compressedThrough
        const endIdx = 2 * (compressedThrough + toCompress)
        const slice = chatMessages.slice(startIdx, endIdx)
        if (slice.length >= 2) {
          try {
            await addSessionMemoryFromRounds(
              slice.map((m) => ({ role: m.role, content: m.content })),
              memoryUserId,
              scope,
              id
            )
            compressedThrough = compressedThrough + toCompress
            await adapter.updateSession(scope, id, { compressedThroughRound: compressedThrough })
          } catch (e) {
            log.warn('Session memory compression failed:', e)
          }
        }
      }

      // 构建消息历史：未达 A+B 时全量；达到后为 [压缩块 Session 记忆] + [所有未压缩 raw（cache）] + [current user]
      const currentUserMsg = { role: 'user' as const, content: content.trim() }
      let history: Array<{ role: string; content: string }>

      if (completeRounds < fullContextTurns + cachedContextTurns) {
        history = [
          ...session.messages.map((m) => ({ role: m.role, content: m.content })),
          currentUserMsg
        ]
      } else {
        const systemMsgs = session.messages.filter((m) => m.role === 'system')
        const systemPrefix =
          systemMsgs.length > 0 ? systemMsgs.map((m) => ({ role: m.role, content: m.content })) : []
        const cacheRaw = chatMessages
          .slice(2 * compressedThrough)
          .map((m) => ({ role: m.role, content: m.content }))
        history = [...systemPrefix, ...cacheRaw, currentUserMsg]
      }

      // ---- prompt 模式命令注入 ----
      // 若当前消息是 prompt 模式的 slash 命令，将命令模板注入为 system message
      if (promptInjection) {
        history.push({ role: 'system', content: `[命令指令]\n${promptInjection}` })
      }

      // ---- 记忆注入策略 ----
      // 1) 用户画像（PROFILE）：每轮必定注入，直接列表（不依赖语义搜索），放在 system prompt 紧后
      // 2) 工作区/会话记忆：基于语义搜索按相关性注入
      const trimmedContent = content.trim()
      const isFirstMessage = session.messages.length === 0
      const memoryEnabled = isMemoryEnabled()

      let injectedMemoriesForClient: {
        user: import('@prizm/shared').MemoryItem[]
        scope: import('@prizm/shared').MemoryItem[]
        session: import('@prizm/shared').MemoryItem[]
      } | null = null

      const maxCharsPerMemory = 80
      const truncateMem = (s: string) =>
        s.length <= maxCharsPerMemory ? s : s.slice(0, maxCharsPerMemory) + '…'

      // --- Step 1: 每轮必注入用户画像（最高优先级，紧跟 system prompt） ---
      let profileMem: import('@prizm/shared').MemoryItem[] = []
      if (memoryEnabled) {
        try {
          profileMem = await listAllUserProfiles(memoryUserId)
          if (profileMem.length > 0) {
            const profilePrompt =
              '[用户画像 - 必须严格遵守]\n' +
              profileMem.map((m) => `- ${truncateMem(m.memory)}`).join('\n') +
              '\n\n请根据以上用户画像调整你的称呼和回复风格。'
            // 插入到 system prompt 之后（index 1），确保位于所有对话历史之前
            const profileInsertIdx = history.findIndex((m) => m.role !== 'system')
            const insertAt = profileInsertIdx === -1 ? history.length : profileInsertIdx
            history.splice(insertAt, 0, { role: 'system', content: profilePrompt })
            log.info('Injected user profile: %d items (always-on)', profileMem.length)
          }
        } catch (profileErr) {
          log.warn('User profile loading failed, proceeding without:', profileErr)
        }
      }

      // --- Step 2: 工作区/会话记忆（基于语义搜索，按相关性注入） ---
      const shouldInjectContextMemory =
        memoryEnabled &&
        (trimmedContent.length >= 4 || (isFirstMessage && trimmedContent.length >= 1))
      const memoryQuery = trimmedContent.length >= 4 ? trimmedContent : '用户偏好与工作区概况'

      if (shouldInjectContextMemory) {
        try {
          const two = await searchUserAndScopeMemories(memoryQuery, memoryUserId, scope)
          const scopeMem = two.scope
          let sessionMem: { memory: string }[] = []
          if (compressedThrough > 0) {
            const three = await searchThreeLevelMemories(memoryQuery, memoryUserId, scope, id)
            sessionMem = three.session
          }

          const sections: string[] = []
          if (scopeMem.length > 0) {
            sections.push(
              '[工作区记忆]\n' + scopeMem.map((m) => `- ${truncateMem(m.memory)}`).join('\n')
            )
          }
          if (sessionMem.length > 0) {
            sections.push(
              '[会话记忆]\n' + sessionMem.map((m) => `- ${truncateMem(m.memory)}`).join('\n')
            )
          }

          if (sections.length > 0 || profileMem.length > 0) {
            injectedMemoriesForClient = {
              user: profileMem,
              scope: scopeMem,
              session: sessionMem as import('@prizm/shared').MemoryItem[]
            }
            if (sections.length > 0) {
              const memoryPrompt = sections.join('\n\n')
              const insertIdx = history.findIndex((m, i) => i > 0 && m.role !== 'system')
              const insertAt = insertIdx === -1 ? history.length : insertIdx
              history.splice(insertAt, 0, { role: 'system', content: memoryPrompt })
            }
            log.info(
              'Injected memories: profile=%d, scope=%d, session=%d (compressedThrough=%d)',
              profileMem.length,
              scopeMem.length,
              sessionMem.length,
              compressedThrough
            )
          }
        } catch (memErr) {
          log.warn('Memory search failed, proceeding without:', memErr)
        }
      }

      // 确保 profile 已注入时也设置 client 通知（即使没有 scope/session 记忆）
      if (!injectedMemoriesForClient && profileMem.length > 0) {
        injectedMemoriesForClient = {
          user: profileMem,
          scope: [],
          session: []
        }
      }

      // ---- Skill 自动激活 + Rules 加载 ----
      autoActivateSkills(scope, id, trimmedContent)
      const activeSkills = getActiveSkills(scope, id)
      const activeSkillInstructions =
        activeSkills.length > 0
          ? activeSkills.map((a) => ({ name: a.skillName, instructions: a.instructions }))
          : undefined

      let rulesContent: string | undefined
      try {
        rulesContent = loadRules() || undefined
      } catch (rulesErr) {
        log.warn('Rules loading failed:', rulesErr)
      }

      // 创建 AbortController，注册到 activeChats
      const key = chatKey(scope, id)
      // 若已有进行中的生成，先 abort 旧的
      activeChats.get(key)?.abort()
      const ac = new AbortController()
      activeChats.set(key, ac)

      // SSE 流式响应：禁用代理缓冲，确保每块立即发送
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no') // nginx 等代理不缓冲
      res.flushHeaders?.()

      if (injectedMemoriesForClient) {
        res.write(
          `data: ${JSON.stringify({
            type: 'memory_injected',
            value: injectedMemoriesForClient
          })}\n\n`
        )
        res.flush?.()
      }

      // 客户端断开连接时也 abort
      res.on('close', () => {
        ac.abort()
        activeChats.delete(key)
      })

      let fullContent = ''
      let fullReasoning = ''
      let segmentContent = ''
      const parts: Array<
        | { type: 'text'; content: string }
        | {
            type: 'tool'
            id: string
            name: string
            arguments: string
            result: string
            isError?: boolean
            status?: 'preparing' | 'running' | 'done'
          }
      > = []
      const fullToolCalls: Array<{
        id: string
        name: string
        arguments: string
        result: string
        isError?: boolean
        status?: 'preparing' | 'running' | 'done'
      }> = []
      function flushSegment(): void {
        if (segmentContent) {
          parts.push({ type: 'text', content: segmentContent })
          segmentContent = ''
        }
      }
      let lastUsage:
        | {
            totalTokens?: number
            totalInputTokens?: number
            totalOutputTokens?: number
          }
        | undefined
      let usageSent = false
      let hasError = false
      let chatCompletedAt = 0
      try {
        for await (const chunk of adapter.chat(scope, id, history, {
          model,
          signal: ac.signal,
          mcpEnabled: mcpEnabled !== false,
          includeScopeContext: includeScopeContext !== false,
          activeSkillInstructions,
          rulesContent
        })) {
          if (ac.signal.aborted) break
          if (chunk.usage) lastUsage = chunk.usage
          if (chunk.text) {
            fullContent += chunk.text
            segmentContent += chunk.text
            res.write(
              `data: ${JSON.stringify({
                type: 'text',
                value: chunk.text
              })}\n\n`
            )
            res.flush?.()
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
            res.write(
              `data: ${JSON.stringify({
                type: 'reasoning',
                value: chunk.reasoning
              })}\n\n`
            )
            res.flush?.()
          }
          if (chunk.toolResultChunk) {
            flushSegment()
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_result_chunk',
                value: chunk.toolResultChunk
              })}\n\n`
            )
            res.flush?.()
          }
          if (chunk.toolCall) {
            flushSegment()
            const tc = chunk.toolCall
            const toolPart = {
              type: 'tool' as const,
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: tc.result,
              ...(tc.isError && { isError: true }),
              ...(tc.status && { status: tc.status })
            }
            const existingIdx = fullToolCalls.findIndex((t) => t.id === tc.id)
            if (existingIdx >= 0) {
              fullToolCalls[existingIdx] = tc
              const partIdx = parts.findIndex((p) => p.type === 'tool' && p.id === tc.id)
              if (partIdx >= 0) parts[partIdx] = toolPart
              else parts.push(toolPart)
            } else {
              fullToolCalls.push(tc)
              parts.push(toolPart)
            }
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_call',
                value: chunk.toolCall
              })}\n\n`
            )
            res.flush?.()
          }
          if (chunk.done) {
            flushSegment()
            chatCompletedAt = Date.now()
            const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
            const appendedMsg = await adapter.appendMessage(scope, id, {
              role: 'assistant',
              content: fullContent,
              model: usedModel,
              usage: lastUsage,
              ...(fullReasoning && { reasoning: fullReasoning }),
              ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
              ...(parts.length > 0 && { parts })
            })

            let memoryGrowth = null
            if (isMemoryEnabled() && fullContent) {
              try {
                memoryGrowth = await addMemoryInteraction(
                  [
                    { role: 'user', content: content.trim() },
                    { role: 'assistant', content: fullContent }
                  ],
                  memoryUserId,
                  scope,
                  id,
                  appendedMsg.id
                )
                if (memoryGrowth) {
                  persistMemoryGrowth(scope, id, appendedMsg.id, memoryGrowth)
                }
              } catch (e) {
                log.warn('Memory storage failed:', e)
              }
            }
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                model: usedModel,
                usage: lastUsage ?? undefined,
                messageId: appendedMsg.id,
                ...(memoryGrowth && { memoryGrowth })
              })}\n\n`
            )
            usageSent = true
            res.flush?.()
          }
        }

        // 被 abort 时：若已有部分内容，保存到 assistant 消息
        if (ac.signal.aborted && fullContent) {
          flushSegment()
          chatCompletedAt = Date.now()
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          const appendedMsg = await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning }),
            ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
            ...(parts.length > 0 && { parts })
          })
          let memoryGrowth = null
          if (isMemoryEnabled() && fullContent) {
            try {
              memoryGrowth = await addMemoryInteraction(
                [
                  { role: 'user', content: content.trim() },
                  { role: 'assistant', content: fullContent }
                ],
                memoryUserId,
                scope,
                id,
                appendedMsg.id
              )
              if (memoryGrowth) {
                persistMemoryGrowth(scope, id, appendedMsg.id, memoryGrowth)
              }
            } catch (e) {
              log.warn('Memory storage failed:', e)
            }
          }
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true,
              messageId: appendedMsg.id,
              ...(memoryGrowth && { memoryGrowth })
            })}\n\n`
          )
          usageSent = true
          res.flush?.()
        }
      } catch (err) {
        hasError = true
        const isAbort = err instanceof Error && err.name === 'AbortError'
        if (!isAbort) {
          log.error('agent chat stream error:', err)
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              value: String(err)
            })}\n\n`
          )
          res.flush?.()
          if (lastUsage) {
            res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
            usageSent = true
            res.flush?.()
          }
        } else if (fullContent) {
          flushSegment()
          chatCompletedAt = Date.now()
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          const appendedMsg = await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning }),
            ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
            ...(parts.length > 0 && { parts })
          })
          let memoryGrowth = null
          if (isMemoryEnabled() && fullContent) {
            try {
              memoryGrowth = await addMemoryInteraction(
                [
                  { role: 'user', content: content.trim() },
                  { role: 'assistant', content: fullContent }
                ],
                memoryUserId,
                scope,
                id,
                appendedMsg.id
              )
              if (memoryGrowth) {
                persistMemoryGrowth(scope, id, appendedMsg.id, memoryGrowth)
              }
            } catch (e) {
              log.warn('Memory storage failed:', e)
            }
          }
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true,
              messageId: appendedMsg.id,
              ...(memoryGrowth && { memoryGrowth })
            })}\n\n`
          )
          usageSent = true
          res.flush?.()
        } else if (lastUsage) {
          res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
          usageSent = true
          res.flush?.()
        }
      } finally {
        const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
        if (lastUsage) {
          recordTokenUsage(memoryUserId, 'chat', lastUsage, usedModel)
        }
        if (chatCompletedAt && lastUsage) {
          try {
            const scopeRoot = scopeStore.getScopeRootPath(scope)
            const record: TokenUsageRecord = {
              id: genUniqueId(),
              usageScope: 'chat',
              timestamp: chatCompletedAt,
              model: usedModel ?? '',
              inputTokens: lastUsage.totalInputTokens ?? 0,
              outputTokens: lastUsage.totalOutputTokens ?? 0,
              totalTokens:
                lastUsage.totalTokens ??
                (lastUsage.totalInputTokens ?? 0) + (lastUsage.totalOutputTokens ?? 0)
            }
            appendSessionTokenUsage(scopeRoot, id, record)
          } catch (e) {
            log.warn('Failed to write session token usage:', id, e)
          }
          if (fullToolCalls.length > 0) {
            try {
              const activities = deriveScopeActivities(fullToolCalls, chatCompletedAt)
              if (activities.length > 0) {
                const scopeRoot = scopeStore.getScopeRootPath(scope)
                appendSessionActivities(scopeRoot, id, activities)
              }
            } catch (e) {
              log.warn('Failed to write session activities:', id, e)
            }
          }
        }
        if (!usageSent && lastUsage) {
          res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
          res.flush?.()
        }
        activeChats.delete(key)
        res.end()
      }
    } catch (error) {
      log.error('agent chat error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions/:id/stop - 停止当前生成
  router.post('/agent/sessions/:id/stop', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const key = chatKey(scope, id)
      const ac = activeChats.get(key)
      if (ac) {
        ac.abort()
        activeChats.delete(key)
        log.info('Agent chat stopped:', id, 'scope:', scope)
        res.json({ stopped: true })
      } else {
        res.json({ stopped: false, message: 'No active generation' })
      }
    } catch (error) {
      log.error('agent stop error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
