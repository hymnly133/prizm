/**
 * Shared data hook for Agent overview / sidebar
 * 从 scopeDataStore 读取 documents/memoryCounts，不再独立拉取。
 * 仅独立获取 scopeContext 和 models（这些是侧边栏专用，不属于 scope 级共享数据）。
 */
import { useState, useCallback, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from './useScope'
import { useScopeStats, type MemoryCountsByType } from './useScopeStats'
import { useScopeDataStore } from '../store/scopeDataStore'
import type { EnrichedDocument, AvailableModel } from '@prizm/client-core'

export interface AgentOverviewData {
  currentScope: string
  scopeContext: string
  scopeContextLoading: boolean
  loadScopeContext: () => Promise<void>
  documents: EnrichedDocument[]
  documentsLoading: boolean
  loadDocuments: () => Promise<void>
  models: AvailableModel[]
  defaultModel: string
  memoryEnabled: boolean
  userMemoryCount: number
  scopeMemoryCount: number
  sessionMemoryCount: number
  documentMemoryCount: number
  memoryByType: MemoryCountsByType
  memoryCountsLoading: boolean
  loadMemoryCounts: () => void
  sessionsCount: number
  sessionsCountLoading: boolean
  loadSessionsCount: () => void
  http: ReturnType<
    NonNullable<ReturnType<typeof usePrizmContext>['manager']>['getHttpClient']
  > | null
}

export function useAgentOverviewData(): AgentOverviewData {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null
  const { stats, loading: statsLoading, refresh: refreshStats } = useScopeStats()

  const documents = useScopeDataStore((s) => s.documents)
  const documentsLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  const [scopeContext, setScopeContext] = useState('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState('')

  const loadScopeContext = useCallback(async () => {
    if (!http || !currentScope) return
    setScopeContextLoading(true)
    try {
      const res = await http.getAgentScopeContext(currentScope)
      setScopeContext(res.summary || '')
    } catch {
      setScopeContext('')
    } finally {
      setScopeContextLoading(false)
    }
  }, [http, currentScope])

  const loadDocuments = useCallback(async () => {
    await refreshDocuments()
  }, [refreshDocuments])

  const loadModels = useCallback(async () => {
    if (!http) return
    try {
      const [modelsRes, tools] = await Promise.all([http.getAgentModels(), http.getAgentTools()])
      setModels(modelsRes.models ?? [])
      setDefaultModel(tools.agent?.defaultModel ?? '')
    } catch {
      setModels([])
      setDefaultModel('')
    }
  }, [http])

  useEffect(() => {
    void loadScopeContext()
    void loadModels()
  }, [loadScopeContext, loadModels])

  return {
    currentScope,
    scopeContext,
    scopeContextLoading,
    loadScopeContext,
    documents,
    documentsLoading,
    loadDocuments,
    models,
    defaultModel,
    memoryEnabled: stats.memoryEnabled,
    userMemoryCount: stats.userMemoryCount,
    scopeMemoryCount: stats.scopeMemoryCount,
    sessionMemoryCount: stats.sessionMemoryCount,
    documentMemoryCount: stats.documentMemoryCount,
    memoryByType: stats.memoryByType,
    memoryCountsLoading: statsLoading,
    loadMemoryCounts: refreshStats,
    sessionsCount: stats.sessionsCount,
    sessionsCountLoading: statsLoading,
    loadSessionsCount: refreshStats,
    http
  }
}
