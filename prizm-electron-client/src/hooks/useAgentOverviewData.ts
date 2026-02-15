/**
 * Shared data hook for Agent overview / sidebar
 * Fetches scope-level stats: context, documents, memories, models, session count
 */
import { useState, useCallback, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from './useScope'
import type { Document, AvailableModel } from '@prizm/client-core'
import type { MemoryItem } from '@prizm/shared'

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
  threeLevelMemories: { user: MemoryItem[]; scope: MemoryItem[]; session: MemoryItem[] } | null
  threeLevelLoading: boolean
  loadThreeLevelMemories: () => Promise<void>
  sessionsCount: number
  sessionsCountLoading: boolean
  loadSessionsCount: () => Promise<void>
  http: ReturnType<
    NonNullable<ReturnType<typeof usePrizmContext>['manager']>['getHttpClient']
  > | null
}

export function useAgentOverviewData(sessionId?: string): AgentOverviewData {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null

  const [scopeContext, setScopeContext] = useState('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [threeLevelMemories, setThreeLevelMemories] = useState<{
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null>(null)
  const [threeLevelLoading, setThreeLevelLoading] = useState(false)
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

  const loadThreeLevelMemories = useCallback(async () => {
    if (!http || !currentScope) return
    setThreeLevelLoading(true)
    try {
      const res = await http.getThreeLevelMemories(currentScope, sessionId)
      if (res.enabled) {
        setThreeLevelMemories({ user: res.user, scope: res.scope, session: res.session })
      } else {
        setThreeLevelMemories(null)
      }
    } catch {
      setThreeLevelMemories(null)
    } finally {
      setThreeLevelLoading(false)
    }
  }, [http, currentScope, sessionId])

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
    void loadThreeLevelMemories()
    void loadSessionsCount()
  }, [loadScopeContext, loadDocuments, loadModels, loadThreeLevelMemories, loadSessionsCount])

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
    threeLevelMemories,
    threeLevelLoading,
    loadThreeLevelMemories,
    sessionsCount,
    sessionsCountLoading,
    loadSessionsCount,
    http
  }
}
