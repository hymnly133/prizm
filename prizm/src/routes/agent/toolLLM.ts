/**
 * Tool LLM 路由 — 独立入口（工作流页面 + 内联卡片复用）
 *
 * POST /agent/tool-llm/start         — 启动新 Tool LLM 会话（SSE 流式）
 * POST /agent/tool-llm/:id/refine    — 追加修改指令（SSE 流式）
 * POST /agent/tool-llm/:id/confirm   — 确认注册工作流
 * POST /agent/tool-llm/:id/cancel    — 取消会话
 */

import type { Router, Request, Response } from 'express'
import type { LLMStreamChunk } from '../../adapters/interfaces'
import { toolLLMManager } from '../../llm/toolLLM'
import { toErrorResponse } from '../../errors'
import { ensureStringParam, hasScopeAccess } from '../../scopeUtils'
import { createLogger } from '../../logger'
import { getScopeFromQuery } from './_shared'

const log = createLogger('ToolLLM:Route')

function setupSSE(res: Response): { heartbeat: ReturnType<typeof setInterval>; writeChunk: (chunk: LLMStreamChunk) => void } {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const heartbeat = setInterval(() => {
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
    if (chunk.toolCall) {
      res.write(`data: ${JSON.stringify({ type: 'tool_call', value: chunk.toolCall })}\n\n`)
    }
    if (chunk.toolCallArgsDelta) {
      res.write(`data: ${JSON.stringify({ type: 'tool_call_args_delta', value: chunk.toolCallArgsDelta })}\n\n`)
    }
    res.flush?.()
  }

  return { heartbeat, writeChunk }
}

export function registerToolLLMRoutes(router: Router): void {

  // POST /agent/tool-llm/start
  router.post('/agent/tool-llm/start', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const { intent, workflowName, existingYaml, context } = req.body ?? {}
      if (typeof intent !== 'string' || !intent.trim()) {
        return res.status(400).json({ error: 'intent is required' })
      }

      const { heartbeat, writeChunk } = setupSSE(res)

      try {
        const result = await toolLLMManager.start(
          scope,
          {
            domain: 'workflow',
            intent: intent.trim(),
            workflowName: typeof workflowName === 'string' ? workflowName : undefined,
            existingYaml: typeof existingYaml === 'string' ? existingYaml : undefined,
            context: typeof context === 'string' ? context : undefined
          },
          writeChunk
        )

        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'tool_llm_result', value: result })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          res.flush?.()
        }
      } catch (err) {
        log.error('Tool LLM start error:', err)
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', value: String(err) })}\n\n`)
          res.flush?.()
        }
      } finally {
        clearInterval(heartbeat)
        if (!res.writableEnded) res.end()
      }
    } catch (error) {
      log.error('Tool LLM start request error:', error)
      const { status, body } = toErrorResponse(error)
      if (!res.headersSent) res.status(status).json(body)
    }
  })

  // POST /agent/tool-llm/:id/refine
  router.post('/agent/tool-llm/:id/refine', async (req: Request, res: Response) => {
    try {
      const sessionId = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const { message } = req.body ?? {}
      if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' })
      }

      const { heartbeat, writeChunk } = setupSSE(res)

      try {
        const result = await toolLLMManager.resume(scope, sessionId, message.trim(), writeChunk)

        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'tool_llm_result', value: result })}\n\n`)
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          res.flush?.()
        }
      } catch (err) {
        log.error('Tool LLM refine error:', err)
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', value: String(err) })}\n\n`)
          res.flush?.()
        }
      } finally {
        clearInterval(heartbeat)
        if (!res.writableEnded) res.end()
      }
    } catch (error) {
      log.error('Tool LLM refine request error:', error)
      const { status, body } = toErrorResponse(error)
      if (!res.headersSent) res.status(status).json(body)
    }
  })

  // POST /agent/tool-llm/:id/confirm
  router.post('/agent/tool-llm/:id/confirm', async (req: Request, res: Response) => {
    try {
      const sessionId = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const { workflowName } = req.body ?? {}

      const result = toolLLMManager.confirm(
        scope,
        sessionId,
        typeof workflowName === 'string' ? workflowName : undefined
      )

      res.json(result)
    } catch (error) {
      log.error('Tool LLM confirm error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/tool-llm/:id/cancel
  router.post('/agent/tool-llm/:id/cancel', async (req: Request, res: Response) => {
    try {
      const sessionId = ensureStringParam(req.params.id)
      toolLLMManager.cancel(sessionId)
      res.json({ ok: true })
    } catch (error) {
      log.error('Tool LLM cancel error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
