/**
 * Agent 右侧边栏 - 总览模式显示 scope 统计；会话模式显示状态、活动、记忆
 *
 * documents/memoryCounts 从 scopeDataStore 读取；sessions 从 agentSessionStore 读取。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useAgentSessionStore } from '../store/agentSessionStore'
import type {
  EnrichedSession,
  AgentMessage,
  ToolCallRecord,
  AvailableModel,
  ResourceLockInfo
} from '@prizm/client-core'
import { getToolCalls } from '@prizm/client-core'
import type { ActivityItem, SessionStats } from './agent/agentSidebarTypes'
import { AgentOverviewSidebar } from './agent/AgentOverviewSidebar'
import { AgentSessionSidebar } from './agent/AgentSessionSidebar'

interface AgentRightSidebarProps {
  sending?: boolean
  error?: string | null
  currentSession?: EnrichedSession | null
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

  // --- 从 scopeDataStore 读取共享数据 ---
  const documents = useScopeDataStore((s) => s.documents)
  const documentsLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)
  const memoryCounts = useScopeDataStore((s) => s.memoryCounts)
  const memoryCountsLoading = useScopeDataStore((s) => s.memoryCountsLoading)
  const refreshMemoryCounts = useScopeDataStore((s) => s.refreshMemoryCounts)
  const sessions = useAgentSessionStore((s) => s.sessions)
  const sessionsLoading = useAgentSessionStore((s) => s.loading)

  // --- 侧边栏独有状态 ---
  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [scopeContext, setScopeContext] = useState<string>('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [sessionContext, setSessionContext] = useState<{
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null>(null)
  const [sessionContextLoading, setSessionContextLoading] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  const [sessionStatsLoading, setSessionStatsLoading] = useState(false)

  const sessionLocks = useMemo(() => currentSession?.heldLocks ?? [], [currentSession?.heldLocks])

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
    void loadSystemPrompt()
  }, [loadScopeContext, loadSystemPrompt])

  useEffect(() => {
    if (currentSession?.id && currentScope) {
      const _t0 = performance.now()
      console.debug(
        `[perf] RightSidebar: session changed → firing loadSessionContext + loadSessionStats`,
        { sessionId: currentSession.id.slice(0, 8) }
      )
      void loadSessionContext().then(() =>
        console.debug(
          `[perf] RightSidebar loadSessionContext done %c${(performance.now() - _t0).toFixed(1)}ms`,
          'color:#795548;font-weight:bold'
        )
      )
      void loadSessionStats().then(() =>
        console.debug(
          `[perf] RightSidebar loadSessionStats done %c${(performance.now() - _t0).toFixed(1)}ms`,
          'color:#607D8B;font-weight:bold'
        )
      )
    } else {
      setSessionContext(null)
      setSessionStats(null)
    }
  }, [currentSession?.id, currentScope, loadSessionContext, loadSessionStats])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const prevSendingRef = useRef(sending)
  useEffect(() => {
    if (prevSendingRef.current && !sending && currentSession?.id) {
      void loadSessionContext()
      void refreshMemoryCounts()
      void loadSessionStats()
      void refreshDocuments()
    }
    prevSendingRef.current = sending
  }, [
    sending,
    currentSession?.id,
    loadSessionContext,
    refreshMemoryCounts,
    loadSessionStats,
    refreshDocuments
  ])

  const latestToolCalls: ToolCallRecord[] = useMemo(() => {
    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...(currentSession?.messages ?? []),
      ...optimisticMessages
    ]
    const lastAssistant = messages.findLast((m) => m.role === 'assistant')
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

  const scopeDocLocks = useMemo(
    () => documents.filter((d) => d.lockInfo).map((d) => d.lockInfo!),
    [documents]
  )

  const scopeLocksByDoc = useMemo(() => {
    const map = new Map<string, ResourceLockInfo>()
    for (const doc of documents) {
      if (doc.lockInfo) {
        map.set(doc.id, doc.lockInfo)
      }
    }
    return map
  }, [documents])

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
            onRefreshDocuments={refreshDocuments}
            sessionsCount={sessions.length}
            sessionsCountLoading={sessionsLoading}
            memoryEnabled={memoryCounts.enabled}
            userMemoryCount={memoryCounts.userCount}
            scopeMemoryCount={memoryCounts.scopeCount}
            sessionMemoryCount={memoryCounts.sessionCount}
            memoryByType={memoryCounts.byType}
            memoryCountsLoading={memoryCountsLoading}
            activeLocks={scopeDocLocks}
            activeLocksByDoc={scopeLocksByDoc}
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
            memoryEnabled={memoryCounts.enabled}
            userMemoryCount={memoryCounts.userCount}
            scopeMemoryCount={memoryCounts.scopeCount}
            sessionMemoryCount={memoryCounts.sessionCount}
            memoryByType={memoryCounts.byType}
            memoryCountsLoading={memoryCountsLoading}
            sessionLocks={sessionLocks}
          />
        )}
      </div>
    </aside>
  )
}
