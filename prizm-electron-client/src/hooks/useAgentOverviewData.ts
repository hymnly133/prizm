/**
 * Shared data hook for Agent overview / sidebar
 * Fetches scope-level stats: context, documents, memories, models, session count
 */
import { useState, useCallback, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from './useScope'
import type { Document, AvailableModel } from '@prizm/client-core'

export interface AgentOverviewData {
  currentScope: string
  scopeContext: string
  scopeContextLoading: boolean
  loadScopeContext: () => Promise<void>
  documents: Document[]
  documentsLoading: boolean
  loadDocuments: () => Promise<void>
  models: AvailableModel[]
  defaultModel: string
  /** 记忆模块是否启用 */
  memoryEnabled: boolean
  /** User 层记忆总数 */
  userMemoryCount: number
  /** Scope 层记忆总数 */
  scopeMemoryCount: number
  memoryCountsLoading: boolean
  loadMemoryCounts: () => Promise<void>
  sessionsCount: number
  sessionsCountLoading: boolean
  loadSessionsCount: () => Promise<void>
  http: ReturnType<
    NonNullable<ReturnType<typeof usePrizmContext>['manager']>['getHttpClient']
  > | null
}

export function useAgentOverviewData(): AgentOverviewData {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null

  const [scopeContext, setScopeContext] = useState('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [userMemoryCount, setUserMemoryCount] = useState(0)
  const [scopeMemoryCount, setScopeMemoryCount] = useState(0)
  const [memoryCountsLoading, setMemoryCountsLoading] = useState(false)
  const [sessionsCount, setSessionsCount] = useState(0)
  const [sessionsCountLoading, setSessionsCountLoading] = useState(false)

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
    if (!http || !currentScope) return
    setDocumentsLoading(true)
    try {
      const docs = await http.listDocuments({ scope: currentScope })
      setDocuments(docs || [])
    } catch {
      setDocuments([])
    } finally {
      setDocumentsLoading(false)
    }
  }, [http, currentScope])

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

  const loadMemoryCounts = useCallback(async () => {
    if (!http || !currentScope) return
    setMemoryCountsLoading(true)
    try {
      const res = await http.getMemoryCounts(currentScope)
      setMemoryEnabled(res.enabled)
      setUserMemoryCount(res.userCount)
      setScopeMemoryCount(res.scopeCount)
    } catch {
      setMemoryEnabled(false)
      setUserMemoryCount(0)
      setScopeMemoryCount(0)
    } finally {
      setMemoryCountsLoading(false)
    }
  }, [http, currentScope])

  const loadSessionsCount = useCallback(async () => {
    if (!http || !currentScope) return
    setSessionsCountLoading(true)
    try {
      const list = await http.listAgentSessions(currentScope)
      setSessionsCount(list?.length ?? 0)
    } catch {
      setSessionsCount(0)
    } finally {
      setSessionsCountLoading(false)
    }
  }, [http, currentScope])

  useEffect(() => {
    void loadScopeContext()
    void loadDocuments()
    void loadModels()
    void loadMemoryCounts()
    void loadSessionsCount()
  }, [loadScopeContext, loadDocuments, loadModels, loadMemoryCounts, loadSessionsCount])

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
    memoryEnabled,
    userMemoryCount,
    scopeMemoryCount,
    memoryCountsLoading,
    loadMemoryCounts,
    sessionsCount,
    sessionsCountLoading,
    loadSessionsCount,
    http
  }
}
