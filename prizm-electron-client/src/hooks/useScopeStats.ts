/**
 * useScopeStats — 统一 scope 级统计获取
 *
 * 现在从 scopeDataStore 派生，不再独立发起 API 请求。
 * 保持原有接口不变，消费者无需修改。
 */
import { useMemo, useCallback } from 'react'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useAgentSessionStore } from '../store/agentSessionStore'

/** 按类型分组的记忆计数（键为 MemoryType 枚举值） */
export interface MemoryCountsByType {
  [key: string]: number
  profile: number
  narrative: number
  foresight: number
  document: number
  event_log: number
}

export interface ScopeStats {
  sessionsCount: number
  documentsCount: number
  userMemoryCount: number
  scopeMemoryCount: number
  sessionMemoryCount: number
  documentMemoryCount: number
  memoryEnabled: boolean
  /** 按类型细分的记忆计数 */
  memoryByType: MemoryCountsByType
}

export interface ScopeStatsResult {
  stats: ScopeStats
  loading: boolean
  refresh: () => void
}

const EMPTY_MEMORY_BY_TYPE: MemoryCountsByType = {
  profile: 0,
  narrative: 0,
  foresight: 0,
  document: 0,
  event_log: 0
}

function parseByType(raw: Record<string, number> | undefined): MemoryCountsByType {
  if (!raw) return EMPTY_MEMORY_BY_TYPE
  return {
    profile: raw['profile'] ?? 0,
    narrative: raw['narrative'] ?? 0,
    foresight: raw['foresight'] ?? 0,
    document: raw['document'] ?? 0,
    event_log: raw['event_log'] ?? 0
  }
}

export function useScopeStats(): ScopeStatsResult {
  const documents = useScopeDataStore((s) => s.documents)
  const sessions = useAgentSessionStore((s) => s.sessions)
  const memoryCounts = useScopeDataStore((s) => s.memoryCounts)
  const documentsLoading = useScopeDataStore((s) => s.documentsLoading)
  const sessionsLoading = useAgentSessionStore((s) => s.loading)
  const memoryCountsLoading = useScopeDataStore((s) => s.memoryCountsLoading)
  const refreshAll = useScopeDataStore((s) => s.refreshAll)

  const loading = documentsLoading || sessionsLoading || memoryCountsLoading

  const stats = useMemo<ScopeStats>(
    () => ({
      sessionsCount: sessions.length,
      documentsCount: documents.length,
      userMemoryCount: memoryCounts.userCount,
      scopeMemoryCount: memoryCounts.scopeCount,
      sessionMemoryCount: memoryCounts.sessionCount,
      documentMemoryCount: memoryCounts.documentCount,
      memoryEnabled: memoryCounts.enabled,
      memoryByType: parseByType(memoryCounts.byType)
    }),
    [sessions.length, documents.length, memoryCounts]
  )

  const refresh = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  return { stats, loading, refresh }
}
