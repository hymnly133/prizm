/**
 * 基于 MiniSearch 的全文搜索 - 默认模糊匹配，兼容统一搜索的 SearchableItem / ScoredItem
 */

import MiniSearch from 'minisearch'
import type { SearchableItem, ScoredItem } from './keywordSearch'
export type { ScoredItem } from './keywordSearch'
import { parseKeywords, cjkTokenize } from './keywordSearch'

export interface MiniSearchOptions {
  /** 匹配模式：'any' 任一关键词命中，'all' 需全部命中 */
  mode?: 'any' | 'all'
  /** 最大返回数量，默认 50 */
  limit?: number
  /** 模糊程度 0~1，默认 0.2；设为 0 关闭模糊 */
  fuzzy?: number
}

const defaultFuzzy = 0.2

/**
 * 使用 MiniSearch 对 items 做全文搜索，默认开启模糊
 */
export function miniSearch<T extends SearchableItem>(
  keywords: string | string[],
  items: T[],
  options: MiniSearchOptions = {}
): ScoredItem<T['raw'] extends infer R ? R : T>[] {
  const terms = parseKeywords(keywords)
  if (terms.length === 0) return []

  const { mode = 'any', limit = 50, fuzzy = defaultFuzzy } = options

  if (items.length === 0) return []

  const docs: { id: string; title: string; text: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    docs.push({
      id: String(i),
      title: it.title ?? '',
      text: it.text ?? ''
    })
  }

  const ms = new MiniSearch({
    fields: ['title', 'text'],
    storeFields: [],
    tokenize: cjkTokenize,
    searchOptions: {
      fuzzy: fuzzy > 0 ? fuzzy : undefined,
      prefix: true,
      boost: { title: 2 },
      combineWith: mode === 'all' ? 'AND' : 'OR'
    }
  })
  ms.addAll(docs)

  const query = terms.join(' ')
  const rawResults = ms.search(query, {
    fuzzy: fuzzy > 0 ? fuzzy : undefined,
    combineWith: mode === 'all' ? 'AND' : 'OR',
    boost: { title: 2 }
  })

  const scored: ScoredItem<T['raw'] extends infer R ? R : T>[] = rawResults
    .slice(0, limit)
    .map((r) => {
      const idx = Number(r.id)
      const orig = items[idx]
      const raw = (orig?.raw ?? orig) as T['raw'] extends infer R ? R : T
      const matchedKeywords = Array.isArray((r as { queryTerms?: string[] }).queryTerms)
        ? (r as { queryTerms: string[] }).queryTerms
        : terms
      return {
        item: raw,
        score: r.score ?? 0,
        matchedKeywords
      }
    })

  return scored
}
