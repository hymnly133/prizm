/**
 * Agent 会话路由 - CRUD、上下文追踪、统计、交互响应、路径授权
 */

import type { Router, Request, Response } from 'express'
import type { IAgentAdapter } from '../../adapters/interfaces'
import { toErrorResponse } from '../../errors'
import {
  ensureStringParam,
  getScopeForCreate,
  requireScopeForList,
  hasScopeAccess
} from '../../scopeUtils'
import { getTextContent } from '@prizm/shared'
import type { TokenUsageCategory } from '../../types'
import { getSessionContext } from '../../llm/contextTracker'
import type { ScopeActivityRecord } from '../../llm/scopeInteractionParser'
import {
  deriveScopeActivities,
  collectToolCallsFromMessages
} from '../../llm/scopeInteractionParser'
import { isMemoryEnabled, flushSessionBuffer } from '../../llm/EverMemService'
import { queryTokenUsage } from '../../core/tokenUsageDb'
import { getTerminalManager } from '../../terminal/TerminalSessionManager'
import { interactManager } from '../../llm/interactManager'
import { emit } from '../../core/eventBus'
import { log, getScopeFromQuery, activeChats, chatKey } from './_shared'

export function registerSessionRoutes(router: Router, adapter?: IAgentAdapter): void {
  // GET /agent/sessions/:id/context
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

  // GET /agent/sessions/:id/stats
  router.get('/agent/sessions/:id/stats', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const tokenRecords = queryTokenUsage({ sessionId: id })
      const tokenSummary = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        rounds: tokenRecords.length,
        byModel: {} as Record<
          string,
          { input: number; output: number; total: number; count: number }
        >,
        byCategory: {} as Partial<
          Record<
            TokenUsageCategory,
            { input: number; output: number; total: number; count: number }
          >
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
        const cat = (r.category || 'chat') as TokenUsageCategory
        if (!tokenSummary.byCategory[cat]) {
          tokenSummary.byCategory[cat] = { input: 0, output: 0, total: 0, count: 0 }
        }
        const catBucket = tokenSummary.byCategory[cat]!
        catBucket.input += r.inputTokens
        catBucket.output += r.outputTokens
        catBucket.total += r.totalTokens
        catBucket.count += 1
      }

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

  // GET /agent/sessions
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

  // POST /agent/sessions
  router.post('/agent/sessions', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const session = await adapter.createSession(scope)

      emit('agent:session.created', { scope, sessionId: session.id }).catch(() => {})

      res.status(201).json({ session })
    } catch (error) {
      log.error('create agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id
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

  // PATCH /agent/sessions/:id
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

  // POST /agent/sessions/:id/grant-paths
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

  // POST /agent/sessions/:id/interact-response
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
      if (approved && grantedPaths.length > 0) {
        const session = await adapter.getSession(scope, id)
        if (session) {
          const existing = new Set(session.grantedPaths ?? [])
          for (const p of grantedPaths) existing.add(p)
          await adapter.updateSession(scope, id, { grantedPaths: Array.from(existing) })
          log.info('[Interact] Persisted %d granted paths for session %s', existing.size, id)
        }
      }
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

  // DELETE /agent/sessions/:id
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

      // 清理报告：记录每步是否成功
      const cleanupReport: Record<string, boolean> = {}

      // 1. 中止活跃聊天
      try {
        const key = chatKey(scope, id)
        activeChats.get(key)?.abort()
        activeChats.delete(key)
        cleanupReport.abortChat = true
      } catch (err) {
        log.warn('abort active chat on session delete failed:', err)
        cleanupReport.abortChat = false
      }

      // 2. 取消交互请求
      try {
        interactManager.cancelSession(id, scope)
        cleanupReport.cancelInteracts = true
      } catch (err) {
        log.warn('cancel interacts on session delete failed:', err)
        cleanupReport.cancelInteracts = false
      }

      // 3. 刷新记忆缓冲
      if (isMemoryEnabled()) {
        try {
          await flushSessionBuffer(scope, id)
          cleanupReport.flushMemory = true
        } catch (memErr) {
          log.warn('memory buffer flush on session delete failed:', memErr)
          cleanupReport.flushMemory = false
        }
      }

      // 4. 清理终端
      try {
        getTerminalManager().cleanupSession(id)
        cleanupReport.terminalCleanup = true
      } catch (termErr) {
        log.warn('terminal cleanup on session delete failed:', termErr)
        cleanupReport.terminalCleanup = false
      }

      // 5. 释放该会话持有的所有资源锁
      try {
        const sessionLocks = lockManager.listSessionLocks(scope, id)
        lockManager.releaseSessionLocks(scope, id)
        for (const lk of sessionLocks) {
          builtinToolEvents.emitLockEvent({
            eventType: 'resource:unlocked',
            scope,
            resourceType: lk.resourceType,
            resourceId: lk.resourceId,
            sessionId: id
          })
        }
        cleanupReport.lockRelease = true
      } catch (lockErr) {
        log.warn('lock cleanup on session delete failed:', lockErr)
        cleanupReport.lockRelease = false
      }

      // 6. 最后删除会话数据（核心操作，失败则抛出）
      await adapter.deleteSession(scope, id)
      cleanupReport.deleteSession = true

      res.status(204).send()
    } catch (error) {
      log.error('delete agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
