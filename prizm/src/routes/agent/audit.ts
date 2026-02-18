/**
 * Agent 审计与锁状态查询路由
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../../errors'
import { hasScopeAccess, getScopeFromQuery as _getScopeFromQuery } from '../../scopeUtils'
import { auditManager } from '../../core/agentAuditLog'
import type { AuditQueryFilter } from '../../core/agentAuditLog'
import { lockManager } from '../../core/resourceLockManager'
import type { LockableResourceType } from '../../core/resourceLockManager'
import { emit } from '../../core/eventBus'
import { createLogger } from '../../logger'

const log = createLogger('AuditRoutes')

function getScopeFromQuery(req: Request): string {
  const fromScopeUtils = _getScopeFromQuery(req)
  if (fromScopeUtils) return fromScopeUtils
  const fromHeader = req.headers['x-prizm-scope']
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim()
  return 'default'
}

export function registerAuditRoutes(router: Router): void {
  // GET /agent/audit - 查询审计日志
  router.get('/agent/audit', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const filter: AuditQueryFilter = { scope }
      if (typeof req.query.sessionId === 'string') {
        const sid = req.query.sessionId.slice(0, 128)
        if (sid) filter.sessionId = sid
      }
      if (typeof req.query.resourceType === 'string')
        filter.resourceType = req.query.resourceType as AuditQueryFilter['resourceType']
      if (typeof req.query.resourceId === 'string')
        filter.resourceId = req.query.resourceId.slice(0, 128)
      if (typeof req.query.action === 'string')
        filter.action = req.query.action as AuditQueryFilter['action']
      if (typeof req.query.result === 'string')
        filter.result = req.query.result as AuditQueryFilter['result']
      if (typeof req.query.since === 'string') {
        const sinceNum = Number(req.query.since)
        if (!isNaN(sinceNum) && sinceNum >= 0) filter.since = sinceNum
      }
      if (typeof req.query.until === 'string') {
        const untilNum = Number(req.query.until)
        if (!isNaN(untilNum) && untilNum >= 0) filter.until = untilNum
      }
      if (typeof req.query.limit === 'string')
        filter.limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500))
      if (typeof req.query.offset === 'string')
        filter.offset = Math.max(0, Math.min(Number(req.query.offset) || 0, 100000))

      const entries = auditManager.query(filter)
      res.json({ entries, total: entries.length })
    } catch (error) {
      log.error('query audit log error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/audit/resource/:resourceType/:resourceId - 查询资源操作历史
  router.get(
    '/agent/audit/resource/:resourceType/:resourceId',
    async (req: Request, res: Response) => {
      try {
        const scope = getScopeFromQuery(req)
        if (!hasScopeAccess(req, scope)) {
          return res.status(403).json({ error: 'scope access denied' })
        }
        const resourceType = String(req.params.resourceType)
        const resourceId = String(req.params.resourceId)
        const limit =
          typeof req.query.limit === 'string' ? Math.min(Number(req.query.limit) || 50, 200) : 50
        const entries = auditManager.getResourceHistory(scope, resourceType, resourceId, limit)
        res.json({ entries })
      } catch (error) {
        log.error('query resource history error:', error)
        const { status, body } = toErrorResponse(error)
        res.status(status).json(body)
      }
    }
  )

  // GET /agent/locks - 查询当前活跃锁
  router.get('/agent/locks', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const locks = lockManager.listScopeLocks(scope)
      res.json({ data: locks })
    } catch (error) {
      log.error('list locks error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id/locks - 查询会话持有的锁
  router.get('/agent/sessions/:id/locks', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const sessionId = String(req.params.id)
      const locks = lockManager.listSessionLocks(scope, sessionId)
      res.json({ data: locks })
    } catch (error) {
      log.error('list session locks error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/locks/:resourceType/:resourceId/force-release - 强制释放锁
  router.post(
    '/agent/locks/:resourceType/:resourceId/force-release',
    async (req: Request, res: Response) => {
      try {
        const scope = getScopeFromQuery(req)
        if (!hasScopeAccess(req, scope)) {
          return res.status(403).json({ error: 'scope access denied' })
        }
        const resourceType = String(req.params.resourceType)
        const resourceId = String(req.params.resourceId)
        if (resourceType !== 'document' && resourceType !== 'todo_list') {
          return res.status(400).json({ error: `Invalid resource type: ${resourceType}` })
        }
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason : 'User forced release'

        const released = lockManager.forceReleaseLock(
          scope,
          resourceType as LockableResourceType,
          resourceId
        )

        if (!released) {
          return res.status(404).json({ error: 'No active lock found for this resource' })
        }

        // 通过 EventBus 记录审计
        emit('tool:executed', {
          scope,
          sessionId: released.sessionId,
          toolName: 'api:force_release',
          auditInput: {
            toolName: 'api:force_release',
            action: 'force_release',
            resourceType: resourceType as 'document' | 'todo_list',
            resourceId,
            detail: `Forced release by user. reason="${reason}"`,
            result: 'success'
          },
          actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:force_release' }
        }).catch(() => {})

        // 通过 EventBus 广播锁释放事件（由 wsBridgeHandler 转发到 WebSocket）
        emit('resource:lock.changed', {
          action: 'unlocked',
          scope,
          resourceType: resourceType as 'document' | 'todo_list',
          resourceId,
          sessionId: released.sessionId,
          reason
        }).catch(() => {})

        res.json({
          released: true,
          previousHolder: {
            sessionId: released.sessionId,
            acquiredAt: released.acquiredAt,
            reason: released.reason
          }
        })
      } catch (error) {
        log.error('force-release lock error:', error)
        const { status, body } = toErrorResponse(error)
        res.status(status).json(body)
      }
    }
  )

  // GET /agent/resource-status/:resourceType/:resourceId - 查询资源状态
  router.get(
    '/agent/resource-status/:resourceType/:resourceId',
    async (req: Request, res: Response) => {
      try {
        const scope = getScopeFromQuery(req)
        if (!hasScopeAccess(req, scope)) {
          return res.status(403).json({ error: 'scope access denied' })
        }
        const resourceType = String(req.params.resourceType)
        const resourceId = String(req.params.resourceId)
        if (resourceType !== 'document' && resourceType !== 'todo_list') {
          return res.status(400).json({ error: `Invalid resource type: ${resourceType}` })
        }
        const status = lockManager.getResourceStatus(
          scope,
          resourceType as LockableResourceType,
          resourceId
        )
        res.json({ data: status })
      } catch (error) {
        log.error('resource status error:', error)
        const { status, body } = toErrorResponse(error)
        res.status(status).json(body)
      }
    }
  )
}
