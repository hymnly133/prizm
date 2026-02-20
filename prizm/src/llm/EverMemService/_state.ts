/**
 * EverMemService 共享内部状态
 *
 * 持有所有模块级可变状态与内部工具函数。
 * 仅供 EverMemService 子模块引用，不对外导出。
 */

import {
  MemoryManager,
  RetrievalManager,
  SQLiteAdapter,
  LanceDBAdapter,
  StorageAdapter,
  MemoryType,
  getLayerForType,
  USER_GROUP_ID,
  DEFAULT_USER_ID,
  UnifiedExtractor,
  DefaultQueryExpansionProvider,
  ICompletionProvider
} from '@prizm/evermemos'
import fs from 'fs'
import { createLogger } from '../../logger'
import { memLog } from '../memoryLogger'
import {
  getUserMemoryDbPath,
  getUserMemoryVecPath,
  getScopeMemoryDbPath,
  getScopeMemoryVecPath,
  ensureScopeMemoryDir
} from '../../core/PathProviderCore'
import { scopeStore } from '../../core/ScopeStore'
import { createCompositeStorageAdapter } from '../CompositeStorageAdapter'
import { BasePrizmLLMAdapter } from '../prizmLLMAdapter'
import type { LocalEmbeddingFn } from '../prizmLLMAdapter'
import type { MemoryItem } from '@prizm/shared'

export const log = createLogger('EverMemService')

// ─── Mutable module state ───

export interface ScopeManagerSet {
  memory: MemoryManager
  scopeOnlyMemory: MemoryManager
  retrieval: RetrievalManager
  llmProvider: PrizmLLMAdapter
}

export let _userManagers: { memory: MemoryManager; retrieval: RetrievalManager } | null = null
export const _scopeManagers = new Map<string, ScopeManagerSet>()
export let _testRetrievalOverride: RetrievalManager | null = null
export let _localEmbeddingProvider: LocalEmbeddingFn | null = null
export let _mockEmbeddingWarned = false

export function setUserManagers(m: typeof _userManagers): void { _userManagers = m }
export function setTestRetrievalOverride(m: RetrievalManager | null): void { _testRetrievalOverride = m }
export function setLocalEmbeddingProvider(fn: LocalEmbeddingFn | null): void { _localEmbeddingProvider = fn }
export function setMockEmbeddingWarned(v: boolean): void { _mockEmbeddingWarned = v }

// ─── PrizmLLMAdapter ───

export class PrizmLLMAdapter extends BasePrizmLLMAdapter {
  constructor(scope: string = 'default') {
    super({
      scope,
      defaultCategory: 'memory:conversation_extract',
      localEmbeddingProvider: () => _localEmbeddingProvider
    })
  }
}

// ─── Manager accessors ───

export function getUserManagers(): { memory: MemoryManager; retrieval: RetrievalManager } {
  if (!_userManagers) throw new Error('EverMemService not initialized')
  return _userManagers
}

export function getScopeManagers(scope: string): ScopeManagerSet {
  if (_testRetrievalOverride) {
    let m = _scopeManagers.get(`__test__${scope}`)
    if (!m) {
      m = {
        memory: {} as MemoryManager,
        scopeOnlyMemory: {} as MemoryManager,
        retrieval: _testRetrievalOverride,
        llmProvider: new PrizmLLMAdapter(scope)
      }
      _scopeManagers.set(`__test__${scope}`, m)
    }
    return m
  }
  let m = _scopeManagers.get(scope)
  if (m) {
    const cachedScopeRoot = scopeStore.getScopeRootPath(scope)
    if (cachedScopeRoot) {
      const expectedDbPath = getScopeMemoryDbPath(cachedScopeRoot)
      if (!fs.existsSync(expectedDbPath)) {
        memLog('cache:invalidate', {
          scope,
          detail: { reason: 'db_file_missing', expectedDbPath }
        })
        log.warn('Scope memory DB missing, invalidating cache:', scope, expectedDbPath)
        _scopeManagers.delete(scope)
        m = undefined
      }
    }
  }
  if (m) return m

  const scopeRoot = scopeStore.getScopeRootPath(scope)
  if (!scopeRoot) throw new Error(`Scope not found: ${scope}`)

  ensureScopeMemoryDir(scopeRoot)
  const scopeDbPath = getScopeMemoryDbPath(scopeRoot)
  const scopeVecPath = getScopeMemoryVecPath(scopeRoot)
  memLog('cache:init', { scope, detail: { scopeDbPath, scopeVecPath } })

  const scopeSqlite = new SQLiteAdapter(scopeDbPath)
  const scopeLancedb = new LanceDBAdapter(scopeVecPath)
  const scopeStorage: StorageAdapter = {
    relational: scopeSqlite,
    vector: scopeLancedb
  }

  const userStorage: StorageAdapter = {
    relational: new SQLiteAdapter(getUserMemoryDbPath()),
    vector: new LanceDBAdapter(getUserMemoryVecPath())
  }
  const compositeStorage = createCompositeStorageAdapter(userStorage, scopeStorage)

  const llmProvider = new PrizmLLMAdapter(scope)
  const unifiedExtractor = new UnifiedExtractor(llmProvider)

  const memory = new MemoryManager(compositeStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider,
    llmProvider
  })

  const scopeOnlyMemory = new MemoryManager(scopeStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider,
    llmProvider
  })

  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  const retrieval = new RetrievalManager(scopeStorage, llmProvider, {
    queryExpansionProvider,
    agenticCompletionProvider: llmProvider
  })

  m = { memory, scopeOnlyMemory, retrieval, llmProvider }
  _scopeManagers.set(scope, m)
  return m
}

