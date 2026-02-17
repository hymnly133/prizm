/**
 * Agent 右侧边栏 - 总览模式显示 scope 统计；会话模式显示状态、活动、记忆
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import type {
  Document,
  AgentSession,
  AgentMessage,
  ToolCallRecord,
  AvailableModel
} from '@prizm/client-core'
import { getToolCalls } from '@prizm/client-core'
import type { ActivityItem, SessionStats } from './agent/agentSidebarTypes'
import { AgentOverviewSidebar } from './agent/AgentOverviewSidebar'
import { AgentSessionSidebar } from './agent/AgentSessionSidebar'

interface AgentRightSidebarProps {
  sending?: boolean
  error?: string | null
  currentSession?: AgentSession | null
  optimisticMessages?: AgentMessage[]
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
  overviewMode?: boolean
}

export function AgentRightSidebar({
  sending,
  error,
  currentSession,
  optimisticMessages = [],
  selectedModel,
  onModelChange,
  overviewMode
}: AgentRightSidebarProps) {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()

  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [scopeContext, setScopeContext] = useState<string>('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [sessionContext, setSessionContext] = useState<{
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null>(null)
  const [sessionContextLoading, setSessionContextLoading] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [userMemoryCount, setUserMemoryCount] = useState(0)
  const [scopeMemoryCount, setScopeMemoryCount] = useState(0)
  const [memoryCountsLoading, setMemoryCountsLoading] = useState(false)
  const [sessionsCount, setSessionsCount] = useState(0)
  const [sessionsCountLoading, setSessionsCountLoading] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  const [sessionStatsLoading, setSessionStatsLoading] = useState(false)

  const loadSystemPrompt = useCallback(async () => {
    if (!http || !currentScope) return
    setSystemPromptLoading(true)
    try {
      const res = await http.getAgentSystemPrompt(currentScope, currentSession?.id)
      setSystemPrompt(res.systemPrompt || '')
    } catch {
      setSystemPrompt('')
    } finally {
      setSystemPromptLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

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

  const loadSessionContext = useCallback(async () => {
    if (!http || !currentScope || !currentSession?.id) return
    setSessionContextLoading(true)
    try {
      const ctx = await http.getAgentSessionContext(currentSession.id, currentScope)
      setSessionContext({
        provisions: ctx.provisions ?? [],
        activities: ctx.activities ?? []
      })
    } catch {
      setSessionContext(null)
    } finally {
      setSessionContextLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  const loadSessionStats = useCallback(async () => {
    if (!http || !currentScope || !currentSession?.id) return
    setSessionStatsLoading(true)
    try {
      const stats = await http.getAgentSessionStats(currentSession.id, currentScope)
      setSessionStats(stats)
    } catch {
      setSessionStats(null)
    } finally {
      setSessionStatsLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  useEffect(() => {
    void loadScopeContext()
    void loadDocuments()
    void loadSystemPrompt()
  }, [loadScopeContext, loadDocuments, loadSystemPrompt])

  useEffect(() => {
    if (currentSession?.id && currentScope) {
      void loadSessionContext()
      void loadSessionStats()
    } else {
      setSessionContext(null)
      setSessionStats(null)
    }
  }, [currentSession?.id, currentScope, loadSessionContext, loadSessionStats])

  useEffect(() => {
    if (currentScope) void loadMemoryCounts()
  }, [currentScope, loadMemoryCounts])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (overviewMode) void loadSessionsCount()
  }, [overviewMode, loadSessionsCount])

  const prevSendingRef = useRef(sending)
  useEffect(() => {
    if (prevSendingRef.current && !sending && currentSession?.id) {
      void loadSessionContext()
      void loadMemoryCounts()
      void loadSessionStats()
    }
    prevSendingRef.current = sending
  }, [sending, currentSession?.id, loadSessionContext, loadMemoryCounts, loadSessionStats])

  const latestToolCalls: ToolCallRecord[] = useMemo(() => {
    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...(currentSession?.messages ?? []),
      ...optimisticMessages
    ]
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return []
    return getToolCalls(lastAssistant).filter(
      (t): t is ToolCallRecord =>
        t != null &&
        typeof t === 'object' &&
        typeof (t as ToolCallRecord).id === 'string' &&
        typeof (t as ToolCallRecord).name === 'string' &&
        typeof (t as ToolCallRecord).result === 'string'
    )
  }, [currentSession?.messages, optimisticMessages])

  const provisionsSummary = useMemo(() => {
    const provisions = sessionContext?.provisions ?? []
    if (provisions.length === 0) return null
    const byKind: Record<string, number> = {}
    for (const p of provisions) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1
    }
    const parts = Object.entries(byKind).map(([k, n]) => `${k} x${n}`)
    return `引用了 ${provisions.length} 项 (${parts.join(', ')})`
  }, [sessionContext?.provisions])

  const isNewConversationReady = !overviewMode && !currentSession

  return (
    <aside className="agent-right-sidebar">
      <div className="agent-right-sidebar-header">
        <span className="agent-right-sidebar-title">
          {overviewMode ? '工作区总览' : isNewConversationReady ? '新对话' : 'Agent 状态'}
        </span>
      </div>

      <div className="agent-right-sidebar-body">
        {overviewMode ? (
          <AgentOverviewSidebar
            currentScope={currentScope ?? ''}
            models={models}
            defaultModel={defaultModel}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            scopeContext={scopeContext}
            scopeContextLoading={scopeContextLoading}
            onRefreshScopeContext={loadScopeContext}
            contextModalOpen={contextModalOpen}
            onContextModalOpenChange={setContextModalOpen}
            documents={documents}
            documentsLoading={documentsLoading}
            onRefreshDocuments={loadDocuments}
            sessionsCount={sessionsCount}
            sessionsCountLoading={sessionsCountLoading}
            memoryEnabled={memoryEnabled}
            userMemoryCount={userMemoryCount}
            scopeMemoryCount={scopeMemoryCount}
            memoryCountsLoading={memoryCountsLoading}
          />
        ) : (
          <AgentSessionSidebar
            sending={!!sending}
            error={error ?? null}
            currentSession={currentSession ?? null}
            isNewConversationReady={isNewConversationReady}
            models={models}
            defaultModel={defaultModel}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            systemPrompt={systemPrompt}
            systemPromptLoading={systemPromptLoading}
            onSystemPromptModalOpenChange={setSystemPromptModalOpen}
            systemPromptModalOpen={systemPromptModalOpen}
            sessionContext={sessionContext}
            sessionContextLoading={sessionContextLoading}
            latestToolCalls={latestToolCalls}
            provisionsSummary={provisionsSummary}
            sessionStats={sessionStats}
            sessionStatsLoading={sessionStatsLoading}
            memoryEnabled={memoryEnabled}
            userMemoryCount={userMemoryCount}
            scopeMemoryCount={scopeMemoryCount}
            memoryCountsLoading={memoryCountsLoading}
          />
        )}
      </div>
    </aside>
  )
}
