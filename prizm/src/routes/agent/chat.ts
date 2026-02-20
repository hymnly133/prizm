/**
 * Agent 流式对话路由 - SSE chat + stop + observe
 *
 * 核心逻辑委托给 chatCore()，本文件仅负责：
 * - HTTP 请求验证
 * - SSE 传输层（chunk → event stream）
 * - 心跳和连接管理
 * - BG session 实时观察（observe endpoint）
 */

import type { Router, Request, Response } from 'express'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import { toErrorResponse } from '../../errors'
import { ensureStringParam, hasScopeAccess } from '../../scopeUtils'
import { interactManager } from '../../llm/interactManager'
import { observerRegistry } from '../../core/backgroundSession'
import type { ObserverCallbacks } from '../../core/backgroundSession'
import { log, getScopeFromQuery, activeChats, chatKey } from './_shared'
import { chatCore } from './chatCore'

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

      const fileRefPaths: string[] = Array.isArray(bodyFileRefs)
        ? bodyFileRefs
            .filter((r: unknown) => r && typeof (r as Record<string, unknown>).path === 'string')
            .map((r: { path: string }) => r.path)
        : []

      const bodyModel = req.body?.model
      const { mcpEnabled, includeScopeContext, fullContextTurns, cachedContextTurns, thinking } =
        req.body ?? {}

      const actor: import('@prizm/shared').OperationActor = {
        type: 'user',
        clientId: req.prizmClient?.clientId,
        source: 'api:chat'
      }

      // SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()

      res.on('close', () => {
        const key = chatKey(scope, id)
        activeChats.get(key)?.abort()
        activeChats.delete(key)
        interactManager.cancelSession(id, scope)
      })

      // SSE 心跳
      const HEARTBEAT_INTERVAL_MS = 3000
      const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: heartbeat\n\n`)
          res.flush?.()
        }
      }, HEARTBEAT_INTERVAL_MS)

      let usageSent = false
      let lastUsage:
        | { totalTokens?: number; totalInputTokens?: number; totalOutputTokens?: number; cachedInputTokens?: number }
        | undefined

      try {
        const result = await chatCore(
          adapter,
          {
            scope,
            sessionId: id,
            content: content.trim(),
            model: typeof bodyModel === 'string' && bodyModel.trim() ? bodyModel.trim() : undefined,
            fileRefPaths,
            mcpEnabled: mcpEnabled !== false,
            includeScopeContext: includeScopeContext !== false,
            fullContextTurns: typeof fullContextTurns === 'number' ? fullContextTurns : undefined,
            cachedContextTurns:
              typeof cachedContextTurns === 'number' ? cachedContextTurns : undefined,
            actor,
            thinking: thinking === true ? true : undefined
          },
          (chunk) => {
            if (res.writableEnded) return
            if (chunk.usage) lastUsage = chunk.usage
            if (chunk.text) {
              res.write(`data: ${JSON.stringify({ type: 'text', value: chunk.text })}\n\n`)
              res.flush?.()
            }
            if (chunk.reasoning) {
              res.write(
                `data: ${JSON.stringify({ type: 'reasoning', value: chunk.reasoning })}\n\n`
              )
              res.flush?.()
            }
            if (chunk.toolCallArgsDelta) {
              res.write(
                `data: ${JSON.stringify({
                  type: 'tool_call_args_delta',
                  value: chunk.toolCallArgsDelta
                })}\n\n`
              )
              res.flush?.()
            }
            if (chunk.toolResultChunk) {
              res.write(
                `data: ${JSON.stringify({
                  type: 'tool_result_chunk',
                  value: chunk.toolResultChunk
                })}\n\n`
              )
              res.flush?.()
            }
            if (chunk.toolCall) {
              res.write(`data: ${JSON.stringify({ type: 'tool_call', value: chunk.toolCall })}\n\n`)
              res.flush?.()
            }
            if (chunk.interactRequest) {
              res.write(
                `data: ${JSON.stringify({
                  type: 'interact_request',
                  value: chunk.interactRequest
                })}\n\n`
              )
              res.flush?.()
            }
          },
          (readyInfo) => {
            if (res.writableEnded) return
            if (readyInfo.injectedMemories) {
              res.write(
                `data: ${JSON.stringify({
                  type: 'memory_injected',
                  value: readyInfo.injectedMemories
                })}\n\n`
              )
              res.flush?.()
            }
          }
        )

        // Slash 命令拦截结果
        if (result.commandResult) {
          if (!res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({ type: 'command_result', value: result.commandResult })}\n\n`
            )
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
            res.flush?.()
          }
        } else {
          if (!res.writableEnded) {
            const hasRefs =
              result.memoryRefs.injected.user.length +
                result.memoryRefs.injected.scope.length +
                result.memoryRefs.injected.session.length +
                result.memoryRefs.created.user.length +
                result.memoryRefs.created.scope.length +
                result.memoryRefs.created.session.length >
              0
            res.write(
              `data: ${JSON.stringify({
                type: 'done',
                model: result.appendedMsg.model,
                usage: result.usage ?? undefined,
                messageId: result.appendedMsg.id,
                ...(result.stopped && { stopped: true }),
                ...(hasRefs && { memoryRefs: result.memoryRefs })
              })}\n\n`
            )
            usageSent = true
            res.flush?.()
          }
        }
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError'
        if (!isAbort) {
          log.error('agent chat stream error:', err)
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', value: String(err) })}\n\n`)
            res.flush?.()
            if (lastUsage) {
              res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
              usageSent = true
              res.flush?.()
            }
          }
        } else if (lastUsage && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
          usageSent = true
          res.flush?.()
        }
      } finally {
        clearInterval(heartbeatTimer)
        if (!res.writableEnded) {
          if (!usageSent && lastUsage) {
            res.write(`data: ${JSON.stringify({ type: 'usage', value: lastUsage })}\n\n`)
            res.flush?.()
          }
          res.end()
        }
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

  // GET /agent/sessions/:id/observe - 观察运行中 BG session 的流式输出
  router.get('/agent/sessions/:id/observe', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const session = await adapter?.getSession?.(scope, id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }
      if (session.kind !== 'background') {
        return res.status(400).json({ error: 'Only background sessions can be observed' })
      }

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()

      const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: heartbeat\n\n`)
          res.flush?.()
        }
      }, 3000)

      const writeChunk = (chunk: LLMStreamChunk) => {
        if (res.writableEnded) return
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ type: 'text', value: chunk.text })}\n\n`)
        }
        if (chunk.reasoning) {
          res.write(`data: ${JSON.stringify({ type: 'reasoning', value: chunk.reasoning })}\n\n`)
        }
        if (chunk.toolCallArgsDelta) {
          res.write(`data: ${JSON.stringify({ type: 'tool_call_args_delta', value: chunk.toolCallArgsDelta })}\n\n`)
        }
        if (chunk.toolResultChunk) {
          res.write(`data: ${JSON.stringify({ type: 'tool_result_chunk', value: chunk.toolResultChunk })}\n\n`)
        }
        if (chunk.toolCall) {
          res.write(`data: ${JSON.stringify({ type: 'tool_call', value: chunk.toolCall })}\n\n`)
        }
        if (chunk.interactRequest) {
          res.write(`data: ${JSON.stringify({ type: 'interact_request', value: chunk.interactRequest })}\n\n`)
        }
        res.flush?.()
      }

      const callbacks: ObserverCallbacks = {
        onChunk: writeChunk,
        onDone: (info) => {
          if (res.writableEnded) return
          res.write(`data: ${JSON.stringify({ type: 'done', bgStatus: info.bgStatus })}\n\n`)
          res.flush?.()
          clearInterval(heartbeatTimer)
          res.end()
        }
      }

      const registered = observerRegistry.register(id, callbacks)

      if (!registered) {
        clearInterval(heartbeatTimer)
        if (!res.writableEnded) {
          const terminalStatus = session.bgStatus
          res.write(`data: ${JSON.stringify({ type: 'done', bgStatus: terminalStatus ?? 'unknown' })}\n\n`)
          res.flush?.()
          res.end()
        }
        return
      }

      res.on('close', () => {
        observerRegistry.unregister(id, callbacks)
        clearInterval(heartbeatTimer)
      })
    } catch (error) {
      log.error('agent observe error:', error)
      const { status, body } = toErrorResponse(error)
      if (!res.headersSent) {
        res.status(status).json(body)
      }
    }
  })
}
