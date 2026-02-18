import { PrizmClient } from '../client'
import type { MemoryItem, DedupLogEntry, MemoryIdsByLayer } from '@prizm/shared'
import type { TokenUsageRecord } from '../../types'

/** 记忆系统日志条目（对应服务端 MemoryLogEntry） */
export interface MemoryLogEntry {
  ts: string
  event: string
  scope?: string
  documentId?: string
  sessionId?: string
  detail?: Record<string, unknown>
  error?: string
}

declare module '../client' {
  interface PrizmClient {
    getMemories(scope?: string): Promise<{ enabled: boolean; memories: MemoryItem[] }>
    searchMemories(
      query: string,
      scope?: string,
      options?: {
        method?: 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'
        use_rerank?: boolean
        limit?: number
        memory_types?: string[]
      }
    ): Promise<{ enabled: boolean; memories: MemoryItem[] }>
    deleteMemory(id: string, scope?: string): Promise<void>
    getMemoryCounts(scope?: string): Promise<{
      enabled: boolean
      userCount: number
      scopeCount: number
      sessionCount: number
      byType: Record<string, number>
    }>
    resolveMemoryIds(
      byLayer: MemoryIdsByLayer,
      scope?: string
    ): Promise<Record<string, MemoryItem | null>>
    getDocumentMemories(
      documentId: string,
      scope?: string
    ): Promise<{ enabled: boolean; memories: MemoryItem[]; extracting?: boolean }>
    extractDocumentMemory(
      documentId: string,
      scope?: string
    ): Promise<{ triggered: boolean; reason?: string }>
    getDedupLog(scope?: string, limit?: number): Promise<{ entries: DedupLogEntry[] }>
    undoDedup(
      dedupLogId: string,
      scope?: string
    ): Promise<{ restored: boolean; restoredMemoryId?: string }>
    getTokenUsage(filter?: {
      scope?: string
      category?: string
      sessionId?: string
      from?: number
      to?: number
      limit?: number
      offset?: number
    }): Promise<{
      records: TokenUsageRecord[]
      summary: {
        totalInputTokens: number
        totalOutputTokens: number
        totalTokens: number
        count: number
        byCategory: Record<string, { input: number; output: number; total: number; count: number }>
        byDataScope: Record<string, { input: number; output: number; total: number; count: number }>
        byModel: Record<string, { input: number; output: number; total: number; count: number }>
      }
    }>
    clearAllMemories(
      confirmToken: string,
      scope?: string
    ): Promise<{ deleted: number; vectorsCleared: boolean }>
    getMemoryLogs(limit?: number): Promise<{ logs: MemoryLogEntry[] }>
  }
}

PrizmClient.prototype.getMemories = async function (this: PrizmClient, scope?: string) {
  return this.request<{ enabled: boolean; memories: MemoryItem[] }>(`/agent/memories`, {
    method: 'GET',
    scope
  })
}

PrizmClient.prototype.searchMemories = async function (
  this: PrizmClient,
  query: string,
  scope?: string,
  options?: {
    method?: 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'
    use_rerank?: boolean
    limit?: number
    memory_types?: string[]
  }
) {
  const body: {
    query: string
    method?: string
    use_rerank?: boolean
    limit?: number
    memory_types?: string[]
  } = { query }
  if (options?.method) body.method = options.method
  if (options?.use_rerank != null) body.use_rerank = options.use_rerank
  if (options?.limit != null) body.limit = options.limit
  if (options?.memory_types?.length) body.memory_types = options.memory_types
  return this.request<{ enabled: boolean; memories: MemoryItem[] }>(`/agent/memories/search`, {
    method: 'POST',
    scope,
    body: JSON.stringify(body)
  })
}

PrizmClient.prototype.deleteMemory = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  await this.request<void>(`/agent/memories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope
  })
}

PrizmClient.prototype.getMemoryCounts = async function (this: PrizmClient, scope?: string) {
  return this.request<{
    enabled: boolean
    userCount: number
    scopeCount: number
    sessionCount: number
    byType: Record<string, number>
  }>('/agent/memories/counts', { method: 'GET', scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.resolveMemoryIds = async function (
  this: PrizmClient,
  byLayer: MemoryIdsByLayer,
  scope?: string
) {
  const res = await this.request<{
    memories: Record<string, MemoryItem | null>
  }>('/agent/memories/resolve', {
    method: 'POST',
    scope,
    body: JSON.stringify({ byLayer })
  })
  return res.memories
}

PrizmClient.prototype.getDocumentMemories = async function (
  this: PrizmClient,
  documentId: string,
  scope?: string
) {
  return this.request<{ enabled: boolean; memories: MemoryItem[]; extracting?: boolean }>(
    `/agent/memories/document/${encodeURIComponent(documentId)}`,
    { method: 'GET', scope }
  )
}

PrizmClient.prototype.extractDocumentMemory = async function (
  this: PrizmClient,
  documentId: string,
  scope?: string
) {
  return this.request<{ triggered: boolean; reason?: string }>(
    `/agent/memories/document/${encodeURIComponent(documentId)}/extract`,
    { method: 'POST', scope }
  )
}

PrizmClient.prototype.getDedupLog = async function (
  this: PrizmClient,
  scope?: string,
  limit?: number
) {
  const s = scope ?? this.defaultScope
  const path =
    limit != null ? `/agent/memories/dedup-log?limit=${limit}` : '/agent/memories/dedup-log'
  return this.request<{ entries: DedupLogEntry[] }>(path, { method: 'GET', scope: s })
}

PrizmClient.prototype.undoDedup = async function (
  this: PrizmClient,
  dedupLogId: string,
  scope?: string
) {
  return this.request<{ restored: boolean; restoredMemoryId?: string }>(
    `/agent/memories/dedup-log/${encodeURIComponent(dedupLogId)}/undo`,
    { method: 'POST', scope }
  )
}

PrizmClient.prototype.getTokenUsage = async function (
  this: PrizmClient,
  filter?: {
    scope?: string
    category?: string
    sessionId?: string
    from?: number
    to?: number
    limit?: number
    offset?: number
  }
) {
  const params = new URLSearchParams()
  if (filter?.scope) params.set('scope', filter.scope)
  if (filter?.category) params.set('category', filter.category)
  if (filter?.sessionId) params.set('sessionId', filter.sessionId)
  if (filter?.from != null) params.set('from', String(filter.from))
  if (filter?.to != null) params.set('to', String(filter.to))
  if (filter?.limit != null) params.set('limit', String(filter.limit))
  if (filter?.offset != null) params.set('offset', String(filter.offset))
  const qs = params.toString()
  const url = `/agent/token-usage${qs ? `?${qs}` : ''}`
  return this.request(url, { method: 'GET' })
}

PrizmClient.prototype.clearAllMemories = async function (
  this: PrizmClient,
  confirmToken: string,
  scope?: string
) {
  return this.request('/agent/memories/clear-all', {
    method: 'POST',
    scope,
    body: JSON.stringify({ confirm: confirmToken })
  })
}

PrizmClient.prototype.getMemoryLogs = async function (this: PrizmClient, limit?: number) {
  const url = limit != null ? `/agent/memories/logs?limit=${limit}` : '/agent/memories/logs'
  return this.request<{ logs: MemoryLogEntry[] }>(url, { method: 'GET' })
}
