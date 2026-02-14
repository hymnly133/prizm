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
  getRoundMemories
} from '../llm/EverMemService'
import { RetrieveMethod, MemoryType } from '@prizm/evermemos'
import { readUserTokenUsage } from '../core/UserStore'

const log = createLogger('MemoryRoutes')

function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

export function createMemoryRoutes(router: Router): void {
  // GET /agent/token-usage - 当前用户的 token 使用记录（按功能 scope）
  // 鉴权关闭或无 clientId 时使用 default，保证客户端能展示用量
  router.get('/agent/token-usage', async (req: Request, res: Response) => {
    try {
      const userId = req.prizmClient?.clientId ?? 'default'
      const records = readUserTokenUsage(userId)
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

      const userId = req.prizmClient?.clientId ?? 'default'
      const memories = await getAllMemories(userId)
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
      const scope = getScopeFromQuery(req)
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
      const userId = req.prizmClient?.clientId ?? 'default'

      const memories = await searchMemoriesWithOptions(
        query.trim(),
        userId,
        hasOptions ? options : undefined
      )
      res.json({ enabled: true, memories })
    } catch (error) {
      log.error('search memories error:', error)
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

      const userId = req.prizmClient?.clientId ?? 'default'
      const growth = await getRoundMemories(userId, messageId)
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

      const deleted = await deleteMemory(memoryId.trim())
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
}
