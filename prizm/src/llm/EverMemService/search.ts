/**
 * EverMemService 记忆检索函数
 */

import {
  MemoryType,
  getLayerForType,
  DEFAULT_USER_ID,
  USER_GROUP_ID,
  RetrieveMethod,
  RetrievalManager
} from '@prizm/evermemos'
import {
  getUserManagers,
  getScopeManagers,
  mapRowToMemoryItem,
  mergeAndDedup
} from './_state'
import type { MemoryItem } from '@prizm/shared'

export interface MemorySearchOptions {
  method?: RetrieveMethod
  use_rerank?: boolean
  limit?: number
  memory_types?: MemoryType[]
}

const INJECT_PROFILE_LIMIT = 10
const INJECT_USER_LIMIT = 3
const INJECT_SCOPE_LIMIT = 5
const INJECT_SESSION_LIMIT = 5

export async function listAllUserProfiles(
  limit: number = INJECT_PROFILE_LIMIT
): Promise<MemoryItem[]> {
  const manager = getUserManagers().memory
  const rows = await manager.listMemories(DEFAULT_USER_ID, 200)
  const profileRows = rows.filter((r: any) => r.type === MemoryType.PROFILE)
  return profileRows.slice(0, limit).map(mapRowToMemoryItem)
}

export async function searchUserMemories(
  query: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  return doSearchWithManager(getUserManagers().retrieval, query, DEFAULT_USER_ID, USER_GROUP_ID, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.PROFILE]
  })
}

export async function searchScopeMemories(
  query: string,
  scope: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const retrieval = getScopeManagers(scope).retrieval
  const defaultTypes = [MemoryType.NARRATIVE, MemoryType.FORESIGHT, MemoryType.DOCUMENT]
  return doSearchWithManager(retrieval, query, DEFAULT_USER_ID, scope, {
    ...options,
    memory_types: options?.memory_types ?? defaultTypes
  })
}

export async function searchSessionMemories(
  query: string,
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const groupId = `${scope}:session:${sessionId}`
  return doSearchWithManager(getScopeManagers(scope).retrieval, query, DEFAULT_USER_ID, groupId, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.EVENT_LOG]
  })
}

export async function searchMemories(query: string): Promise<MemoryItem[]> {
  return doSearchWithManager(getUserManagers().retrieval, query, DEFAULT_USER_ID)
}

export async function searchMemoriesWithOptions(
  query: string,
  scope?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const userResults = await doSearchWithManager(
    getUserManagers().retrieval,
    query,
    DEFAULT_USER_ID,
    undefined,
    options
  )
  if (!scope) return userResults
  try {
    const scopeResults = await doSearchWithManager(
      getScopeManagers(scope).retrieval,
      query,
      DEFAULT_USER_ID,
      undefined,
      options
    )
    return mergeAndDedup([...userResults, ...scopeResults])
  } catch {
    return userResults
  }
}

export async function searchUserAndScopeMemories(
  query: string,
  scope: string,
  options?: MemorySearchOptions
): Promise<{ user: MemoryItem[]; scope: MemoryItem[] }> {
  const [userMem, scopeMem] = await Promise.all([
    searchUserMemories(query, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, scope, {
      ...options,
      limit: options?.limit ?? INJECT_SCOPE_LIMIT
    })
  ])
  return { user: userMem, scope: scopeMem }
}

export async function searchThreeLevelMemories(
  query: string,
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<{
  user: MemoryItem[]
  scope: MemoryItem[]
  session: MemoryItem[]
}> {
  const [userMem, scopeMem, sessionMem] = await Promise.all([
    searchUserMemories(query, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, scope, {
      ...options,
      limit: options?.limit ?? INJECT_SCOPE_LIMIT
    }),
    searchSessionMemories(query, scope, sessionId, {
      ...options,
      limit: options?.limit ?? INJECT_SESSION_LIMIT
    })
  ])
  return { user: userMem, scope: scopeMem, session: sessionMem }
}

async function doSearchWithManager(
  retrieval: RetrievalManager,
  query: string,
  userId = DEFAULT_USER_ID,
  groupId?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const results = await retrieval.retrieve({
    query,
    user_id: userId,
    group_id: groupId,
    method: options?.method ?? RetrieveMethod.HYBRID,
    use_rerank: options?.use_rerank,
    limit: options?.limit ?? 20,
    memory_types: options?.memory_types
  })
  return results.map((r) => ({
    id: r.id,
    memory: r.content ?? '',
    user_id: userId,
    group_id: r.group_id ?? undefined,
    memory_type: r.type,
    memory_layer: getLayerForType(r.type),
    source_type: r.source_type ?? undefined,
    sub_type: r.sub_type ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    metadata: r.metadata,
    score: r.score
  }))
}
