/**
 * 统一搜索路由 - 关键词列表匹配文档
 * 面向自然语言与大模型，不使用向量 embedding
 */

import type { Router, Request, Response } from 'express'
import type { PrizmAdapters } from '../adapters/interfaces'
import { keywordSearch, type ScoredItem } from '../search/keywordSearch'
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

async function runSearch(
  adapters: PrizmAdapters,
  params: {
    keywords: string | string[]
    scope: string
    types?: SearchResultKind[]
    limit?: number
    mode?: 'any' | 'all'
  }
): Promise<SearchResultItem[]> {
  const { keywords, scope } = params
  const types = params.types
  const limit = typeof params.limit === 'number' ? Math.min(params.limit, 100) : 50
  const mode = params.mode === 'all' ? 'all' : 'any'

  const searchTypes: SearchResultKind[] = types?.length
    ? types.filter((t) => ['note', 'document', 'clipboard', 'todoList'].includes(t))
    : ['note', 'document', 'clipboard', 'todoList']

  const items: Array<{ text: string; title?: string; raw: unknown; kind: SearchResultKind }> = []

  if (searchTypes.includes('note') && adapters.notes?.getAllNotes) {
    const notes = await adapters.notes.getAllNotes(scope)
    for (const n of notes) {
      const content = n.content ?? ''
      items.push({ text: content, title: content.slice(0, 80), raw: n, kind: 'note' })
    }
  }

  if (searchTypes.includes('document') && adapters.documents?.getAllDocuments) {
    const docs = await adapters.documents.getAllDocuments(scope)
    for (const d of docs) {
      const title = d.title ?? ''
      const content = d.content ?? ''
      items.push({ text: `${title}\n${content}`, title, raw: d, kind: 'document' })
    }
  }

  if (searchTypes.includes('clipboard') && adapters.clipboard?.getHistory) {
    const clips = await adapters.clipboard.getHistory(scope, { limit: 200 })
    for (const c of clips) {
      const content = c.content ?? ''
      items.push({ text: content, title: content.slice(0, 80), raw: c, kind: 'clipboard' })
    }
  }

  if (searchTypes.includes('todoList') && adapters.todoList?.getTodoLists) {
    const todoLists = await adapters.todoList.getTodoLists(scope)
    for (const todo of todoLists) {
      const parts: string[] = [todo.title ?? '']
      for (const it of todo.items) {
        parts.push(it.title ?? '')
        if (it.description) parts.push(it.description)
      }
      items.push({ text: parts.join('\n'), title: todo.title ?? '', raw: todo, kind: 'todoList' })
    }
  }

  const scored = keywordSearch(keywords, items, { mode, limit })

  return scored.map((s: ScoredItem<unknown>) => {
    const raw = s.item as { id?: string; content?: string; title?: string }
    const id = raw?.id ?? ''
    let preview = ''
    if ('content' in raw && typeof raw.content === 'string') {
      preview = raw.content.length > 80 ? raw.content.slice(0, 80) + '…' : raw.content
    } else if ('title' in raw && typeof raw.title === 'string') {
      preview = raw.title
    }
    const kind = items.find((i) => i.raw === s.item)?.kind ?? 'note'
    return {
      kind,
      id,
      score: s.score,
      matchedKeywords: s.matchedKeywords,
      preview: preview || '(空)',
      raw: s.item
    }
  })
}

export function createSearchRoutes(router: Router, adapters: PrizmAdapters): void {
  /**
   * POST /search - 统一关键词搜索
   * Body: { keywords: string | string[], scope?: string, types?: SearchResultKind[], limit?: number, mode?: 'any'|'all' }
   * - keywords: 关键词列表或可分词字符串（空格、逗号等分隔）
   * - scope: 必填（query.scope 或 body.scope）
   * - types: 限定搜索类型，默认全部
   * - limit: 最大返回数，默认 50
   * - mode: 'any' 任一关键词命中，'all' 需全部命中
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

      const results = await runSearch(adapters, {
        keywords,
        scope,
        types: body.types,
        limit: body.limit,
        mode: body.mode
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
      const results = await runSearch(adapters, {
        keywords: q.trim(),
        scope,
        limit: Number.isNaN(limit) ? 50 : Math.min(limit, 100),
        mode: 'any'
      })
      res.json({ results })
    } catch (error) {
      log.error('search error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
