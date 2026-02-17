/**
 * 记忆模块路由 - 查看、搜索、删除记忆；用户 token 使用
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { hasScopeAccess } from '../scopeUtils'
import { DEFAULT_SCOPE } from '../core/ScopeStore'
import {
  isMemoryEnabled,
  getAllMemories,
  searchMemoriesWithOptions,
  deleteMemory,
  clearAllMemories,
  resolveMemoryIds,
  listDedupLog,
  undoDedupLog,
  getMemoryCounts
} from '../llm/EverMemService'
import { RetrieveMethod, MemoryType } from '@prizm/evermemos'
import { queryTokenUsage, aggregateTokenUsage } from '../core/tokenUsageDb'

const log = createLogger('MemoryRoutes')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

/** POST 请求可能把 scope 放在 body，优先从 body 取 */
function getScopeFromRequest(req: Request, fromBody?: boolean): string {
  if (fromBody && req.body && typeof req.body === 'object') {
    const s = (req.body as { scope?: string }).scope
    if (typeof s === 'string' && s.trim()) return s.trim()
  }
  return getScopeFromQuery(req)
}

export function createMemoryRoutes(router: Router): void {
  // GET /agent/token-usage - token 使用记录（全局共享，不按客户端隔离）
  // 支持 ?scope=&category=&limit=&offset= 过滤
  router.get('/agent/token-usage', async (req: Request, res: Response) => {
    try {
      const dataScope =
        typeof req.query.scope === 'string' ? req.query.scope.trim() || undefined : undefined
      const category =
        typeof req.query.category === 'string' ? req.query.category.trim() || undefined : undefined
      const sessionId =
        typeof req.query.sessionId === 'string'
          ? req.query.sessionId.trim() || undefined
          : undefined
      const limit =
        typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) || undefined : undefined
      const offset =
        typeof req.query.offset === 'string'
          ? parseInt(req.query.offset, 10) || undefined
          : undefined

      const filter = { dataScope, category, sessionId, limit, offset }
      const records = queryTokenUsage(filter)
      const summary = aggregateTokenUsage({ dataScope, category, sessionId })
      res.json({ records, summary })
    } catch (error) {
      log.error('token-usage error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/memories - 列出所有记忆
  router.get('/agent/memories', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json({ enabled: false, memories: [] })
      }

      const memories = await getAllMemories(scope)
      res.json({ enabled: true, memories })
    } catch (error) {
      log.error('list memories error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/memories/search - 搜索记忆（与内置工具、MCP 对齐；可选 method/use_rerank/limit/memory_types）
  router.post('/agent/memories/search', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromRequest(req, true)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json({ enabled: false, memories: [] })
      }

      const body =
        (req.body as {
          query?: string
          method?: string
          use_rerank?: boolean
          limit?: number
          memory_types?: string[]
        }) ?? {}
      const { query, method, use_rerank, limit, memory_types } = body
      if (typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'query is required' })
      }

      const methodMap: Record<string, RetrieveMethod> = {
        keyword: RetrieveMethod.KEYWORD,
        vector: RetrieveMethod.VECTOR,
        hybrid: RetrieveMethod.HYBRID,
        rrf: RetrieveMethod.RRF,
        agentic: RetrieveMethod.AGENTIC
      }
      const validTypes = Object.values(MemoryType) as string[]
      const options: {
        method?: RetrieveMethod
        use_rerank?: boolean
        limit?: number
        memory_types?: MemoryType[]
      } = {}
      if (method != null && methodMap[method] != null) options.method = methodMap[method]
      if (use_rerank != null) options.use_rerank = use_rerank
      if (limit != null) options.limit = limit
      if (Array.isArray(memory_types) && memory_types.length > 0) {
        options.memory_types = memory_types.filter((t) => validTypes.includes(t)) as MemoryType[]
      }
      const hasOptions = Object.keys(options).length > 0

      const memories = await searchMemoriesWithOptions(
        query.trim(),
        scope,
        hasOptions ? options : undefined
      )
      res.json({ enabled: true, memories })
    } catch (error) {
      log.error('search memories error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/memories/counts - 各层记忆总数（直接 COUNT，不依赖语义搜索）
  router.get('/agent/memories/counts', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json({ enabled: false, userCount: 0, scopeCount: 0 })
      }

      const counts = await getMemoryCounts(scope)
      res.json({ enabled: true, ...counts })
    } catch (error) {
      log.error('memory counts error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/memories/resolve - 按层精确解析记忆 ID → MemoryItem
  router.post('/agent/memories/resolve', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromRequest(req, true)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json({ memories: {} })
      }

      const body = req.body as {
        byLayer?: { user?: string[]; scope?: string[]; session?: string[] }
      }
      const byLayer = {
        user: Array.isArray(body.byLayer?.user) ? body.byLayer!.user : [],
        scope: Array.isArray(body.byLayer?.scope) ? body.byLayer!.scope : [],
        session: Array.isArray(body.byLayer?.session) ? body.byLayer!.session : []
      }
      const totalIds = byLayer.user.length + byLayer.scope.length + byLayer.session.length
      if (totalIds === 0) {
        return res.json({ memories: {} })
      }
      if (totalIds > 200) {
        return res.status(400).json({ error: 'Too many IDs (max 200)' })
      }

      const memories = await resolveMemoryIds(byLayer, scope)
      res.json({ memories })
    } catch (error) {
      log.error('resolve memory ids error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /agent/memories/:id - 删除记忆
  router.delete('/agent/memories/:id', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.status(400).json({ error: 'Memory module is not enabled' })
      }

      const memoryId = String(req.params.id ?? '')
      if (!memoryId.trim()) {
        return res.status(400).json({ error: 'memory id is required' })
      }

      const deleted = await deleteMemory(memoryId.trim(), scope)
      if (deleted) {
        res.status(204).send()
      } else {
        res.status(500).json({ error: 'Failed to delete memory' })
      }
    } catch (error) {
      log.error('delete memory error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/memories/dedup-log - 去重日志列表
  router.get('/agent/memories/dedup-log', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json({ entries: [] })
      }

      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined
      const entries = await listDedupLog(scope, limit)
      res.json({ entries })
    } catch (error) {
      log.error('list dedup log error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /agent/memories/dedup-log/:id/undo - 回退去重
  router.post('/agent/memories/dedup-log/:id/undo', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromRequest(req, true)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.status(400).json({ error: 'Memory module is not enabled' })
      }

      const dedupLogId = String(req.params.id ?? '').trim()
      if (!dedupLogId) {
        return res.status(400).json({ error: 'dedup log id is required' })
      }

      const restoredId = await undoDedupLog(dedupLogId, scope)
      if (restoredId) {
        res.json({ restored: true, restoredMemoryId: restoredId })
      } else {
        res.status(404).json({ error: 'Dedup log entry not found or already rolled back' })
      }
    } catch (error) {
      log.error('undo dedup error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  /**
   * POST /agent/memories/clear-all
   * 清空所有记忆（SQLite + LanceDB 向量索引）。
   * 需要严格确认：body.confirm === 'DELETE ALL'
   */
  router.post('/agent/memories/clear-all', async (req: Request, res: Response) => {
    try {
      if (!isMemoryEnabled()) {
        return res.status(400).json({ error: 'Memory module is not enabled' })
      }

      const { confirm } = req.body as { confirm?: string }
      if (confirm !== 'DELETE ALL') {
        return res.status(400).json({
          error: 'Confirmation required: body.confirm must be "DELETE ALL"'
        })
      }

      log.warn('CLEAR ALL MEMORIES requested — this is destructive and irreversible')
      const deleted = await clearAllMemories()
      log.warn(`All memories cleared: ${deleted} records deleted`)

      res.json({ deleted, vectorsCleared: true })
    } catch (error) {
      log.error('clear all memories error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
