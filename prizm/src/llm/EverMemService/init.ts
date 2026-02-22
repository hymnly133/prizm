/**
 * EverMemService 初始化、迁移与向量补全
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import {
  SQLiteAdapter,
  LanceDBAdapter,
  StorageAdapter,
  MemoryManager,
  RetrievalManager,
  UnifiedExtractor,
  DefaultQueryExpansionProvider,
  DEFAULT_USER_ID
} from '@prizm/evermemos'
import {
  ensureMemoryDir,
  getUserMemoryDbPath,
  getUserMemoryVecPath,
  getUsersDir
} from '../../core/PathProviderCore'
import { scopeStore } from '../../core/ScopeStore'
import {
  log,
  PrizmLLMAdapter,
  setUserManagers,
  _localEmbeddingProvider,
  setLocalEmbeddingProvider,
  setMockEmbeddingWarned,
  getUserManagers,
  _scopeManagers,
  getScopeManagers,
  setTestRetrievalOverride
} from './_state'
import type { LocalEmbeddingFn } from './_state'
import type { ICompletionProvider } from '@prizm/evermemos'
import { getScopeMemoryDbPath } from '../../core/PathProviderCore'

export { type LocalEmbeddingFn }

// ─── Local Embedding ───

export function registerLocalEmbeddingProvider(fn: LocalEmbeddingFn): void {
  setLocalEmbeddingProvider(fn)
  setMockEmbeddingWarned(false)
  log.info('Local embedding provider registered')
}

export function clearLocalEmbeddingProvider(): void {
  setLocalEmbeddingProvider(null)
  setMockEmbeddingWarned(false)
}

// ─── DB Migration ───

function migrateMemoryDb(dbPath: string, label: string): void {
  if (!fs.existsSync(dbPath)) return
  try {
    const db = new Database(dbPath)
    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id != ? AND user_id IS NOT NULL')
      .get(DEFAULT_USER_ID) as { cnt: number } | undefined
    const count = countRow?.cnt ?? 0
    if (count > 0) {
      const result = db
        .prepare('UPDATE memories SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(DEFAULT_USER_ID, DEFAULT_USER_ID)
      log.info(
        `[Migration] ${label}: unified ${result.changes} memory rows to user_id="${DEFAULT_USER_ID}"`
      )
    }
    try {
      const dedupResult = db
        .prepare('UPDATE dedup_log SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(DEFAULT_USER_ID, DEFAULT_USER_ID)
      if (dedupResult.changes > 0) {
        log.info(`[Migration] ${label}: unified ${dedupResult.changes} dedup_log rows`)
      }
    } catch {
      // dedup_log table may not exist
    }
    db.close()
  } catch (e) {
    log.warn(`[Migration] ${label}: failed to migrate:`, e)
  }
}

function runMemoryUserIdMigration(): void {
  const userDbPath = getUserMemoryDbPath()
  migrateMemoryDb(userDbPath, 'user.db')

  const scopes = scopeStore.getAllScopes()
  for (const scopeId of scopes) {
    try {
      const scopeRoot = scopeStore.getScopeRootPath(scopeId)
      if (!scopeRoot) continue
      const scopeDbPath = getScopeMemoryDbPath(scopeRoot)
      migrateMemoryDb(scopeDbPath, `scope[${scopeId}]`)
    } catch {
      // scope root path not available, skip
    }
  }
}

// ─── Init ───

export async function initEverMemService() {
  ensureMemoryDir()

  try {
    const { localEmbedding } = await import('../localEmbedding')
    await localEmbedding.init()
  } catch (e) {
    log.warn('Local embedding init failed — memories will be saved without vectors:', e)
  }

  runMemoryUserIdMigration()

  const userDbPath = getUserMemoryDbPath()
  const userVecPath = getUserMemoryVecPath()

  const userSqlite = new SQLiteAdapter(userDbPath)
  const userLancedb = new LanceDBAdapter(userVecPath)
  const userStorage: StorageAdapter = {
    relational: userSqlite,
    vector: userLancedb
  }

  const llmProvider = new PrizmLLMAdapter('__user__')
  const unifiedExtractor = new UnifiedExtractor(llmProvider)
  const userMemory = new MemoryManager(userStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider
  })
  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  const userRetrieval = new RetrievalManager(userStorage, llmProvider, {
    queryExpansionProvider,
    agenticCompletionProvider: llmProvider
  })

  setUserManagers({ memory: userMemory, retrieval: userRetrieval })
  log.info('EverMemService initialized (user-level)')

  scheduleVectorBackfill()
}

// ─── Vector Backfill ───

let _backfillPromise: Promise<void> | null = null

function scheduleVectorBackfill(): void {
  setTimeout(() => void runVectorBackfill(), 5_000)
}

export async function runVectorBackfill(): Promise<void> {
  if (_backfillPromise) return _backfillPromise
  _backfillPromise = (async () => {
    try {
      if (!_localEmbeddingProvider) {
        log.info('[VectorBackfill] No local embedding provider — skipping')
        return
      }
      log.debug('[VectorBackfill] Starting backfill scan...')

      let totalBackfilled = 0
      let totalFailed = 0

      const backfillManager = async (manager: MemoryManager, label: string) => {
        try {
          const rows = await manager.storage.relational.query(
            'SELECT id, content FROM memories WHERE id NOT IN (SELECT DISTINCT id FROM memories WHERE 1=1)',
            []
          )
          if (!rows?.length) return

          for (const row of rows) {
            try {
              const r = row as { id: string; content?: string }
              if (!r.content) continue
              const vec = await _localEmbeddingProvider!(r.content)
              if (vec.length > 0) {
                await manager.storage.vector.add('__backfill', [
                  {
                    id: r.id,
                    content: r.content,
                    user_id: DEFAULT_USER_ID,
                    group_id: '',
                    vector: vec
                  }
                ])
                totalBackfilled++
              }
            } catch (e) {
              totalFailed++
              if (totalFailed <= 3) log.warn(`[VectorBackfill] ${label} item failed:`, e)
            }
          }
        } catch (e) {
          log.warn(`[VectorBackfill] ${label} scan failed:`, e)
        }
      }

      try {
        await backfillManager(getUserManagers().memory, 'user')
      } catch {
        /* not initialized */
      }

      for (const [scopeId, managers] of _scopeManagers) {
        await backfillManager(managers.scopeOnlyMemory, `scope[${scopeId}]`)
      }

      if (totalBackfilled > 0 || totalFailed > 0) {
        log.info(`[VectorBackfill] Complete: ${totalBackfilled} backfilled, ${totalFailed} failed`)
      } else {
        log.debug('[VectorBackfill] No memories need vector backfill')
      }
    } finally {
      _backfillPromise = null
    }
  })()
  return _backfillPromise
}

