/**
 * 记忆模块路由 - 查看、搜索、删除记忆；用户 token 使用
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { hasScopeAccess } from '../scopeUtils'
import { DEFAULT_SCOPE } from '../core/ScopeStore'
import { MEMORY_USER_ID } from '@prizm/shared'
import {
  isMemoryEnabled,
  getAllMemories,
  searchMemoriesWithOptions,
  deleteMemory,
  getRoundMemories,
  listDedupLog,
  undoDedupLog,
  getMemoryCounts
} from '../llm/EverMemService'
import { RetrieveMethod, MemoryType } from '@prizm/evermemos'
import { readUserTokenUsage } from '../core/UserStore'

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
  router.get('/agent/token-usage', async (req: Request, res: Response) => {
    try {
      const records = readUserTokenUsage(MEMORY_USER_ID)
      res.json({ records })
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

      const memories = await getAllMemories(MEMORY_USER_ID, scope)
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
        MEMORY_USER_ID,
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

      const counts = await getMemoryCounts(MEMORY_USER_ID, scope)
      res.json({ enabled: true, ...counts })
    } catch (error) {
      log.error('memory counts error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /agent/memories/round/:messageId - 获取某轮对话的记忆增长（按 assistant 消息 ID）
  router.get('/agent/memories/round/:messageId', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req)
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      if (!isMemoryEnabled()) {
        return res.json(null)
      }

      const messageId = String(req.params.messageId ?? '').trim()
      if (!messageId) {
        return res.status(400).json({ error: 'messageId is required' })
      }

      const growth = await getRoundMemories(MEMORY_USER_ID, messageId, scope)
      res.json(growth)
    } catch (error) {
      log.error('get round memories error:', error)
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
      const entries = await listDedupLog(MEMORY_USER_ID, scope, limit)
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
}
