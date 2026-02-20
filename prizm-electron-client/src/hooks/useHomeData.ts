/**
 * useHomeData - 聚合主页所需的 sessions、todos、documents、clipboard、stats 数据
 * sessions 和 clipboard 均从 scopeDataStore 读取（不再独立拉取）
 */
import { useCallback } from 'react'
import { useScope } from './useScope'
import { useFileList } from './useFileList'
import { useScopeStats, type MemoryCountsByType } from './useScopeStats'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useAgentSessionStore } from '../store/agentSessionStore'
import type { EnrichedSession, ClipboardItem } from '@prizm/client-core'

export interface HomeData {
  currentScope: string
  scopes: string[]
  scopesLoading: boolean
  getScopeLabel: (scopeId: string) => string
  setScope: (scope: string) => void

  sessions: EnrichedSession[]
  sessionsLoading: boolean
  refreshSessions: () => Promise<void>

  fileList: ReturnType<typeof useFileList>['fileList']
  fileListLoading: boolean

  clipboard: ClipboardItem[]
  clipboardLoading: boolean

  stats: {
    sessionsCount: number
    documentsCount: number
    userMemoryCount: number
    scopeMemoryCount: number
    scopeChatMemoryCount: number
    scopeDocumentMemoryCount: number
    sessionMemoryCount: number
    memoryEnabled: boolean
    memoryByType: MemoryCountsByType
  }
  statsLoading: boolean

  refreshAll: () => void
}

export function useHomeData(): HomeData {
  const { currentScope, scopes, scopesLoading, getScopeLabel, setScope } = useScope()
  const { fileList, fileListLoading } = useFileList(currentScope)
  const {
    stats: scopeStats,
    loading: scopeStatsLoading,
    refresh: refreshScopeStats
  } = useScopeStats()

  const sessions = useAgentSessionStore((s) => s.sessions)
  const sessionsLoading = useAgentSessionStore((s) => s.loading)
  const clipboard = useScopeDataStore((s) => s.clipboard)
  const clipboardLoading = useScopeDataStore((s) => s.clipboardLoading)

  const refreshSessions = useCallback(async () => {
    await useAgentSessionStore.getState().refreshSessions(currentScope)
  }, [currentScope])

  const storeRefreshAll = useScopeDataStore((s) => s.refreshAll)

  const refreshAll = useCallback(() => {
    void storeRefreshAll()
    void useAgentSessionStore.getState().refreshSessions(currentScope)
    refreshScopeStats()
  }, [storeRefreshAll, currentScope, refreshScopeStats])

  return {
    currentScope,
    scopes,
    scopesLoading,
    getScopeLabel,
    setScope,
    sessions,
    sessionsLoading,
    refreshSessions,
    fileList,
    fileListLoading,
    clipboard,
    clipboardLoading,
    stats: scopeStats,
    statsLoading: scopeStatsLoading,
    refreshAll
  }
}
