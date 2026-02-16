/**
 * useAgent - Agent 会话管理 hook（Store 的薄包装层）
 *
 * 所有数据和流式逻辑由 agentSessionStore（Zustand）管理，
 * 此 hook 负责：
 * 1. 向 Store 注入 HTTP client
 * 2. 将 sync events 转发给 Store
 * 3. 绑定 scope 参数，向 AgentPage 暴露与旧 API 兼容的返回值
 */
import { useEffect, useCallback } from 'react'
import { usePrizmContext, useSyncEventContext } from '../context/PrizmContext'
import {
  useAgentSessionStore,
  selectCurrentSession,
  selectCurrentStreamingState
} from '../store/agentSessionStore'
import type { AgentSession } from '@prizm/client-core'
import type { FilePathRef } from '@prizm/shared'

export function useAgent(scope: string) {
  const { manager } = usePrizmContext()
  const { lastSyncEvent } = useSyncEventContext()

  // --- 注入 HTTP client ---
  useEffect(() => {
    const http = manager?.getHttpClient()
    if (http) {
      useAgentSessionStore.getState().setHttpClient(http)
    }
  }, [manager])

  // --- 转发 sync events ---
  useEffect(() => {
    if (lastSyncEvent?.startsWith('agent:') && scope) {
      useAgentSessionStore.getState().handleSyncEvent(lastSyncEvent, scope)
    }
  }, [lastSyncEvent, scope])

  // --- 初始化加载 ---
  useEffect(() => {
    const http = manager?.getHttpClient()
    if (http && scope) {
      useAgentSessionStore.getState().setHttpClient(http)
      void useAgentSessionStore.getState().refreshSessions(scope)
    }
  }, [manager, scope])

  // --- 从 Store 选取状态 ---
  const sessions = useAgentSessionStore((s) => s.sessions)
  const currentSession = useAgentSessionStore(selectCurrentSession)
  const loading = useAgentSessionStore((s) => s.loading)
  const error = useAgentSessionStore((s) => s.error)
  const selectedModel = useAgentSessionStore((s) => s.selectedModel)

  const streamingState = useAgentSessionStore(selectCurrentStreamingState)
  const sending = streamingState?.sending ?? false
  const thinking = streamingState?.thinking ?? false
  const optimisticMessages = streamingState?.optimisticMessages ?? EMPTY_MESSAGES
  const pendingInteract = streamingState?.pendingInteract ?? null
  const lastInjectedMemories = streamingState?.lastInjectedMemories ?? null

  // --- 绑定 scope 的 action 封装 ---
  const refreshSessions = useCallback(
    () => useAgentSessionStore.getState().refreshSessions(scope),
    [scope]
  )

  const createSession = useCallback(
    () => useAgentSessionStore.getState().createSession(scope),
    [scope]
  )

  const deleteSession = useCallback(
    (id: string) => useAgentSessionStore.getState().deleteSession(id, scope),
    [scope]
  )

  const loadSession = useCallback(
    (id: string) => useAgentSessionStore.getState().loadSession(id, scope),
    [scope]
  )

  const updateSession = useCallback(
    (id: string, update: { llmSummary?: string }) =>
      useAgentSessionStore.getState().updateSession(id, update, scope),
    [scope]
  )

  const sendMessage = useCallback(
    (content: string, sessionOverride?: AgentSession | null, fileRefs?: FilePathRef[]) => {
      const state = useAgentSessionStore.getState()
      const sid = sessionOverride?.id ?? state.currentSessionId
      if (!sid) return Promise.resolve(null)
      return state.sendMessage(sid, content, scope, fileRefs)
    },
    [scope]
  )

  const stopGeneration = useCallback(() => {
    const state = useAgentSessionStore.getState()
    if (state.currentSessionId) {
      return state.stopGeneration(state.currentSessionId, scope)
    }
    return Promise.resolve()
  }, [scope])

  const setCurrentSession = useCallback((s: AgentSession | null) => {
    useAgentSessionStore.getState().switchSession(s?.id ?? null)
  }, [])

  const setSelectedModel = useCallback((model: string | undefined) => {
    useAgentSessionStore.getState().setSelectedModel(model)
  }, [])

  const respondToInteract = useCallback(
    (requestId: string, approved: boolean, paths?: string[]) => {
      const state = useAgentSessionStore.getState()
      if (state.currentSessionId) {
        return state.respondToInteract(state.currentSessionId, requestId, approved, scope, paths)
      }
      return Promise.resolve()
    },
    [scope]
  )

  return {
    sessions,
    currentSession,
    loading,
    sending,
    thinking,
    error,
    refreshSessions,
    createSession,
    deleteSession,
    loadSession,
    updateSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    optimisticMessages,
    selectedModel,
    setSelectedModel,
    lastInjectedMemories,
    pendingInteract,
    respondToInteract
  }
}

/** 稳定空数组引用，避免无流式状态时每次渲染创建新数组 */
const EMPTY_MESSAGES: import('@prizm/client-core').AgentMessage[] = []
