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
import { MEMORY_USER_ID, getTextContent } from '@prizm/shared'
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
  addSessionMemoryFromRounds,
  flushSessionBuffer,
  updateMemoryRefStats
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
import { interactManager } from '../llm/interactManager'

const log = createLogger('Agent')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

/**
 * 将 memoryRefs 写回已持久化的 assistant 消息。
 * appendMessage 在记忆处理之前调用，因此 memoryRefs 需要事后补写。
 */
function persistMemoryRefs(
  scope: string,
  sessionId: string,
  messageId: string,
  memoryRefs: import('@prizm/shared').MemoryRefs
): void {
  try {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) return
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return
    ;(msg as unknown as Record<string, unknown>).memoryRefs = memoryRefs
    scopeStore.saveScope(scope)
  } catch (e) {
    log.warn('Failed to persist memoryRefs:', messageId, e)
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
      const summary = await buildScopeContextSummary(scope)
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
      const systemPrompt = await buildSystemPrompt({
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

      // 2. 记忆引用：从 messages 的 memoryRefs 字段聚合 created ID
      const memoryCreatedIds: { user: string[]; scope: string[]; session: string[] } = {
        user: [],
        scope: [],
        session: []
      }
      let memoryInjectedTotal = 0
      if (adapter?.getSession) {
        const session = await adapter.getSession(scope, id)
        if (session?.messages) {
          for (const msg of session.messages) {
            const refs = msg.memoryRefs
            if (refs && typeof refs === 'object') {
              if (refs.created) {
                memoryCreatedIds.user.push(...(refs.created.user ?? []))
                memoryCreatedIds.scope.push(...(refs.created.scope ?? []))
                memoryCreatedIds.session.push(...(refs.created.session ?? []))
              }
              if (refs.injected) {
                memoryInjectedTotal +=
                  (refs.injected.user?.length ?? 0) +
                  (refs.injected.scope?.length ?? 0) +
                  (refs.injected.session?.length ?? 0)
              }
            }
          }
        }
      }

      res.json({
        sessionId: id,
        scope,
        tokenUsage: tokenSummary,
        memoryCreated: {
          totalCount:
            memoryCreatedIds.user.length +
            memoryCreatedIds.scope.length +
            memoryCreatedIds.session.length,
          ids: memoryCreatedIds
        },
        memoryInjectedTotal
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

  // POST /agent/sessions/:id/grant-paths - 授权外部文件路径
  router.post('/agent/sessions/:id/grant-paths', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateSession || !adapter?.getSession) {
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

      const { paths } = req.body ?? {}
      if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'paths array is required' })
      }

      const validPaths = paths.filter((p: unknown) => typeof p === 'string' && p.trim())
      if (validPaths.length === 0) {
        return res.status(400).json({ error: 'paths must contain valid path strings' })
      }

      const existing = new Set(session.grantedPaths ?? [])
      for (const p of validPaths) {
        existing.add(p)
      }

      const updated = await adapter.updateSession(scope, id, {
        grantedPaths: Array.from(existing)
      })
      res.json({ session: updated, grantedPaths: updated.grantedPaths })
    } catch (error) {
      log.error('grant-paths error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions/:id/interact-response - 工具交互响应（approve/deny）
  router.post('/agent/sessions/:id/interact-response', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateSession || !adapter?.getSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const { requestId, approved, paths } = req.body ?? {}
      if (typeof requestId !== 'string' || !requestId.trim()) {
        return res.status(400).json({ error: 'requestId is required' })
      }
      if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'approved (boolean) is required' })
      }

      // 验证请求存在且属于当前会话
      const request = interactManager.getRequest(requestId)
      if (!request) {
        return res.status(404).json({ error: 'Interact request not found or already resolved' })
      }
      if (request.sessionId !== id || request.scope !== scope) {
        return res.status(403).json({ error: 'Interact request does not belong to this session' })
      }

      const grantedPaths = Array.isArray(paths)
        ? paths.filter((p: unknown) => typeof p === 'string' && p.trim())
        : request.paths

      // 如果批准，持久化新授权路径到 session
      if (approved && grantedPaths.length > 0) {
        const session = await adapter.getSession(scope, id)
        if (session) {
          const existing = new Set(session.grantedPaths ?? [])
          for (const p of grantedPaths) existing.add(p)
          await adapter.updateSession(scope, id, { grantedPaths: Array.from(existing) })
          log.info('[Interact] Persisted %d granted paths for session %s', existing.size, id)
        }
      }

      // 解除 adapter 中的阻塞
      const resolved = interactManager.resolveRequest(requestId, approved, grantedPaths)
      if (!resolved) {
        return res.status(410).json({ error: 'Interact request expired or already resolved' })
      }

      res.json({
        requestId,
        approved,
        grantedPaths: approved ? grantedPaths : []
      })
    } catch (error) {
      log.error('interact-response error:', error)
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

      // 取消待处理的交互请求
      interactManager.cancelSession(id, scope)

      // flush 记忆缓冲区（确保会话删除前，累积的消息被抽取为记忆）
      if (isMemoryEnabled()) {
        try {
          await flushSessionBuffer(MEMORY_USER_ID, scope, id)
        } catch (memErr) {
          log.warn('memory buffer flush on session delete failed:', memErr)
        }
      }

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

      const { content, fileRefs: bodyFileRefs } = req.body ?? {}
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'content is required' })
      }

      // 处理文件路径引用：自动将 fileRefs 中的路径加入 session.grantedPaths
      const fileRefPaths: string[] = Array.isArray(bodyFileRefs)
        ? bodyFileRefs
            .filter((r: unknown) => r && typeof (r as Record<string, unknown>).path === 'string')
            .map((r: { path: string }) => r.path)
        : []
      if (fileRefPaths.length > 0) {
        const existing = new Set(session.grantedPaths ?? [])
        let changed = false
        for (const p of fileRefPaths) {
          if (!existing.has(p)) {
            existing.add(p)
            changed = true
          }
        }
        if (changed && adapter.updateSession) {
          session.grantedPaths = Array.from(existing)
          await adapter.updateSession(scope, id, { grantedPaths: session.grantedPaths })
        }
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
        parts: [{ type: 'text', content: content.trim() }]
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
              parts: [{ type: 'text', content: cmdResult.text }]
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
              slice.map((m) => ({ role: m.role, content: getTextContent(m) })),
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
          ...session.messages.map((m) => ({ role: m.role, content: getTextContent(m) })),
          currentUserMsg
        ]
      } else {
        const systemMsgs = session.messages.filter((m) => m.role === 'system')
        const systemPrefix =
          systemMsgs.length > 0 ? systemMsgs.map((m) => ({ role: m.role, content: getTextContent(m) })) : []
        const cacheRaw = chatMessages
          .slice(2 * compressedThrough)
          .map((m) => ({ role: m.role, content: getTextContent(m) }))
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
      /** 按层分类的注入记忆 ID（用于 memoryRefs.injected） */
      let injectedIds: import('@prizm/shared').MemoryIdsByLayer = {
        user: [],
        scope: [],
        session: []
      }

      // 优化1: 截断阈值 80→200；Profile 记忆是精炼原子事实，不截断
      const MAX_CHARS_CONTEXT = 200
      const truncateMem = (s: string, max = MAX_CHARS_CONTEXT) =>
        s.length <= max ? s : s.slice(0, max) + '…'

      // --- Step 1: 每轮必注入用户画像（最高优先级，紧跟 system prompt） ---
      let profileMem: import('@prizm/shared').MemoryItem[] = []
      if (memoryEnabled) {
        try {
          profileMem = await listAllUserProfiles(memoryUserId)
          if (profileMem.length > 0) {
            const profilePrompt =
              '【用户画像- 必须严格遵守】\n' +
              profileMem.map((m) => `- ${m.memory}`).join('\n') +
              '\n\n请根据以上用户画像调整你的称呼、回复风格、行为风格。'
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
      // 与 EverMemOS 推荐对齐：情景记忆和前瞻记忆分开注入，情景带编号和时间戳
      const shouldInjectContextMemory =
        memoryEnabled &&
        (trimmedContent.length >= 4 || (isFirstMessage && trimmedContent.length >= 1))
      const memoryQuery = trimmedContent.length >= 4 ? trimmedContent : '用户偏好与工作区概况'

      if (shouldInjectContextMemory) {
        try {
          const two = await searchUserAndScopeMemories(memoryQuery, memoryUserId, scope)
          const scopeMem = two.scope
          let sessionMem: import('@prizm/shared').MemoryItem[] = []
          if (compressedThrough > 0) {
            const three = await searchThreeLevelMemories(memoryQuery, memoryUserId, scope, id)
            sessionMem = three.session
          }

          // 优化2: 按 memory_type 分区 scope 记忆，避免混杂
          const foresightMem = scopeMem.filter((m) => m.memory_type === 'foresight')
          const docMem = scopeMem.filter(
            (m) => m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
          )
          const episodicMem = scopeMem.filter(
            (m) => !m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
          )

          const sections: string[] = []

          // 优化3: 情景记忆 — 带编号和时间戳，便于 LLM 引用和推理时间关系
          if (episodicMem.length > 0) {
            const lines = episodicMem.map((m, i) => {
              const date = m.created_at ? m.created_at.slice(0, 10) : ''
              const dateTag = date ? ` (${date})` : ''
              return `  [${i + 1}]${dateTag} ${truncateMem(m.memory)}`
            })
            sections.push('【相关记忆】\n' + lines.join('\n'))
          }

          // 前瞻/意图 — 独立 section，bullet list
          if (foresightMem.length > 0) {
            sections.push(
              '【前瞻/意图】\n' + foresightMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
            )
          }

          // 文档记忆
          if (docMem.length > 0) {
            sections.push(
              '【文档记忆】\n' + docMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
            )
          }

          // 会话记忆
          if (sessionMem.length > 0) {
            sections.push(
              '【会话记忆】\n' + sessionMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
            )
          }

          if (sections.length > 0 || profileMem.length > 0) {
            injectedMemoriesForClient = {
              user: profileMem,
              scope: scopeMem,
              session: sessionMem
            }
            if (sections.length > 0) {
              const memoryPrompt = sections.join('\n\n')
              const insertIdx = history.findIndex((m, i) => i > 0 && m.role !== 'system')
              const insertAt = insertIdx === -1 ? history.length : insertIdx
              history.splice(insertAt, 0, { role: 'system', content: memoryPrompt })
            }
            log.info(
              'Injected memories: profile=%d, episodic=%d, foresight=%d, doc=%d, session=%d',
              profileMem.length,
              episodicMem.length,
              foresightMem.length,
              docMem.length,
              sessionMem.length
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

      // 收集注入记忆 ID（用于 memoryRefs.injected）
      if (injectedMemoriesForClient) {
        injectedIds = {
          user: injectedMemoriesForClient.user.map((m) => m.id),
          scope: injectedMemoriesForClient.scope.map((m) => m.id),
          session: injectedMemoriesForClient.session.map((m) => m.id)
        }
        // fire-and-forget: 更新记忆侧引用索引
        updateMemoryRefStats(injectedIds, scope).catch((e) =>
          log.warn('ref stats update failed:', e)
        )
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

      // 客户端断开连接时也 abort，并取消所有待处理的审批请求
      res.on('close', () => {
        ac.abort()
        activeChats.delete(key)
        interactManager.cancelSession(id, scope)
      })

      let fullReasoning = ''
      let segmentContent = ''
      const parts: import('@prizm/shared').MessagePart[] = []
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

      // SSE 心跳：当 LLM 长时间生成工具参数（不产出可见事件）时，
      // 每 3 秒发送 SSE 注释行让客户端知道 AI 仍在工作
      const HEARTBEAT_INTERVAL_MS = 3000
      const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: heartbeat\n\n`)
          res.flush?.()
        }
      }, HEARTBEAT_INTERVAL_MS)

      try {
        for await (const chunk of adapter.chat(scope, id, history, {
          model,
          signal: ac.signal,
          mcpEnabled: mcpEnabled !== false,
          includeScopeContext: includeScopeContext !== false,
          activeSkillInstructions,
          rulesContent,
          grantedPaths: session.grantedPaths
        })) {
          if (ac.signal.aborted) break
          if (chunk.usage) lastUsage = chunk.usage
          if (chunk.text) {
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
            log.info('[SSE] tool_call status=%s id=%s name=%s', tc.status ?? 'done', tc.id, tc.name)
            const toolPart: import('@prizm/shared').MessagePartTool = {
              type: 'tool',
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: tc.result,
              ...(tc.isError && { isError: true }),
              ...(tc.status && { status: tc.status })
            }
            const existingIdx = parts.findIndex((p) => p.type === 'tool' && p.id === tc.id)
            if (existingIdx >= 0) {
              parts[existingIdx] = toolPart
            } else {
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
          // 交互请求：工具需要用户确认，SSE 流将在此处暂停直到用户响应
          if (chunk.interactRequest) {
            log.info(
              '[SSE] interact_request requestId=%s tool=%s paths=%s',
              chunk.interactRequest.requestId,
              chunk.interactRequest.toolName,
              chunk.interactRequest.paths.join(', ')
            )
            res.write(
              `data: ${JSON.stringify({
                type: 'interact_request',
                value: chunk.interactRequest
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
              parts: [...parts],
              model: usedModel,
              usage: lastUsage,
              ...(fullReasoning && { reasoning: fullReasoning })
            })

            const fullContent = getTextContent({ parts })
            let createdByLayer: import('@prizm/shared').MemoryIdsByLayer | null = null
            if (isMemoryEnabled() && fullContent) {
              try {
                createdByLayer = await addMemoryInteraction(
                  [
                    { role: 'user', content: content.trim() },
                    { role: 'assistant', content: fullContent }
                  ],
                  memoryUserId,
                  scope,
                  id,
                  appendedMsg.id
                )
              } catch (e) {
                log.warn('Memory storage failed:', e)
              }
            }
            const memoryRefs: import('@prizm/shared').MemoryRefs = {
              injected: injectedIds,
              created: createdByLayer ?? { user: [], scope: [], session: [] }
            }
            const hasRefs =
              memoryRefs.injected.user.length +
                memoryRefs.injected.scope.length +
                memoryRefs.injected.session.length +
                memoryRefs.created.user.length +
                memoryRefs.created.scope.length +
                memoryRefs.created.session.length >
              0
            if (hasRefs) {
              persistMemoryRefs(scope, id, appendedMsg.id, memoryRefs)
            }
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                model: usedModel,
                usage: lastUsage ?? undefined,
                messageId: appendedMsg.id,
                ...(hasRefs && { memoryRefs })
              })}\n\n`
            )
            usageSent = true
            res.flush?.()
          }
        }

        // 被 abort 时：若已有部分内容，保存到 assistant 消息
        if (ac.signal.aborted && (segmentContent || parts.length > 0)) {
          flushSegment()
          chatCompletedAt = Date.now()
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          const appendedMsg = await adapter.appendMessage(scope, id, {
            role: 'assistant',
            parts: [...parts],
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning })
          })
          const abortFullContent = getTextContent({ parts })
          let abortCreatedByLayer: import('@prizm/shared').MemoryIdsByLayer | null = null
          if (isMemoryEnabled() && abortFullContent) {
            try {
              abortCreatedByLayer = await addMemoryInteraction(
                [
                  { role: 'user', content: content.trim() },
                  { role: 'assistant', content: abortFullContent }
                ],
                memoryUserId,
                scope,
                id,
                appendedMsg.id
              )
            } catch (e) {
              log.warn('Memory storage failed:', e)
            }
          }
          const abortRefs: import('@prizm/shared').MemoryRefs = {
            injected: injectedIds,
            created: abortCreatedByLayer ?? { user: [], scope: [], session: [] }
          }
          const hasAbortRefs =
            abortRefs.injected.user.length +
              abortRefs.injected.scope.length +
              abortRefs.injected.session.length +
              abortRefs.created.user.length +
              abortRefs.created.scope.length +
              abortRefs.created.session.length >
            0
          if (hasAbortRefs) {
            persistMemoryRefs(scope, id, appendedMsg.id, abortRefs)
          }
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true,
              messageId: appendedMsg.id,
              ...(hasAbortRefs && { memoryRefs: abortRefs })
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
          let errCreatedByLayer: import('@prizm/shared').MemoryIdsByLayer | null = null
          if (isMemoryEnabled() && fullContent) {
            try {
              errCreatedByLayer = await addMemoryInteraction(
                [
                  { role: 'user', content: content.trim() },
                  { role: 'assistant', content: fullContent }
                ],
                memoryUserId,
                scope,
                id,
                appendedMsg.id
              )
            } catch (e) {
              log.warn('Memory storage failed:', e)
            }
          }
          const errRefs: import('@prizm/shared').MemoryRefs = {
            injected: injectedIds,
            created: errCreatedByLayer ?? { user: [], scope: [], session: [] }
          }
          const hasErrRefs =
            errRefs.injected.user.length +
              errRefs.injected.scope.length +
              errRefs.injected.session.length +
              errRefs.created.user.length +
              errRefs.created.scope.length +
              errRefs.created.session.length >
            0
          if (hasErrRefs) {
            persistMemoryRefs(scope, id, appendedMsg.id, errRefs)
          }
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true,
              messageId: appendedMsg.id,
              ...(hasErrRefs && { memoryRefs: errRefs })
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
        clearInterval(heartbeatTimer)
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
