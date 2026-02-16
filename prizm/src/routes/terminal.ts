/**
 * Terminal 路由 — Agent Session 下的终端子资源 CRUD + 交互
 */

import type { Router, Request, Response } from 'express'
import type { TerminalSessionManager } from '../terminal/TerminalSessionManager'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { ensureStringParam, hasScopeAccess } from '../scopeUtils'
import { DEFAULT_SCOPE, scopeStore } from '../core/ScopeStore'

const log = createLogger('TerminalRoute')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

export function createTerminalRoutes(
  router: Router,
  terminalManager: TerminalSessionManager
): void {
  /**
   * POST /agent/sessions/:id/terminals
   * 创建终端
   */
  router.post('/agent/sessions/:id/terminals', async (req: Request, res: Response) => {
    try {
      const agentSessionId = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)

      if (!hasScopeAccess(req, scope)) {
        res.status(403).json({ error: '无权访问此 scope' })
        return
      }

      // 验证 agent session 存在
      const sessionData = scopeStore.getScopeData(scope)
      const agentSession = sessionData.agentSessions.find((s) => s.id === agentSessionId)
      if (!agentSession) {
        res.status(404).json({ error: `Agent session not found: ${agentSessionId}` })
        return
      }

      const { shell, cwd, cols, rows, title } = req.body ?? {}

      // 解析 cwd — 相对 scope root 或使用 scope root
      let resolvedCwd: string | undefined
      if (cwd) {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const path = await import('path')
        resolvedCwd = path.default.resolve(scopeRoot, cwd)
      } else {
        resolvedCwd = scopeStore.getScopeRootPath(scope)
      }

      const terminal = terminalManager.createTerminal({
        agentSessionId,
        scope,
        shell,
        cwd: resolvedCwd,
        cols: cols ? Number(cols) : undefined,
        rows: rows ? Number(rows) : undefined,
        title
      })

      res.status(201).json({ terminal })
    } catch (err) {
      const resp = toErrorResponse(err)
      res.status(resp.status).json(resp.body)
    }
  })

  /**
   * GET /agent/sessions/:id/terminals
   * 列出 Session 下所有终端 + exec worker 状态
   */
  router.get('/agent/sessions/:id/terminals', async (req: Request, res: Response) => {
    try {
      const agentSessionId = ensureStringParam(req.params.id)
      const terminals = terminalManager.listTerminals(agentSessionId)
      const execWorkers = terminalManager.getExecWorkerInfos(agentSessionId)
      res.json({ terminals, execWorkers })
    } catch (err) {
      const resp = toErrorResponse(err)
      res.status(resp.status).json(resp.body)
    }
  })

  /**
   * GET /agent/sessions/:id/exec-history
   * 获取 Session 的一次性命令执行历史
   */
  router.get('/agent/sessions/:id/exec-history', async (req: Request, res: Response) => {
    try {
      const agentSessionId = ensureStringParam(req.params.id)
      const limit = req.query.limit ? Number(req.query.limit) : 50
      const records = terminalManager.getExecHistory(agentSessionId, limit)
      const execWorkers = terminalManager.getExecWorkerInfos(agentSessionId)
      res.json({ records, execWorkers })
    } catch (err) {
      const resp = toErrorResponse(err)
      res.status(resp.status).json(resp.body)
    }
  })

  /**
   * GET /agent/sessions/:id/terminals/:termId
   * 获取终端详情 + 最近输出
   */
  router.get('/agent/sessions/:id/terminals/:termId', async (req: Request, res: Response) => {
    try {
      const termId = ensureStringParam(req.params.termId)
      const terminal = terminalManager.getTerminal(termId)
      if (!terminal) {
        res.status(404).json({ error: `Terminal not found: ${termId}` })
        return
      }

      const maxBytes = req.query.maxBytes ? Number(req.query.maxBytes) : 8192
      const clean = req.query.clean !== 'false'
      const recentOutput = terminalManager.getRecentOutput(termId, maxBytes, clean)

      res.json({ terminal, recentOutput })
    } catch (err) {
      const resp = toErrorResponse(err)
      res.status(resp.status).json(resp.body)
    }
  })

  /**
   * POST /agent/sessions/:id/terminals/:termId/resize
   * 调整终端尺寸
   */
  router.post(
    '/agent/sessions/:id/terminals/:termId/resize',
    async (req: Request, res: Response) => {
      try {
        const termId = ensureStringParam(req.params.termId)
        const { cols, rows } = req.body ?? {}
        if (!cols || !rows) {
          res.status(400).json({ error: '缺少 cols 或 rows 参数' })
          return
        }
        terminalManager.resizeTerminal(termId, Number(cols), Number(rows))
        res.json({ ok: true })
      } catch (err) {
        const resp = toErrorResponse(err)
        res.status(resp.status).json(resp.body)
      }
    }
  )

  /**
   * POST /agent/sessions/:id/terminals/:termId/write
   * 写入输入（供无 WebSocket 场景 / 测试用）
   */
  router.post(
    '/agent/sessions/:id/terminals/:termId/write',
    async (req: Request, res: Response) => {
      try {
        const termId = ensureStringParam(req.params.termId)
        const { data } = req.body ?? {}
        if (typeof data !== 'string') {
          res.status(400).json({ error: '缺少 data 参数' })
          return
        }
        terminalManager.writeToTerminal(termId, data)
        res.json({ ok: true })
      } catch (err) {
        const resp = toErrorResponse(err)
        res.status(resp.status).json(resp.body)
      }
    }
  )

  /**
   * DELETE /agent/sessions/:id/terminals/:termId
   * 杀死终端
   */
  router.delete('/agent/sessions/:id/terminals/:termId', async (req: Request, res: Response) => {
    try {
      const termId = ensureStringParam(req.params.termId)
      const terminal = terminalManager.getTerminal(termId)
      if (!terminal) {
        res.status(404).json({ error: `Terminal not found: ${termId}` })
        return
      }
      terminalManager.killTerminal(termId)
      res.json({ ok: true })
    } catch (err) {
      const resp = toErrorResponse(err)
      res.status(resp.status).json(resp.body)
    }
  })
}
