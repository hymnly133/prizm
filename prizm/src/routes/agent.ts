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

      const { model, mcpEnabled } = req.body ?? {}

      // 追加用户消息
      await adapter.appendMessage(scope, id, {
        role: 'user',
        content: content.trim()
      })

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

      // SSE 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      // 客户端断开连接时也 abort
      res.on('close', () => {
        ac.abort()
        activeChats.delete(key)
      })

      let fullContent = ''
      let fullReasoning = ''
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
          mcpEnabled: mcpEnabled !== false
        })) {
          if (ac.signal.aborted) break
          if (chunk.text) {
            fullContent += chunk.text
            res.write(
              `data: ${JSON.stringify({
                type: 'text',
                value: chunk.text
              })}\n\n`
            )
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
            res.write(
              `data: ${JSON.stringify({
                type: 'reasoning',
                value: chunk.reasoning
              })}\n\n`
            )
          }
          if (chunk.done) {
            if (chunk.usage) lastUsage = chunk.usage
            const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
            await adapter.appendMessage(scope, id, {
              role: 'assistant',
              content: fullContent,
              model: usedModel,
              usage: lastUsage,
              ...(fullReasoning && { reasoning: fullReasoning })
            })
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                model: usedModel,
                usage: lastUsage ?? undefined
              })}\n\n`
            )
          }
        }

        // 被 abort 时：若已有部分内容，保存到 assistant 消息
        if (ac.signal.aborted && fullContent) {
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning })
          })
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true
            })}\n\n`
          )
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
        } else if (fullContent) {
          const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
          await adapter.appendMessage(scope, id, {
            role: 'assistant',
            content: fullContent,
            model: usedModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning })
          })
          res.write(
            `data: ${JSON.stringify({
              type: 'done',
              model: usedModel,
              usage: lastUsage ?? undefined,
              stopped: true
            })}\n\n`
          )
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
