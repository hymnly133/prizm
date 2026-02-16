/**
 * useHomeData - 聚合主页所需的 sessions、todos、documents、clipboard、stats 数据
 * 内部组合 useScope、useFileList、useAgentOverviewData，并独立拉取 sessions 和 clipboard
 */
import { useState, useCallback, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from './useScope'
import { useFileList } from './useFileList'
import { useAgentOverviewData } from './useAgentOverviewData'
import type { AgentSession, ClipboardItem } from '@prizm/client-core'

export interface HomeData {
  /** Scope 相关 */
  currentScope: string
  scopes: string[]
  scopesLoading: boolean
  getScopeLabel: (scopeId: string) => string
  setScope: (scope: string) => void

  /** 最近会话 */
  sessions: AgentSession[]
  sessionsLoading: boolean
  refreshSessions: () => Promise<void>

  /** 文件列表（todos + documents），来自 useFileList */
  fileList: ReturnType<typeof useFileList>['fileList']
  fileListLoading: boolean

  /** 剪贴板历史 */
  clipboard: ClipboardItem[]
  clipboardLoading: boolean

  /** 统计概览（来自 useAgentOverviewData） */
  stats: {
    sessionsCount: number
    documentsCount: number
    userMemoryCount: number
    scopeMemoryCount: number
    memoryEnabled: boolean
  }
  statsLoading: boolean

  /** 刷新所有主页数据 */
  refreshAll: () => void
}

export function useHomeData(): HomeData {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null
  const { currentScope, scopes, scopesLoading, getScopeLabel, setScope } = useScope()
  const { fileList, fileListLoading } = useFileList(currentScope)
  const overview = useAgentOverviewData()

  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [clipboard, setClipboard] = useState<ClipboardItem[]>([])
  const [clipboardLoading, setClipboardLoading] = useState(false)

  const refreshSessions = useCallback(async () => {
    if (!http || !currentScope) return
    setSessionsLoading(true)
    try {
      const list = await http.listAgentSessions(currentScope)
      setSessions(list ?? [])
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [http, currentScope])

  const refreshClipboard = useCallback(async () => {
    if (!http || !currentScope) return
    setClipboardLoading(true)
    try {
      const items = await http.getClipboardHistory({ limit: 5, scope: currentScope })
      setClipboard(items ?? [])
    } catch {
      setClipboard([])
    } finally {
      setClipboardLoading(false)
    }
  }, [http, currentScope])

  useEffect(() => {
    void refreshSessions()
    void refreshClipboard()
  }, [refreshSessions, refreshClipboard])

  const refreshAll = useCallback(() => {
    void refreshSessions()
    void refreshClipboard()
    void overview.loadScopeContext()
    void overview.loadDocuments()
    void overview.loadMemoryCounts()
    void overview.loadSessionsCount()
  }, [refreshSessions, refreshClipboard, overview])

  const statsLoading =
    overview.sessionsCountLoading || overview.documentsLoading || overview.memoryCountsLoading

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
    stats: {
      sessionsCount: overview.sessionsCount,
      documentsCount: overview.documents.length,
      userMemoryCount: overview.userMemoryCount,
      scopeMemoryCount: overview.scopeMemoryCount,
      memoryEnabled: overview.memoryEnabled
    },
    statsLoading,
    refreshAll
  }
}
