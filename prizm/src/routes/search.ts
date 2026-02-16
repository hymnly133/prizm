/**
 * 统一搜索路由 - MiniSearch 全文检索，默认模糊搜索
 * 文档在创建/更新时写入索引，检索时直接查索引；首次检索从 adapters 懒加载建索引
 */

import type { Router, Request, Response } from 'express'
import type { PrizmAdapters } from '../adapters/interfaces'
import type { SearchIndexService } from '../search/searchIndexService'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  requireScopeForList,
  getScopeFromQuery,
  getScopeFromBody,
  hasScopeAccess
} from '../scopeUtils'

const log = createLogger('Search')

export type SearchResultKind = 'note' | 'document' | 'clipboard' | 'todoList'

export interface SearchResultItem {
  kind: SearchResultKind
  id: string
  score: number
  matchedKeywords: string[]
  preview: string
  raw: unknown
}

export function createSearchRoutes(
  router: Router,
  adapters: PrizmAdapters,
  searchIndex: SearchIndexService
): void {
  /**
   * POST /search - 统一关键词搜索
   * Body: { keywords, scope?, types?, limit?, mode?, fuzzy? }
   * - keywords: 关键词列表或可分词字符串（空格、逗号等分隔）
   * - scope: 必填（query.scope 或 body.scope）
   * - types: 限定搜索类型，默认全部
   * - limit: 最大返回数，默认 50
   * - mode: 'any' 任一关键词命中，'all' 需全部命中
   * - fuzzy: 模糊程度 0~1，默认 0.2；0 关闭模糊
   */
  router.post('/search', async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {}
      const scope = getScopeFromBody(req) ?? getScopeFromQuery(req)
      if (!scope) {
        return res.status(400).json({ error: 'scope is required (query or body)' })
      }
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }

      const keywords = body.keywords
      if (!keywords || (typeof keywords !== 'string' && !Array.isArray(keywords))) {
        return res.status(400).json({ error: 'keywords is required (string or string[])' })
      }

      const tags = Array.isArray(body.tags) ? body.tags : undefined
      const dateFrom = typeof body.dateFrom === 'number' ? body.dateFrom : undefined
      const dateTo = typeof body.dateTo === 'number' ? body.dateTo : undefined
      const results = await searchIndex.search(scope, keywords, {
        types: body.types,
        limit: body.limit,
        mode: body.mode,
        fuzzy: body.fuzzy,
        complete: body.complete === true,
        tags,
        dateFrom,
        dateTo
      })
      res.json({ results })
    } catch (error) {
      log.error('search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  /**
   * GET /search - 便捷查询
   * Query: ?q=关键词1 关键词2&scope=xxx&limit=50
   */
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const q = typeof req.query.q === 'string' ? req.query.q : ''
      if (!q.trim()) {
        return res.status(400).json({ error: 'q is required' })
      }

      const limit = req.query.limit ? Number(req.query.limit) : 50
      const fuzzyParam = req.query.fuzzy
      const fuzzy = fuzzyParam != null ? Number(fuzzyParam) : 0.2
      const complete = req.query.complete === 'true' || req.query.complete === '1'
      const tagsParam = req.query.tags
      const tags = typeof tagsParam === 'string' && tagsParam ? tagsParam.split(',') : undefined
      const dateFrom = req.query.dateFrom ? Number(req.query.dateFrom) : undefined
      const dateTo = req.query.dateTo ? Number(req.query.dateTo) : undefined
      const results = await searchIndex.search(scope, q.trim(), {
        limit: Number.isNaN(limit) ? 50 : Math.min(limit, 100),
        mode: 'any',
        fuzzy: Number.isNaN(fuzzy) ? 0.2 : Math.max(0, Math.min(1, fuzzy)),
        complete,
        tags,
        dateFrom: dateFrom && !Number.isNaN(dateFrom) ? dateFrom : undefined,
        dateTo: dateTo && !Number.isNaN(dateTo) ? dateTo : undefined
      })
      res.json({ results })
    } catch (error) {
      log.error('search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
