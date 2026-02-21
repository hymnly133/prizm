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
import { getTextContent, isChatCategory } from '@prizm/shared'
import type { MemoryIdsByLayer } from '@prizm/shared'
import type { TokenUsageCategory } from '../../types'
import { getSessionContext, resetSessionContext } from '../../llm/contextTracker'
import type { ScopeActivityRecord } from '../../llm/scopeInteractionParser'
import {
  deriveScopeActivities,
  collectToolCallsFromMessages
} from '../../llm/scopeInteractionParser'
import { queryTokenUsage } from '../../core/tokenUsageDb'
import { getLLMProviderName } from '../../llm/index'
import { getTerminalManager } from '../../terminal/TerminalSessionManager'
import { interactManager } from '../../llm/interactManager'
import { emit } from '../../core/eventBus'
import { lockManager } from '../../core/resourceLockManager'
import type { ResourceLock } from '../../core/resourceLockManager/types'
import {
  loadFileSnapshots,
  deleteCheckpointSnapshots,
  deleteSessionCheckpoints,
  extractFileChangesFromMessages
} from '../../core/checkpointStore'
import { scopeStore } from '../../core/ScopeStore'
import * as mdStore from '../../core/mdStore'
import * as documentService from '../../services/documentService'
import { getVersionHistory, saveVersion } from '../../core/documentVersionStore'
import { resetSessionAccumulator } from '../../llm/EverMemService'
import { scheduleTurnSummary } from '../../llm/conversationSummaryService'
import { clearDefMetaSessionRef } from '../../core/workflowEngine/workflowDefStore'
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

      const tokenRecords = queryTokenUsage({ sessionId: id, dataScope: scope })
      const tokenSummary = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCachedInputTokens: 0,
        rounds: tokenRecords.filter((r) => isChatCategory(r.category)).length,
        byModel: {} as Record<
          string,
          { input: number; output: number; total: number; cached: number; count: number }
        >,
        byCategory: {} as Partial<
          Record<
            TokenUsageCategory,
            { input: number; output: number; total: number; cached: number; count: number }
          >
        >
      }
      for (const r of tokenRecords) {
        const cached = r.cachedInputTokens ?? 0
        tokenSummary.totalInputTokens += r.inputTokens
        tokenSummary.totalOutputTokens += r.outputTokens
        tokenSummary.totalTokens += r.totalTokens
        tokenSummary.totalCachedInputTokens += cached
        const m = r.model || getLLMProviderName()
        if (!tokenSummary.byModel[m]) {
          tokenSummary.byModel[m] = { input: 0, output: 0, total: 0, cached: 0, count: 0 }
        }
        tokenSummary.byModel[m].input += r.inputTokens
        tokenSummary.byModel[m].output += r.outputTokens
        tokenSummary.byModel[m].total += r.totalTokens
        tokenSummary.byModel[m].cached += cached
        tokenSummary.byModel[m].count += 1
        const cat = (r.category || 'chat') as TokenUsageCategory
        if (!tokenSummary.byCategory[cat]) {
          tokenSummary.byCategory[cat] = { input: 0, output: 0, total: 0, cached: 0, count: 0 }
        }
        const catBucket = tokenSummary.byCategory[cat]!
        catBucket.input += r.inputTokens
        catBucket.output += r.outputTokens
        catBucket.total += r.totalTokens
        catBucket.cached += cached
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

  // GET /agent/sessions/:id/messages/:messageId — 查询指定消息及上下文窗口
  router.get('/agent/sessions/:id/messages/:messageId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const id = ensureStringParam(req.params.id)
      const messageId = ensureStringParam(req.params.messageId)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const contextSize = Math.min(
        Math.max(parseInt(String(req.query.context ?? '3'), 10) || 3, 0),
        20
      )
      const session = await adapter.getSession(scope, id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }
      const msgIndex = session.messages.findIndex((m) => m.id === messageId)
      if (msgIndex < 0) {
        return res.status(404).json({ error: 'Message not found', sessionId: id, messageId })
      }
      const start = Math.max(0, msgIndex - contextSize)
      const end = Math.min(session.messages.length, msgIndex + contextSize + 1)
      res.json({
        sessionId: id,
        messageId,
        messageIndex: msgIndex,
        totalMessages: session.messages.length,
        message: session.messages[msgIndex],
        context: session.messages.slice(start, end)
      })
    } catch (error) {
      log.error('get session message error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id/messages — 列出消息（支持分页和定位）
  router.get('/agent/sessions/:id/messages', async (req: Request, res: Response) => {
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
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200)
      const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0)
      const messages = session.messages.slice(offset, offset + limit)
      res.json({
        sessionId: id,
        totalMessages: session.messages.length,
        offset,
        limit,
        messages
      })
    } catch (error) {
      log.error('list session messages error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions — 返回 EnrichedSession[]，自带 heldLocks，支持 ?kind= / ?source= 过滤
  router.get('/agent/sessions', async (req: Request, res: Response) => {
    try {
      if (!adapter?.listSessions) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      let sessions = await adapter.listSessions(scope)
      const kindFilter = typeof req.query.kind === 'string' ? req.query.kind : undefined
      if (kindFilter === 'background') {
        sessions = sessions.filter((s) => s.kind === 'background')
      } else if (kindFilter === 'interactive') {
        sessions = sessions.filter((s) => !s.kind || s.kind === 'interactive')
      } else if (kindFilter === 'tool') {
        sessions = sessions.filter((s) => s.kind === 'tool')
      }
      const bgStatusFilter = typeof req.query.bgStatus === 'string' ? req.query.bgStatus : undefined
      if (bgStatusFilter) {
        sessions = sessions.filter((s) => s.bgStatus === bgStatusFilter)
      }
      const sourceFilter = typeof req.query.source === 'string' ? req.query.source : undefined
      if (sourceFilter === 'direct') {
        sessions = sessions.filter((s) => {
          if (s.kind !== 'background') return true
          const src = s.bgMeta?.source
          return !src || src === 'direct'
        })
      } else if (sourceFilter === 'task' || sourceFilter === 'workflow') {
        sessions = sessions.filter((s) => s.bgMeta?.source === sourceFilter)
      }
      const scopeLocks = lockManager.listScopeLocks(scope)
      const locksBySession = new Map<string, ResourceLock[]>()
      for (const lock of scopeLocks) {
        const arr = locksBySession.get(lock.sessionId) ?? []
        arr.push(lock)
        locksBySession.set(lock.sessionId, arr)
      }
      const enriched = sessions.map((s) => ({
        ...s,
        heldLocks: locksBySession.get(s.id) ?? []
      }))
      res.json({ sessions: enriched })
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

      emit('agent:session.created', {
        scope,
        sessionId: session.id,
        actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:sessions' }
      }).catch(() => {})

      res.status(201).json({ session })
    } catch (error) {
      log.error('create agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/sessions/:id — 返回 EnrichedSession，自带 heldLocks
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
      const sessionLocks = lockManager.listSessionLocks(scope, id)
      res.json({ session: { ...session, heldLocks: sessionLocks } })
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
      const body = req.body ?? {}
      const llmSummary =
        typeof body.llmSummary === 'string' ? body.llmSummary : undefined
      const allowedTools = Array.isArray(body.allowedTools)
        ? (body.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined
      const allowedSkills = Array.isArray(body.allowedSkills)
        ? (body.allowedSkills as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined
      const allowedMcpServerIds = Array.isArray(body.allowedMcpServerIds)
        ? (body.allowedMcpServerIds as unknown[]).filter((m): m is string => typeof m === 'string')
        : undefined
      const session = await adapter.updateSession(scope, id, {
        ...(llmSummary !== undefined && { llmSummary }),
        ...(allowedTools !== undefined && { allowedTools }),
        ...(allowedSkills !== undefined && { allowedSkills }),
        ...(allowedMcpServerIds !== undefined && { allowedMcpServerIds })
      })
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
      const defaultPaths = request.details?.kind === 'file_access'
        ? (request.details as { paths: string[] }).paths
        : []
      const grantedPaths = Array.isArray(paths)
        ? paths.filter((p: unknown) => typeof p === 'string' && p.trim())
        : defaultPaths
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

  // GET /agent/sessions/:id/checkpoints — 列出会话的所有 checkpoint
  router.get('/agent/sessions/:id/checkpoints', async (req: Request, res: Response) => {
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
      res.json({ checkpoints: session.checkpoints ?? [] })
    } catch (error) {
      log.error('list checkpoints error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/sessions/:id/rollback/:checkpointId — 回退到指定 checkpoint
  router.post('/agent/sessions/:id/rollback/:checkpointId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getSession || !adapter?.truncateMessages) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const id = ensureStringParam(req.params.id)
      const checkpointId = ensureStringParam(req.params.checkpointId)
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const restoreFiles = req.body?.restoreFiles !== false

      log.info(
        'Rollback started: session=%s checkpoint=%s scope=%s restoreFiles=%s',
        id,
        checkpointId,
        scope,
        restoreFiles
      )

      // 1. 中止活跃聊天 + 清理交互请求
      const ck = chatKey(scope, id)
      const hadActiveChat = activeChats.has(ck)
      activeChats.get(ck)?.abort()
      activeChats.delete(ck)
      interactManager.cancelSession(id, scope)
      if (hadActiveChat) {
        log.info('Rollback: aborted active chat for session=%s', id)
      }

      const session = await adapter.getSession(scope, id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const checkpoints = session.checkpoints ?? []
      const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId)
      if (cpIndex < 0) {
        return res.status(404).json({ error: 'Checkpoint not found' })
      }

      const checkpoint = checkpoints[cpIndex]
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      // 2. 收集将被删除的 checkpoint 及消息
      const removedCheckpoints = checkpoints.slice(cpIndex)
      const removedCpIds = removedCheckpoints.map((cp) => cp.id)
      const rolledBackMessages = session.messages.slice(checkpoint.messageIndex)
      const assistantMessages = rolledBackMessages.filter((m) => m.role === 'assistant')
      const allFileChanges = extractFileChangesFromMessages(
        assistantMessages.map((m) => ({
          parts: m.parts as Array<{
            type: string
            name?: string
            arguments?: string
            result?: string
            isError?: boolean
          }>
        }))
      )

      log.debug(
        'Rollback: removedCheckpoints=%d removedMessages=%d assistantMessages=%d',
        removedCheckpoints.length,
        rolledBackMessages.length,
        assistantMessages.length
      )

      // 3. 从被删除消息的 memoryRefs.created 中收集 P1 记忆 ID
      const removedMemoryIds: MemoryIdsByLayer = { user: [], scope: [], session: [] }
      for (const msg of rolledBackMessages) {
        if (msg.memoryRefs?.created) {
          removedMemoryIds.user.push(...msg.memoryRefs.created.user)
          removedMemoryIds.scope.push(...msg.memoryRefs.created.scope)
          removedMemoryIds.session.push(...msg.memoryRefs.created.session)
        }
      }
      const totalP1Memories =
        removedMemoryIds.user.length +
        removedMemoryIds.scope.length +
        removedMemoryIds.session.length
      if (totalP1Memories > 0) {
        log.info(
          'Rollback: collected %d P1 memory IDs for cleanup (user=%d scope=%d session=%d)',
          totalP1Memories,
          removedMemoryIds.user.length,
          removedMemoryIds.scope.length,
          removedMemoryIds.session.length
        )
      }

      // 4. 合并快照：first-occurrence-wins（第一个 checkpoint 的快照代表变更前的原始状态）
      const mergedSnapshots = new Map<string, string>()
      for (const cp of removedCheckpoints) {
        const snapshots = loadFileSnapshots(scopeRoot, id, cp.id)
        for (const [snapKey, value] of Object.entries(snapshots)) {
          if (!mergedSnapshots.has(snapKey)) {
            mergedSnapshots.set(snapKey, value)
          }
        }
      }

      // 5. 恢复文件和文档内容，同时跟踪被删除/恢复的文档 ID
      const restoredFiles: string[] = []
      const deletedDocumentIds: string[] = []
      const restoredDocumentIds: string[] = []
      if (restoreFiles) {
        for (const [snapKey, snapshotValue] of mergedSnapshots) {
          try {
            if (snapKey.startsWith('[todo:')) {
              const listId = snapKey.slice(6, -1)
              const todoInfo = JSON.parse(snapshotValue) as {
                action: 'create_list' | 'modify'
                listSnapshot?: import('@prizm/shared').TodoList
              }

              log.debug('Rollback todo: listId=%s action=%s', listId, todoInfo.action)

              const data = scopeStore.getScopeData(scope)
              if (!data.todoLists) data.todoLists = []

              if (todoInfo.action === 'create_list') {
                data.todoLists = data.todoLists.filter((l) => l.id !== listId)
                log.debug('Rollback: removed created todo list %s', listId)
              } else if (todoInfo.action === 'modify' && todoInfo.listSnapshot) {
                const idx = data.todoLists.findIndex((l) => l.id === listId)
                if (idx >= 0) {
                  data.todoLists[idx] = todoInfo.listSnapshot
                } else {
                  data.todoLists.push(todoInfo.listSnapshot)
                }
                log.debug('Rollback: restored todo list %s to snapshot', listId)
              }

              scopeStore.saveScope(scope)
              lockManager.releaseLock(scope, 'todo_list', listId, id)
              restoredFiles.push(snapKey)
              continue
            }

            if (snapKey.startsWith('[doc:')) {
              const docId = snapKey.slice(5, -1)
              const info = JSON.parse(snapshotValue) as {
                action: 'create' | 'update' | 'delete'
                versionBefore?: number
                title?: string
                relativePath?: string
              }
              const rollbackCtx = {
                scope,
                actor: { type: 'user' as const, source: 'api:rollback' as const }
              }

              log.debug(
                'Rollback doc: id=%s action=%s versionBefore=%s',
                docId,
                info.action,
                info.versionBefore
              )

              if (info.action === 'update' && info.versionBefore) {
                const history = getVersionHistory(scopeRoot, docId)
                const targetVer = history.versions.find((v) => v.version === info.versionBefore)
                if (targetVer) {
                  await documentService.updateDocument(
                    rollbackCtx,
                    docId,
                    { title: targetVer.title, content: targetVer.content },
                    { changeReason: `Checkpoint rollback to v${info.versionBefore}` }
                  )
                  saveVersion(scopeRoot, docId, targetVer.title, targetVer.content, {
                    changedBy: { type: 'user', source: 'api:rollback' },
                    changeReason: `Checkpoint rollback`
                  })
                  restoredDocumentIds.push(docId)
                } else {
                  log.warn(
                    'Rollback: target version v%d not found for doc=%s',
                    info.versionBefore,
                    docId
                  )
                }
              } else if (info.action === 'create') {
                try {
                  await documentService.deleteDocument(rollbackCtx, docId)
                  deletedDocumentIds.push(docId)
                } catch (delErr) {
                  log.warn('Failed to undo document creation on rollback:', docId, delErr)
                }
              } else if (info.action === 'delete' && info.versionBefore) {
                const history = getVersionHistory(scopeRoot, docId)
                const targetVer = history.versions.find((v) => v.version === info.versionBefore)
                if (targetVer) {
                  await documentService.importDocument(rollbackCtx, {
                    id: docId,
                    title: info.title ?? targetVer.title,
                    content: targetVer.content,
                    relativePath: info.relativePath ?? '',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                  })
                  restoredDocumentIds.push(docId)
                }
              }

              lockManager.releaseLock(scope, 'document', docId, id)
              restoredFiles.push(snapKey)
              continue
            }

            mdStore.writeFileByPath(scopeRoot, snapKey, snapshotValue)
            restoredFiles.push(snapKey)
          } catch (e) {
            log.warn('Failed to restore on rollback:', snapKey, e)
          }
        }
      }

      // 6. 截断消息
      const updatedSession = await adapter.truncateMessages(scope, id, checkpoint.messageIndex)

      // 7. 清理快照文件
      deleteCheckpointSnapshots(scopeRoot, id, removedCpIds)

      // 8. 同步重置：累积器 + 上下文追踪 + compressedThroughRound
      resetSessionAccumulator(scope, id)
      resetSessionContext(scope, id)

      const remainingRounds = Math.floor(checkpoint.messageIndex / 2)
      const oldCompressed = session.compressedThroughRound ?? 0
      if (oldCompressed > remainingRounds && adapter.updateSession) {
        const newCompressed = Math.min(oldCompressed, remainingRounds)
        await adapter.updateSession(scope, id, { compressedThroughRound: newCompressed })
        updatedSession.compressedThroughRound = newCompressed
        log.info(
          'Rollback: adjusted compressedThroughRound %d → %d for session=%s',
          oldCompressed,
          newCompressed,
          id
        )
      }
      log.debug('Rollback: accumulator and context tracker reset for session=%s', id)

      // 9. 摘要更新：根据剩余消息重建或清空 llmSummary
      const remainingMessages = updatedSession.messages ?? []
      const lastUserMsg = [...remainingMessages].reverse().find((m) => m.role === 'user')
      if (lastUserMsg) {
        const userText = getTextContent(lastUserMsg).trim()
        if (userText) {
          log.debug('Rollback: re-scheduling turn summary from remaining user message')
          scheduleTurnSummary(scope, id, userText)
        }
      } else {
        const data = scopeStore.getScopeData(scope)
        const sessionInStore = data.agentSessions.find((s) => s.id === id)
        if (sessionInStore && sessionInStore.llmSummary) {
          sessionInStore.llmSummary = undefined
          sessionInStore.updatedAt = Date.now()
          scopeStore.saveScope(scope)
          log.debug('Rollback: cleared llmSummary (no remaining user messages)')
        }
      }

      log.info(
        'Session rolled back: %s to checkpoint=%s messageIndex=%d restored=%d files deletedDocs=%d restoredDocs=%d p1Memories=%d',
        id,
        checkpointId,
        checkpoint.messageIndex,
        restoredFiles.length,
        deletedDocumentIds.length,
        restoredDocumentIds.length,
        totalP1Memories
      )

      // 10. 发射 agent:session.rolledBack 事件（异步处理器完成清理）
      emit('agent:session.rolledBack', {
        scope,
        sessionId: id,
        checkpointId,
        checkpointMessageIndex: checkpoint.messageIndex,
        removedCheckpointIds: removedCpIds,
        removedMemoryIds,
        deletedDocumentIds,
        restoredDocumentIds,
        remainingMessageCount: checkpoint.messageIndex,
        actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:rollback' }
      }).catch((err) => {
        log.warn('Rollback event emission failed:', err)
      })

      res.json({
        session: updatedSession,
        rolledBackMessageCount: rolledBackMessages.length,
        restoredFiles,
        rolledBackFileChanges: allFileChanges
      })
    } catch (error) {
      log.error('rollback error:', error)
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
      const scope = getScopeFromQuery(req) ?? 'default'
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

      // 3. 清理终端（记忆缓冲刷新由 EventBus memoryHandler 在 session.deleted 事件中处理）
      try {
        getTerminalManager().cleanupSession(id)
        cleanupReport.terminalCleanup = true
      } catch (termErr) {
        log.warn('terminal cleanup on session delete failed:', termErr)
        cleanupReport.terminalCleanup = false
      }

      // 4. 清理 checkpoint 快照文件
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        deleteSessionCheckpoints(scopeRoot, id)
        cleanupReport.deleteCheckpoints = true
      } catch (err) {
        log.warn('delete session checkpoints failed:', err)
        cleanupReport.deleteCheckpoints = false
      }

      // 5. 删除会话数据（核心操作，失败则抛出）
      await adapter.deleteSession(scope, id)
      cleanupReport.deleteSession = true

      // 5b. 清除工作流 def 上指向该会话的引用，避免死数据
      try {
        const cleared = clearDefMetaSessionRef(id)
        if (cleared > 0) log.info('Cleared workflow def refs for deleted session:', id, 'count:', cleared)
      } catch (err) {
        log.warn('clear def meta session ref failed:', err)
      }

      // 6. 发布会话删除事件 — 锁释放、后续清理由各 handler 响应
      try {
        await emit('agent:session.deleted', {
          scope,
          sessionId: id,
          actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:sessions' }
        })
        cleanupReport.emitDeleted = true
      } catch (err) {
        log.warn('emit agent:session.deleted failed:', err)
        cleanupReport.emitDeleted = false
      }

      res.status(204).send()
    } catch (error) {
      log.error('delete agent session error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
