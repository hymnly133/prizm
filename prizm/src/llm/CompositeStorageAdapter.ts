/**
 * 复合存储适配器 - 按 group_id 路由到用户级或 scope 级 DB
 *
 * 写入路由：
 *   PROFILE (group_id="user") -> userStorage
 *   其余 (scope/scope:session:x) -> scopeStorage
 *
 * 读取路由：
 *   能推断 group_id 时按 group_id 路由到对应 DB
 *   无法推断时合并两个 DB 的结果并按 id 去重
 *
 * 注意：对于纯列表查询（如 listMemories），建议外部直接使用
 * scopeOnlyMemory 或 userManagers 分别查询，而非依赖 composite 的
 * SQL 推断路由。composite 主要保证写入时的正确路由。
 */

import type { StorageAdapter, RelationalStoreAdapter, VectorStoreAdapter } from '@prizm/evermemos'
import { USER_GROUP_ID } from '@prizm/evermemos'

type DbTarget = 'user' | 'scope' | 'both'

function targetFromGroupId(groupId: string | null | undefined): DbTarget {
  if (groupId === USER_GROUP_ID) return 'user'
  if (groupId === undefined) return 'both'
  return 'scope'
}

/** 写入路由：group_id="user" → userStorage，其余 → scopeStorage */
function writeTargetFromGroupId(groupId: string | null | undefined): 'user' | 'scope' {
  if (groupId === USER_GROUP_ID) return 'user'
  return 'scope'
}

function pickRelationalForWrite(
  groupId: string | null | undefined,
  user: RelationalStoreAdapter,
  scope: RelationalStoreAdapter
): RelationalStoreAdapter {
  return writeTargetFromGroupId(groupId) === 'user' ? user : scope
}

function pickVector(
  groupId: string | null | undefined,
  user: VectorStoreAdapter,
  scope: VectorStoreAdapter
): VectorStoreAdapter {
  return writeTargetFromGroupId(groupId) === 'user' ? user : scope
}

/**
 * 从 SQL + params 推断 group_id，用于 query 路由：
 * - SQL 含 group_id 且 params 非空 → 取对应参数作为 group_id
 * - 其余 → 返回 undefined（无法推断，需查询两个 DB）
 */
function inferGroupIdFromQuery(sql: string, params?: any[]): string | null | undefined {
  const lower = sql.toLowerCase()
  if (!lower.includes('group_id')) return undefined
  if (!params || params.length === 0) return undefined
  const groupIdIdx = countPlaceholdersBefore(lower, 'group_id')
  if (groupIdIdx < params.length) {
    const val = params[groupIdIdx]
    return val === null ? null : val
  }
  return undefined
}

/** 计算 SQL 中 'group_id' 关键字前有多少个 '?' 占位符 */
function countPlaceholdersBefore(sql: string, keyword: string): number {
  const pos = sql.indexOf(keyword)
  if (pos < 0) return 0
  let count = 0
  for (let i = 0; i < pos; i++) {
    if (sql[i] === '?') count++
  }
  return count
}

/** 按 id 去重行记录 */
function deduplicateById(rows: any[]): any[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const id = r?.id
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function createCompositeStorageAdapter(
  userStorage: StorageAdapter,
  scopeStorage: StorageAdapter
): StorageAdapter {
  const relational: RelationalStoreAdapter = {
    async get(table: string, id: string) {
      const r = await userStorage.relational.get(table, id)
      if (r) return r
      return scopeStorage.relational.get(table, id)
    },

    async find(table: string, query: any) {
      const gid = query?.group_id
      const target = targetFromGroupId(gid)
      if (target === 'both') {
        const [a, b] = await Promise.all([
          userStorage.relational.find(table, query),
          scopeStorage.relational.find(table, query)
        ])
        return deduplicateById([...(a ?? []), ...(b ?? [])])
      }
      const store = target === 'user' ? userStorage.relational : scopeStorage.relational
      return store.find(table, query)
    },

    async insert(table: string, item: any) {
      const gid = item?.group_id
      const target = pickRelationalForWrite(gid, userStorage.relational, scopeStorage.relational)
      return target.insert(table, item)
    },

    async update(table: string, id: string, item: any) {
      const gid = item?.group_id
      const target = pickRelationalForWrite(gid, userStorage.relational, scopeStorage.relational)
      return target.update(table, id, item)
    },

    async delete(table: string, id: string) {
      try {
        await userStorage.relational.delete(table, id)
      } catch {
        await scopeStorage.relational.delete(table, id)
      }
    },

    async query(sql: string, params?: any[]) {
      const gid = inferGroupIdFromQuery(sql, params)
      const target = targetFromGroupId(gid)
      if (target === 'both') {
        const [a, b] = await Promise.all([
          userStorage.relational.query(sql, params ?? []),
          scopeStorage.relational.query(sql, params ?? [])
        ])
        return deduplicateById([...a, ...b])
      }
      const store = target === 'user' ? userStorage.relational : scopeStorage.relational
      return store.query(sql, params ?? [])
    }
  }

  const vector: VectorStoreAdapter = {
    async add(collection: string, items: any[]) {
      for (const item of items) {
        const gid = item?.group_id
        const target = pickVector(gid, userStorage.vector, scopeStorage.vector)
        await target.add(collection, [item])
      }
    },

    async search(collection: string, vectorArr: number[], limit: number, filter?: any) {
      const userResults = await userStorage.vector.search(collection, vectorArr, limit, filter)
      const scopeResults = await scopeStorage.vector.search(collection, vectorArr, limit, filter)
      return [...userResults, ...scopeResults]
        .sort((a, b) => (a._distance ?? 1) - (b._distance ?? 1))
        .slice(0, limit)
    },

    async delete(collection: string, id: string) {
      try {
        await userStorage.vector.delete(collection, id)
      } catch {
        await scopeStorage.vector.delete(collection, id)
      }
    }
  }

  return { relational, vector }
}
