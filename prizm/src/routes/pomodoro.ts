/**
 * Pomodoro 番茄钟路由
 */

import type { Router, Request, Response } from 'express'
import type { IPomodoroAdapter } from '../adapters/interfaces'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  getScopeForCreate,
  requireScopeForList,
  getScopeForReadById,
  getScopeFromBody,
  hasScopeAccess,
  findAcrossScopes
} from '../scopeUtils'

const log = createLogger('Pomodoro')

export function createPomodoroRoutes(router: Router, adapter?: IPomodoroAdapter): void {
  if (!adapter) {
    log.warn('Pomodoro adapter not provided, routes will return 503')
  }

  // POST /pomodoro/start - 开始一个番茄钟，scope 可选 body.scope，默认 default
  router.post('/pomodoro/start', async (req: Request, res: Response) => {
    try {
      if (!adapter?.startSession) {
        return res.status(503).json({ error: 'Pomodoro adapter not available' })
      }

      const { taskId, tag } = req.body ?? {}
      const scope = getScopeForCreate(req)
      const session = await adapter.startSession(scope, { taskId, tag })

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(EVENT_TYPES.POMODORO_STARTED, { id: session.id, scope }, scope)
      }

      res.status(201).json({ session })
    } catch (error) {
      log.error('start session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /pomodoro/stop - 停止一个番茄钟，scope 可选 body.scope，未提供则跨 scope 查找
  router.post('/pomodoro/stop', async (req: Request, res: Response) => {
    try {
      if (!adapter?.stopSession) {
        return res.status(503).json({ error: 'Pomodoro adapter not available' })
      }

      const { id } = req.body ?? {}
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id is required' })
      }

      const fromBody = getScopeFromBody(req)
      const scopeHint =
        getScopeForReadById(req) ?? (fromBody && hasScopeAccess(req, fromBody) ? fromBody : null)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, async (s) => {
          const sessions = await adapter!.getSessions!(s, {})
          return sessions.find((x) => x.id === id) ?? null
        })
        if (!found) {
          return res.status(404).json({ error: 'Session not found' })
        }
        scope = found.scope
      }
      const session = await adapter.stopSession(scope, id)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(EVENT_TYPES.POMODORO_STOPPED, { id: session.id, scope }, scope)
      }

      res.json({ session })
    } catch (error) {
      log.error('stop session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /pomodoro/sessions - 查询番茄钟记录，scope 必填 ?scope=xxx
  router.get('/pomodoro/sessions', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getSessions) {
        return res.status(503).json({ error: 'Pomodoro adapter not available' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const { taskId, from, to } = req.query

      const filters: { taskId?: string; from?: number; to?: number } = {}
      if (typeof taskId === 'string') {
        filters.taskId = taskId
      }
      if (typeof from === 'string') {
        const num = Number(from)
        if (!Number.isNaN(num)) filters.from = num
      }
      if (typeof to === 'string') {
        const num = Number(to)
        if (!Number.isNaN(num)) filters.to = num
      }

      const sessions = await adapter.getSessions(scope, filters)
      res.json({ sessions })
    } catch (error) {
      log.error('get sessions error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
