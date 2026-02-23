import { PrizmClient } from '../client'
import type { SearchResult } from '../../types'

declare module '../client' {
  interface PrizmClient {
    search(options: {
      keywords: string | string[]
      scope?: string
      types?: Array<'document' | 'clipboard' | 'todoList' | 'file'>
      limit?: number
      mode?: 'any' | 'all'
      fuzzy?: number
      /** 为 true 时同时执行全文扫描，返回中会包含 source: 'fulltext' 的结果 */
      complete?: boolean
    }): Promise<SearchResult[]>
    searchQuery(q: string, scope?: string, limit?: number): Promise<SearchResult[]>
  }
}

PrizmClient.prototype.search = async function (
  this: PrizmClient,
  options: {
    keywords: string | string[]
    scope?: string
    types?: Array<'document' | 'clipboard' | 'todoList' | 'file'>
    limit?: number
    mode?: 'any' | 'all'
    fuzzy?: number
    complete?: boolean
  }
) {
  const scope = options.scope ?? this.defaultScope
  const url = this.buildUrl('/search', { scope })
  const response = await fetch(url, {
    method: 'POST',
    headers: this.buildHeaders(),
    body: JSON.stringify({
      keywords: options.keywords,
      scope,
      types: options.types,
      limit: options.limit ?? 50,
      mode: options.mode ?? 'any',
      fuzzy: options.fuzzy,
      complete: options.complete
    })
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { results: SearchResult[] }
  return data.results
}

PrizmClient.prototype.searchQuery = async function (
  this: PrizmClient,
  q: string,
  scope?: string,
  limit?: number
) {
  const s = scope ?? this.defaultScope
  const url = this.buildUrl('/search', {
    q,
    scope: s,
    limit: limit != null ? String(limit) : undefined
  })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { results: SearchResult[] }
  return data.results
}