export function getScopeRetrieval(scope: string): RetrievalManager {
  return getScopeManagers(scope).retrieval
}

// ─── Utility functions ───

export function mapRowToMemoryItem(r: {
  id: string
  content?: string
  user_id?: string
  group_id?: string | null
  type?: string
  created_at?: string
  updated_at?: string
  metadata?: unknown
  source_type?: string | null
  source_session_id?: string | null
  source_round_id?: string | null
  source_round_ids?: string | null
  source_document_id?: string | null
  sub_type?: string | null
}): MemoryItem {
  let meta: Record<string, unknown> | undefined
  if (typeof r.metadata === 'string') {
    try {
      meta = JSON.parse(r.metadata)
    } catch {
      meta = undefined
    }
  } else if (r.metadata && typeof r.metadata === 'object') {
    meta = r.metadata as Record<string, unknown>
  }

  const memoryType = r.type as MemoryType | undefined
  const memoryLayer = memoryType ? getLayerForType(memoryType) : undefined

  let sourceRoundIds: string[] | undefined
  if (r.source_round_ids) {
    try {
      const parsed = JSON.parse(r.source_round_ids)
      if (Array.isArray(parsed)) sourceRoundIds = parsed
    } catch {
      // invalid JSON, ignore
    }
  }

  return {
    id: r.id,
    memory: r.content ?? '',
    user_id: r.user_id,
    group_id: r.group_id ?? undefined,
    memory_type: r.type,
    memory_layer: memoryLayer,
    source_type: r.source_type ?? undefined,
    source_session_id: r.source_session_id ?? undefined,
    source_round_id: r.source_round_id ?? undefined,
    source_round_ids: sourceRoundIds,
    source_document_id: r.source_document_id ?? undefined,
    sub_type: r.sub_type ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    metadata: meta,
    ref_count: typeof meta?.ref_count === 'number' ? meta.ref_count : undefined,
    last_ref_at: typeof meta?.last_ref_at === 'string' ? meta.last_ref_at : undefined
  }
}

export function deduplicateRows(rows: any[]): any[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}

export function mergeAndDedup(items: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>()
  const result: MemoryItem[] = []
  items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      result.push(item)
    }
  }
  return result
}

// re-export types needed by sub-modules
export {
  MemoryManager,
  RetrievalManager,
  SQLiteAdapter,
  LanceDBAdapter,
  StorageAdapter,
  MemoryType,
  MemorySourceType,
  DocumentSubType,
  getLayerForType,
  USER_GROUP_ID,
  DEFAULT_USER_ID,
  RetrieveMethod,
  UnifiedExtractor,
  DefaultQueryExpansionProvider,
  MemoryRoutingContext,
  MemCell,
  RawDataType
} from '@prizm/evermemos'
export type { ICompletionProvider } from '@prizm/evermemos'
export type { MemoryItem, MemoryIdsByLayer } from '@prizm/shared'
export type { DedupLogEntry } from '@prizm/evermemos'
export type { LocalEmbeddingFn } from '../prizmLLMAdapter'