// ─── Manager factory exports ───

export function createMemoryExtractionLLMAdapter(): ICompletionProvider {
  return new PrizmLLMAdapter()
}

export function getMemoryManager(): MemoryManager {
  return getUserManagers().memory
}

export function getRetrievalManager(): RetrievalManager {
  return getUserManagers().retrieval
}

export function setRetrievalManagerForTest(manager: RetrievalManager | null): void {
  if (process.env.NODE_ENV !== 'test') return
  setTestRetrievalOverride(manager)
  if (manager) {
    try {
      setUserManagers({
        memory: getUserManagers().memory,
        retrieval: manager
      })
    } catch {
      setUserManagers({
        memory: {} as MemoryManager,
        retrieval: manager
      })
    }
  } else {
    setUserManagers(null)
    setTestRetrievalOverride(null)
    _scopeManagers.clear()
  }
}

export function isMemoryEnabled(): boolean {
  return true
}

export function invalidateScopeManagerCache(scope?: string): void {
  const { memLog } = require('../memoryLogger')
  if (scope) {
    _scopeManagers.delete(scope)
    memLog('cache:invalidate', { scope, detail: { reason: 'manual_invalidate' } })
    log.info('Invalidated scope manager cache:', scope)
  } else {
    _scopeManagers.clear()
    memLog('cache:invalidate', { detail: { reason: 'manual_invalidate_all' } })
    log.info('Invalidated all scope manager caches')
  }
}
