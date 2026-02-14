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
import { DEFAULT_SCOPE } from '../core/ScopeStore'
import { buildScopeContextSummary } from '../llm/scopeContext'
import { buildSystemPrompt } from '../llm/systemPrompt'
import { scheduleConversationSummary } from '../llm/conversationSummaryService'
import { getAgentLLMSettings } from '../settings/agentToolsStore'
import { listRefItems } from '../llm/scopeItemRegistry'
import { listAtReferences } from '../llm/atReferenceRegistry'
import { registerBuiltinAtReferences } from '../llm/atReferenceRegistry'
import { getSessionContext } from '../llm/contextTracker'
import type { ScopeInteraction } from '../llm/scopeInteractionParser'
import {
  deriveScopeInteractions,
  collectToolCallsFromMessages
} from '../llm/scopeInteractionParser'
import { registerBuiltinSlashCommands, tryRunSlashCommand } from '../llm/slashCommands'
import { listSlashCommands } from '../llm/slashCommandRegistry'
import { getAllToolMetadata } from '../llm/toolMetadata'

const log = createLogger('Agent')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
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
        description: c.description
      }))
      res.json({ commands })
    } catch (error) {
      log.error('get slash-commands error:', error)
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
      let scopeInteractions: ScopeInteraction[] = []
      if (adapter?.getSession) {
        const session = await adapter.getSession(scope, id)
        if (session?.messages?.length) {
          const collected = collectToolCallsFromMessages(session.messages)
          const all: ScopeInteraction[] = []
          for (const { tc, createdAt } of collected) {
            all.push(...deriveScopeInteractions([tc], createdAt))
          }
          scopeInteractions = all
        }
      }
      if (!state) {
        return res.json({
          sessionId: id,
          scope,
          provisions: [],
          totalProvidedChars: 0,
          modifications: [],
          scopeInteractions
        })
      }
      res.json({
        sessionId: state.sessionId,
        scope: state.scope,
        provisions: state.provisions,
        totalProvidedChars: state.totalProvidedChars,
        modifications: state.modifications,
        scopeInteractions
      })
    } catch (error) {
      log.error('get session context error:', error)
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

  // PATCH /agent/sessions/:id - 更新会话（标题等）
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

      const { title } = req.body ?? {}
      const session = await adapter.updateSession(scope, id, { title })
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
      const { mcpEnabled, includeScopeContext } = req.body ?? {}

      // 追加用户消息
      await adapter.appendMessage(scope, id, {
        role: 'user',
        content: content.trim()
      })

      // Slash 命令：若为首位 / 且命中注册命令，执行后直接返回结果，不调用 LLM
      if (content.trim().startsWith('/')) {
        const cmdResult = await tryRunSlashCommand(scope, id, content.trim())
        if (cmdResult != null) {
          await adapter.appendMessage(scope, id, {
            role: 'system',
            content: cmdResult
          })
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.setHeader('X-Accel-Buffering', 'no')
          res.flushHeaders?.()
          res.write(`data: ${JSON.stringify({ type: 'command_result', value: cmdResult })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          res.flush?.()
          res.end()
          return
        }
      }

      // 构建消息历史
      const history = [
        ...session.messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        { role: 'user' as const, content: content.trim() }
      ]

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
      let hasError = false
      try {
        for await (const chunk of adapter.chat(scope, id, history, {
          model,
          signal: ac.signal,
          mcpEnabled: mcpEnabled !== false,
          includeScopeContext: includeScopeContext !== false
        })) {
          if (ac.signal.aborted) break
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
            if (chunk.usage) lastUsage = chunk.usage
            const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
            await adapter.appendMessage(scope, id, {
              role: 'assistant',
              content: fullContent,
              model: usedModel,
              usage: lastUsage,
              ...(fullReasoning && { reasoning: fullReasoning }),
              ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
              ...(parts.length > 0 && { parts })
            })
            scheduleConversationSummary(scope, id)
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                model: usedModel,
                usage: lastUsage ?? undefined
              })}\n\n`
            )
            res.flush?.()
          }
        }

        // 被 abort 时：若已有部分内容，保存到 assistant 消息
        if (ac.signal.aborted && fullContent) {
          flushSegment()
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning }),
            ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
            ...(parts.length > 0 && { parts })
          })
          scheduleConversationSummary(scope, id)
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true
            })}\n\n`
          )
          res.flush?.()
        }
      } catch (err) {
        hasError = true
        // AbortError 是正常停止，不算错误
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
        } else if (fullContent) {
          flushSegment()
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning }),
            ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
            ...(parts.length > 0 && { parts })
          })
          scheduleConversationSummary(scope, id)
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true
            })}\n\n`
          )
          res.flush?.()
        }
      } finally {
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
