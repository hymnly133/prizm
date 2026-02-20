/**
 * useAgentSidebarData — Agent 侧边栏数据获取 hook
 *
 * 从 AgentRightSidebar 提取的全部数据获取逻辑，包括：
 * - 模型列表、默认模型
 * - Scope 上下文、系统提示词
 * - 会话上下文（provisions + activities）、会话统计
 * - 最新工具调用、记忆计数
 * - 发送结束后自动刷新
 *
 * 被 AgentDetailSidebar 调用，使其成为纯渲染组件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScopeDataStore } from '../store/scopeDataStore'
import type {
  AgentMessage,
  AvailableModel,
  ResourceLockInfo,
  ToolCallRecord
} from '@prizm/client-core'
import { getToolCalls } from '@prizm/client-core'
import type { ActivityItem, SessionStats } from '../components/agent/agentSidebarTypes'
import type { MemoryCounts } from '../store/scopeDataStore'

export interface AgentSidebarData {
  models: AvailableModel[]
  defaultModel: string

  scopeContext: string
  scopeContextLoading: boolean
  loadScopeContext: () => Promise<void>

  systemPrompt: string
  systemPromptLoading: boolean
  systemPromptModalOpen: boolean
  setSystemPromptModalOpen: (open: boolean) => void

  sessionContext: {
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null
  sessionContextLoading: boolean

  sessionStats: SessionStats | null
  sessionStatsLoading: boolean

  latestToolCalls: ToolCallRecord[]
  provisionsSummary: string | null

  memoryCounts: MemoryCounts
  memoryCountsLoading: boolean

  sessionLocks: ResourceLockInfo[]
}

export function useAgentSidebarData(
  scope: string,
  sessionId: string | undefined,
  sending: boolean,
  optimisticMessages: AgentMessage[] = [],
  sessionMessages?: AgentMessage[],
  heldLocks?: ResourceLockInfo[]
): AgentSidebarData {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()

  const memoryCounts = useScopeDataStore((s) => s.memoryCounts)
  const memoryCountsLoading = useScopeDataStore((s) => s.memoryCountsLoading)
  const refreshMemoryCounts = useScopeDataStore((s) => s.refreshMemoryCounts)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)

  // --- Local state ---
  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [scopeContext, setScopeContext] = useState<string>('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
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

  // --- Data loaders ---
  const loadSystemPrompt = useCallback(async () => {
    if (!http || !scope) return
    setSystemPromptLoading(true)
    try {
      const res = await http.getAgentSystemPrompt(scope, sessionId)
      setSystemPrompt(res.systemPrompt || '')
    } catch {
      setSystemPrompt('')
    } finally {
      setSystemPromptLoading(false)
    }
  }, [http, scope, sessionId])

  const loadScopeContext = useCallback(async () => {
    if (!http || !scope) return
    setScopeContextLoading(true)
    try {
      const res = await http.getAgentScopeContext(scope)
      setScopeContext(res.summary || '')
    } catch {
      setScopeContext('')
    } finally {
      setScopeContextLoading(false)
    }
  }, [http, scope])

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
    if (!http || !scope || !sessionId) return
    setSessionContextLoading(true)
    try {
      const ctx = await http.getAgentSessionContext(sessionId, scope)
      setSessionContext({
        provisions: ctx.provisions ?? [],
        activities: ctx.activities ?? []
      })
    } catch {
      setSessionContext(null)
    } finally {
      setSessionContextLoading(false)
    }
  }, [http, scope, sessionId])

  const loadSessionStats = useCallback(async () => {
    if (!http || !scope || !sessionId) return
    setSessionStatsLoading(true)
    try {
      const stats = await http.getAgentSessionStats(sessionId, scope)
      setSessionStats(stats)
    } catch {
      setSessionStats(null)
    } finally {
      setSessionStatsLoading(false)
    }
  }, [http, scope, sessionId])

  // --- Effects: initial + session change ---
  useEffect(() => {
    void loadScopeContext()
    void loadSystemPrompt()
  }, [loadScopeContext, loadSystemPrompt])

  useEffect(() => {
    if (sessionId && scope) {
      const _t0 = performance.now()
      console.debug(
        `[perf] SidebarData: session changed → loadSessionContext + loadSessionStats`,
        { sessionId: sessionId.slice(0, 8) }
      )
      void loadSessionContext().then(() =>
        console.debug(
          `[perf] SidebarData loadSessionContext done %c${(performance.now() - _t0).toFixed(1)}ms`,
          'color:#795548;font-weight:bold'
        )
      )
      void loadSessionStats().then(() =>
        console.debug(
          `[perf] SidebarData loadSessionStats done %c${(performance.now() - _t0).toFixed(1)}ms`,
          'color:#607D8B;font-weight:bold'
        )
      )
    } else {
      setSessionContext(null)
      setSessionStats(null)
    }
  }, [sessionId, scope, loadSessionContext, loadSessionStats])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // --- Auto-refresh on sending → idle transition ---
  const prevSendingRef = useRef(sending)
  useEffect(() => {
    if (prevSendingRef.current && !sending && sessionId) {
      void loadSessionContext()
      void refreshMemoryCounts()
      void loadSessionStats()
      void refreshDocuments()
    }
    prevSendingRef.current = sending
  }, [sending, sessionId, loadSessionContext, refreshMemoryCounts, loadSessionStats, refreshDocuments])

  // --- Derived computations ---
  const latestToolCalls: ToolCallRecord[] = useMemo(() => {
    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...(sessionMessages ?? []),
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
  }, [sessionMessages, optimisticMessages])

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

  const sessionLocks: ResourceLockInfo[] = useMemo(() => heldLocks ?? [], [heldLocks])

  return {
    models,
    defaultModel,
    scopeContext,
    scopeContextLoading,
    loadScopeContext,
    systemPrompt,
    systemPromptLoading,
    systemPromptModalOpen,
    setSystemPromptModalOpen,
    sessionContext,
    sessionContextLoading,
    sessionStats,
    sessionStatsLoading,
    latestToolCalls,
    provisionsSummary,
    memoryCounts,
    memoryCountsLoading,
    sessionLocks
  }
}
