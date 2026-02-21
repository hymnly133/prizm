/**
 * EverMemService CRUD 操作、计数、引用统计、去重日志
 */

import {
  MemoryManager,
  DEFAULT_USER_ID,
  USER_GROUP_ID
} from '@prizm/evermemos'
import { memLog } from '../memoryLogger'
import {
  log,
  getUserManagers,
  getScopeManagers,
  _scopeManagers,
  mapRowToMemoryItem,
  deduplicateRows
} from './_state'
import type { MemoryItem, MemoryIdsByLayer } from '@prizm/shared'
import type { DedupLogEntry } from '@prizm/evermemos'

/** 列表单次最大条数，避免 /agent/memories 只返回 200 导致 scope 叙事/前瞻只显示零星几条 */
const LIST_MEMORIES_LIMIT = 5000

export async function getAllMemories(scope?: string): Promise<MemoryItem[]> {
  const userRows = await getUserManagers().memory.listMemories(DEFAULT_USER_ID, LIST_MEMORIES_LIMIT)
  let rows = userRows
  if (scope) {
    try {
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.listMemories(
        DEFAULT_USER_ID,
        LIST_MEMORIES_LIMIT
      )
      rows = [...userRows, ...scopeRows]
    } catch {
      // scope not found, use user only
    }
  }
  return deduplicateRows(rows).map(mapRowToMemoryItem)
}

export async function getMemoryById(id: string, scope?: string): Promise<MemoryItem | null> {
  const userRows = await getUserManagers().memory.storage.relational.query(
    'SELECT * FROM memories WHERE id = ? LIMIT 1',
    [id]
  )
  if (userRows.length > 0) return mapRowToMemoryItem(userRows[0] as any)
  if (scope) {
    try {
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.storage.relational.query(
        'SELECT * FROM memories WHERE id = ? LIMIT 1',
        [id]
      )
      if (scopeRows.length > 0) return mapRowToMemoryItem(scopeRows[0] as any)
    } catch {
      // scope not found
    }
  }
  return null
}

export async function deleteMemory(id: string, scope?: string): Promise<boolean> {
  let ok = await getUserManagers().memory.deleteMemory(id)
  if (ok) return true
  if (scope) {
    try {
      ok = await getScopeManagers(scope).memory.deleteMemory(id)
    } catch {
      // scope not found
    }
  } else {
    for (const [, m] of _scopeManagers) {
      ok = await m.memory.deleteMemory(id)
      if (ok) return true
    }
  }
  return ok
}

export async function deleteMemoriesByGroupId(groupId: string): Promise<number> {
  if (groupId === USER_GROUP_ID) {
    return getUserManagers().memory.deleteMemoriesByGroupId(groupId)
  }
  const scope = groupId.split(':')[0]
  return getScopeManagers(scope).memory.deleteMemoriesByGroupId(groupId)
}

export async function deleteMemoriesByGroupPrefix(groupPrefix: string): Promise<number> {
  if (!groupPrefix || groupPrefix === '') return 0
  const scope = groupPrefix.split(':')[0]
  return getScopeManagers(scope).memory.deleteMemoriesByGroupPrefix(groupPrefix)
}

export async function clearAllMemories(): Promise<number> {
  let total = 0

  try {
    total += await getUserManagers().memory.clearAllMemories()
  } catch (e) {
    log.error('Failed to clear user memories:', e)
  }

  for (const [scopeId, managers] of _scopeManagers) {
    try {
      total += await managers.scopeOnlyMemory.clearAllMemories()
      log.info(`Cleared scope "${scopeId}" memories`)
    } catch (e) {
      log.error(`Failed to clear scope "${scopeId}" memories:`, e)
    }
  }

  _scopeManagers.clear()
  memLog('memory:clear', { detail: { totalDeleted: total } })
  log.info(`All memories cleared: ${total} records deleted`)
  return total
}

// ─── Counts ───

export interface MemoryCountsByType {
  userCount: number
  scopeCount: number
  scopeChatCount: number
  scopeDocumentCount: number
  sessionCount: number
  byType: Record<string, number>
}

export async function getMemoryCounts(scope?: string): Promise<MemoryCountsByType> {
  const userByType = await getUserManagers().memory.countMemoriesByType()
  const userCount = Object.values(userByType).reduce((s, n) => s + n, 0)

  let scopeByType: Record<string, number> = {}
  let scopeTotalCount = 0
  let sessionCount = 0
  let scopeDocumentCount = 0
  if (scope) {
    try {
      const managers = getScopeManagers(scope)
      scopeByType = await managers.scopeOnlyMemory.countMemoriesByType()
      scopeTotalCount = Object.values(scopeByType).reduce((s, n) => s + n, 0)

      const sessionPrefix = `${scope}:session:`
      try {
        const rows = await managers.scopeOnlyMemory.storage.relational.query(
          'SELECT COUNT(*) as cnt FROM memories WHERE group_id LIKE ?',
          [`${sessionPrefix}%`]
        )
        sessionCount = (rows[0] as { cnt: number })?.cnt ?? 0
      } catch {
        // query failure doesn't affect totals
      }

      try {
        const rows = await managers.scopeOnlyMemory.storage.relational.query(
          "SELECT COUNT(*) as cnt FROM memories WHERE type = 'document' AND (group_id IS NULL OR group_id NOT LIKE ?)",
          [`${sessionPrefix}%`]
        )
        scopeDocumentCount = (rows[0] as { cnt: number })?.cnt ?? 0
      } catch {
        // fallback: doesn't affect other counts
      }
    } catch {
      // scope not found
    }
  }

  const scopeCount = scopeTotalCount - sessionCount
  const scopeChatCount = scopeCount - scopeDocumentCount

  const byType: Record<string, number> = {}
  for (const [t, c] of Object.entries(userByType)) byType[t] = (byType[t] ?? 0) + c
  for (const [t, c] of Object.entries(scopeByType)) byType[t] = (byType[t] ?? 0) + c

  return { userCount, scopeCount, scopeChatCount, scopeDocumentCount, sessionCount, byType }
}

