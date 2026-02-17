/**
 * Agent 流式对话路由 - SSE chat + stop
 */

import type { Router, Request, Response } from 'express'
import type { IAgentAdapter } from '../../adapters/interfaces'
import { toErrorResponse } from '../../errors'
import { ensureStringParam, hasScopeAccess } from '../../scopeUtils'
import { scopeStore } from '../../core/ScopeStore'
import { getTextContent } from '@prizm/shared'
import { scheduleTurnSummary } from '../../llm/conversationSummaryService'
import { getAgentLLMSettings, getContextWindowSettings } from '../../settings/agentToolsStore'
import { registerBuiltinSlashCommands, tryRunSlashCommand } from '../../llm/slashCommands'
import { autoActivateSkills, getActiveSkills } from '../../llm/skillManager'
import { loadRules } from '../../llm/rulesLoader'
import {
  isMemoryEnabled,
  listAllUserProfiles,
  searchUserAndScopeMemories,
  searchThreeLevelMemories,
  addMemoryInteraction,
  addSessionMemoryFromRounds,
  updateMemoryRefStats
} from '../../llm/EverMemService'
import { recordTokenUsage } from '../../llm/tokenUsage'
import { deriveScopeActivities } from '../../llm/scopeInteractionParser'
import { appendSessionActivities } from '../../core/mdStore'
import { interactManager } from '../../llm/interactManager'
import { log, getScopeFromQuery, persistMemoryRefs, activeChats, chatKey } from './_shared'