// ─── Resolve + Ref Stats ───

export async function resolveMemoryIds(
  byLayer: MemoryIdsByLayer,
  scope?: string
): Promise<Record<string, MemoryItem | null>> {
  const result: Record<string, MemoryItem | null> = {}
  const allIds = [...byLayer.user, ...byLayer.scope, ...byLayer.session]
  for (const id of allIds) result[id] = null

  if (byLayer.user.length > 0) {
    try {
      const placeholders = byLayer.user.map(() => '?').join(',')
      const rows = await getUserManagers().memory.storage.relational.query(
        `SELECT * FROM memories WHERE id IN (${placeholders})`,
        byLayer.user
      )
      for (const r of rows) {
        result[r.id] = mapRowToMemoryItem(r)
      }
    } catch {
      // user managers not initialized
    }
  }

  const scopeIds = [...byLayer.scope, ...byLayer.session]
  if (scopeIds.length > 0 && scope) {
    try {
      const placeholders = scopeIds.map(() => '?').join(',')
      const rows = await getScopeManagers(scope).scopeOnlyMemory.storage.relational.query(
        `SELECT * FROM memories WHERE id IN (${placeholders})`,
        scopeIds
      )
      for (const r of rows) {
        result[r.id] = mapRowToMemoryItem(r)
      }
    } catch {
      // scope not found
    }
  }

  return result
}

export async function updateMemoryRefStats(
  byLayer: MemoryIdsByLayer,
  scope?: string
): Promise<void> {
  const now = new Date().toISOString()

  const updateSql = `UPDATE memories SET metadata = json_set(
    COALESCE(metadata, '{}'),
    '$.ref_count', COALESCE(json_extract(metadata, '$.ref_count'), 0) + 1,
    '$.last_ref_at', ?
  ) WHERE id = ?`

  type StoreWithRun = { run?(sql: string, params?: unknown[]): Promise<void> }

  if (byLayer.user.length > 0) {
    try {
      const store = getUserManagers().memory.storage.relational
      const run = (store as StoreWithRun).run?.bind(store)
      for (const id of byLayer.user) {
        if (run) await run(updateSql, [now, id])
        else await store.query(updateSql, [now, id])
      }
    } catch (e) {
      log.warn('updateMemoryRefStats user failed:', e)
    }
  }

  const scopeIds = [...byLayer.scope, ...byLayer.session]
  if (scopeIds.length > 0 && scope) {
    try {
      const store = getScopeManagers(scope).scopeOnlyMemory.storage.relational
      const run = (store as StoreWithRun).run?.bind(store)
      for (const id of scopeIds) {
        if (run) await run(updateSql, [now, id])
        else await store.query(updateSql, [now, id])
      }
    } catch (e) {
      log.warn('updateMemoryRefStats scope failed:', e)
    }
  }
}

// ─── Dedup Log ───

export async function listDedupLog(scope: string, limit?: number): Promise<DedupLogEntry[]> {
  const effectiveLimit = limit ?? 50
  try {
    const scopeEntries = await getScopeManagers(scope).scopeOnlyMemory.listDedupLog(
      DEFAULT_USER_ID,
      effectiveLimit
    )

    let userEntries: DedupLogEntry[] = []
    try {
      userEntries = await getUserManagers().memory.listDedupLog(DEFAULT_USER_ID, effectiveLimit)
    } catch {
      // user managers not initialized
    }

    if (userEntries.length === 0) return scopeEntries
    if (scopeEntries.length === 0) return userEntries

    const seen = new Set<string>()
    const merged: DedupLogEntry[] = []
    for (const entry of [...scopeEntries, ...userEntries]) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      merged.push(entry)
    }
    merged.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    return merged.slice(0, effectiveLimit)
  } catch (e) {
    log.error('listDedupLog error:', e)
    return []
  }
}

export async function undoDedupLog(dedupLogId: string, scope: string): Promise<string | null> {
  try {
    const scopeResult = await getScopeManagers(scope).scopeOnlyMemory.undoDedup(dedupLogId)
    if (scopeResult) return scopeResult

    try {
      const userResult = await getUserManagers().memory.undoDedup(dedupLogId)
      if (userResult) return userResult
    } catch {
      // user managers not initialized
    }

    return null
  } catch (e) {
    log.error('undoDedupLog error:', e)
    return null
  }
}