export function registerChatRoutes(router: Router, adapter?: IAgentAdapter): void {
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

      // 处理文件路径引用
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

      // 追加用户消息
      await adapter.appendMessage(scope, id, {
        role: 'user',
        parts: [{ type: 'text', content: content.trim() }]
      })
      scheduleTurnSummary(scope, id, content.trim())

      // Slash 命令处理
      let promptInjection: string | null = null
      if (content.trim().startsWith('/')) {
        const cmdResult = await tryRunSlashCommand(scope, id, content.trim())
        if (cmdResult != null) {
          if (cmdResult.mode === 'prompt') {
            promptInjection = cmdResult.text
          } else {
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

      // A/B 滑动窗口
      const fullContextTurns = Math.max(1, bodyA ?? ctxWin.fullContextTurns ?? 4)
      const cachedContextTurns = Math.max(1, bodyB ?? ctxWin.cachedContextTurns ?? 3)

      const chatMessages = session.messages.filter(
        (m) => m.role === 'user' || m.role === 'assistant'
      )
      const completeRounds = chatMessages.filter((m) => m.role === 'assistant').length
      let compressedThrough = session.compressedThroughRound ?? 0

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

      // 构建消息历史
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
          systemMsgs.length > 0
            ? systemMsgs.map((m) => ({ role: m.role, content: getTextContent(m) }))
            : []
        const cacheRaw = chatMessages
          .slice(2 * compressedThrough)
          .map((m) => ({ role: m.role, content: getTextContent(m) }))
        history = [...systemPrefix, ...cacheRaw, currentUserMsg]
      }

      // prompt 模式命令注入
      if (promptInjection) {
        history.push({ role: 'system', content: `[命令指令]\n${promptInjection}` })
      }

      // ---- 记忆注入策略 ----
      const trimmedContent = content.trim()
      const isFirstMessage = session.messages.length === 0
      const memoryEnabled = isMemoryEnabled()

      let injectedMemoriesForClient: {
        user: import('@prizm/shared').MemoryItem[]
        scope: import('@prizm/shared').MemoryItem[]
        session: import('@prizm/shared').MemoryItem[]
      } | null = null
      let injectedIds: import('@prizm/shared').MemoryIdsByLayer = {
        user: [],
        scope: [],
        session: []
      }

      const MAX_CHARS_CONTEXT = 200
      const truncateMem = (s: string, max = MAX_CHARS_CONTEXT) =>
        s.length <= max ? s : s.slice(0, max) + '…'

      // Step 1: 用户画像
      let profileMem: import('@prizm/shared').MemoryItem[] = []
      if (memoryEnabled) {
        try {
          profileMem = await listAllUserProfiles()
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

      // Step 2: 工作区/会话记忆
      const shouldInjectContextMemory =
        memoryEnabled &&
        (trimmedContent.length >= 4 || (isFirstMessage && trimmedContent.length >= 1))
      const memoryQuery = trimmedContent.length >= 4 ? trimmedContent : '用户偏好与工作区概况'

      if (shouldInjectContextMemory) {
        try {
          const two = await searchUserAndScopeMemories(memoryQuery, scope)
          const scopeMem = two.scope
          let sessionMem: import('@prizm/shared').MemoryItem[] = []
          if (compressedThrough > 0) {
            const three = await searchThreeLevelMemories(memoryQuery, scope, id)
            sessionMem = three.session
          }

          const foresightMem = scopeMem.filter((m) => m.memory_type === 'foresight')
          const docMem = scopeMem.filter(
            (m) => m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
          )
          const episodicMem = scopeMem.filter(
            (m) => !m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
          )

          const sections: string[] = []

          if (episodicMem.length > 0) {
            const lines = episodicMem.map((m, i) => {
              const date = m.created_at ? m.created_at.slice(0, 10) : ''
              const dateTag = date ? ` (${date})` : ''
              return `  [${i + 1}]${dateTag} ${truncateMem(m.memory)}`
            })
            sections.push('【相关记忆】\n' + lines.join('\n'))
          }

          if (foresightMem.length > 0) {
            sections.push(
              '【前瞻/意图】\n' + foresightMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
            )
          }

          if (docMem.length > 0) {
            sections.push(
              '【文档记忆】\n' + docMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
            )
          }

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

      if (!injectedMemoriesForClient && profileMem.length > 0) {
        injectedMemoriesForClient = {
          user: profileMem,
          scope: [],
          session: []
        }
      }

      if (injectedMemoriesForClient) {
        injectedIds = {
          user: injectedMemoriesForClient.user.map((m) => m.id),
          scope: injectedMemoriesForClient.scope.map((m) => m.id),
          session: injectedMemoriesForClient.session.map((m) => m.id)
        }
        updateMemoryRefStats(injectedIds, scope).catch((e) =>
          log.warn('ref stats update failed:', e)
        )
      }

      // Skill 自动激活 + Rules 加载
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

      // AbortController
      const key = chatKey(scope, id)
      activeChats.get(key)?.abort()
      const ac = new AbortController()
      activeChats.set(key, ac)

      // SSE 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
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
      let doneFired = false

      async function persistAndFinalize(stopped: boolean): Promise<void> {
        flushSegment()
        chatCompletedAt = Date.now()
        const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
        const appendedMsg = await adapter!.appendMessage!(scope, id, {
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
              scope,
              id,
              appendedMsg.id
            )
          } catch (e) {
            log.warn('Memory storage failed:', e)
          }
        }
        const memRefs: import('@prizm/shared').MemoryRefs = {
          injected: injectedIds,
          created: createdByLayer ?? { user: [], scope: [], session: [] }
        }
        const hasRefs =
          memRefs.injected.user.length +
            memRefs.injected.scope.length +
            memRefs.injected.session.length +
            memRefs.created.user.length +
            memRefs.created.scope.length +
            memRefs.created.session.length >
          0
        if (hasRefs) {
          persistMemoryRefs(scope, id, appendedMsg.id, memRefs)
        }
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              messageId: appendedMsg.id,
              ...(stopped && { stopped: true }),
              ...(hasRefs && { memoryRefs: memRefs })
            })}\n\n`
          )
          usageSent = true
          res.flush?.()
        }
      }

      // SSE 心跳
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
            doneFired = true
            await persistAndFinalize(false)
          }
        }

        if (ac.signal.aborted && !doneFired && (segmentContent || parts.length > 0)) {
          await persistAndFinalize(true)
        }
      } catch (err) {
        hasError = true
        const isAbort = err instanceof Error && err.name === 'AbortError'
        if (!isAbort) {
          log.error('agent chat stream error:', err)
          if (!res.writableEnded) {
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
          }
        } else if (!doneFired && (segmentContent || parts.length > 0)) {
          await persistAndFinalize(true)
        } else if (lastUsage && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
          usageSent = true
          res.flush?.()
        }
      } finally {
        clearInterval(heartbeatTimer)
        const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
        if (lastUsage) {
          recordTokenUsage('chat', scope, lastUsage, usedModel, id)
        }
        if (chatCompletedAt && lastUsage) {
          const toolCallParts = parts.filter(
            (p): p is import('@prizm/shared').MessagePartTool => p.type === 'tool'
          )
          if (toolCallParts.length > 0) {
            try {
              const activities = deriveScopeActivities(toolCallParts, chatCompletedAt)
              if (activities.length > 0) {
                const scopeRoot = scopeStore.getScopeRootPath(scope)
                appendSessionActivities(scopeRoot, id, activities)
              }
            } catch (e) {
              log.warn('Failed to write session activities:', id, e)
            }
          }
        }
        if (!res.writableEnded) {
          if (!usageSent && lastUsage) {
            res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
            res.flush?.()
          }
          res.end()
        }
        activeChats.delete(key)
      }
    } catch (error) {
      log.error('agent chat error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions/:id/stop
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
