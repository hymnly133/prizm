/**
 * agentSessionStore - Agent 会话全局状态管理（Zustand Store）
 *
 * 核心设计：数据流与视图完全解耦
 * - SSE 流处理在 Store action 中运行，不依赖任何 React 组件的生命周期
 * - 每个会话拥有独立的 StreamingState，切换会话不影响正在进行的流
 * - 视图层（useAgent hook / AgentPage）只做 selector 订阅消费
 */
import { create } from 'zustand'
import type {
  AgentSession,
  AgentMessage,
  InteractRequestPayload,
  PrizmClient
} from '@prizm/client-core'
import { createClientLogger, getTextContent } from '@prizm/client-core'
import type { FilePathRef } from '@prizm/shared'
import {
  getInternals,
  DEFAULT_STREAMING_STATE,
  type SessionStreamingState
} from './agentStreamingInternals'
import {
  updateStreamingState,
  updateOptimisticMessages,
  createStreamAccumulator,
  processStreamChunk,
  mergeOptimisticIntoSession,
  mergeAbortedIntoSession,
  type SetStateLike,
  type GetStateLike
} from './agentStreamingHandlers'

const log = createClientLogger('AgentSession')

function tmpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type { SessionStreamingState }

export interface AgentSessionStoreState {
  // --- 会话数据 ---
  sessions: AgentSession[]
  currentSessionId: string | null

  // --- 每会话流式状态（key = sessionId）---
  streamingStates: Record<string, SessionStreamingState>

  // --- 全局 UI 状态 ---
  loading: boolean
  error: string | null
  selectedModel: string | undefined

  // --- Actions ---
  setHttpClient(http: PrizmClient): void
  refreshSessions(scope: string): Promise<void>
  createSession(scope: string): Promise<AgentSession | null>
  deleteSession(id: string, scope: string): Promise<void>
  loadSession(id: string, scope: string): Promise<AgentSession | null>
  updateSession(
    id: string,
    update: { llmSummary?: string },
    scope: string
  ): Promise<AgentSession | null>
  switchSession(id: string | null): void
  sendMessage(
    sessionId: string,
    content: string,
    scope: string,
    fileRefs?: FilePathRef[],
    model?: string
  ): Promise<string | null>
  stopGeneration(sessionId: string, scope: string): Promise<void>
  respondToInteract(
    sessionId: string,
    requestId: string,
    approved: boolean,
    scope: string,
    paths?: string[]
  ): Promise<void>
  handleSyncEvent(event: string, scope: string): void
  setSelectedModel(model: string | undefined): void
}

/** 模块级：HTTP client 引用（避免存入 zustand state） */
let _httpClient: PrizmClient | null = null

export const useAgentSessionStore = create<AgentSessionStoreState>()((set, get) => {
  const setStreaming = set as SetStateLike
  const getStreaming = get as GetStateLike

  return {
  // --- Initial State ---
  sessions: [],
  currentSessionId: null,
  streamingStates: {},
  loading: false,
  error: null,
  selectedModel: undefined,

  // --- Actions ---

  setHttpClient(http: PrizmClient) {
    _httpClient = http
  },

  setSelectedModel(model: string | undefined) {
    set({ selectedModel: model })
  },

  async refreshSessions(scope: string) {
    const http = _httpClient
    if (!http || !scope) return
    log.debug('Refreshing sessions, scope:', scope)
    set({ loading: true })
    try {
      const list = await http.listAgentSessions(scope)
      set({ sessions: list })
      log.debug('Sessions loaded:', list.length)
    } catch (err) {
      log.error('Failed to refresh sessions:', err)
      set({ sessions: [] })
    } finally {
      set({ loading: false })
    }
  },

  async createSession(scope: string) {
    const http = _httpClient
    if (!http || !scope) return null
    log.info('Creating session, scope:', scope)
    set({ loading: true })
    try {
      const session = await http.createAgentSession(scope)
      await get().refreshSessions(scope)
      set({ currentSessionId: session.id })
      log.info('Session created:', session.id)
      return session
    } catch (err) {
      log.error('Failed to create session:', err)
      return null
    } finally {
      set({ loading: false })
    }
  },

  async deleteSession(id: string, scope: string) {
    const http = _httpClient
    if (!http || !scope) return
    log.info('Deleting session:', id)
    set({ loading: true })
    try {
      await http.deleteAgentSession(id, scope)
      const state = get()
      if (state.currentSessionId === id) {
        set({ currentSessionId: null })
        const { [id]: _, ...rest } = state.streamingStates
        set({ streamingStates: rest })
      }
      await get().refreshSessions(scope)
    } finally {
      set({ loading: false })
    }
  },

  async loadSession(id: string, scope: string) {
    const http = _httpClient
    if (!http || !scope) return null
    log.debug('Loading session:', id)
    set({ loading: true, error: null })
    try {
      const session = await http.getAgentSession(id, scope)
      const state = get()
      const isStreaming = state.streamingStates[id]?.sending
      set({
        currentSessionId: id,
        ...(isStreaming
          ? {}
          : {
              streamingStates: {
                ...state.streamingStates,
                [id]: { ...DEFAULT_STREAMING_STATE }
              }
            })
      })
      set((s) => {
        const exists = s.sessions.some((sess) => sess.id === id)
        return {
          sessions: exists
            ? s.sessions.map((sess) => (sess.id === id ? session : sess))
            : [...s.sessions, session]
        }
      })
      return session
    } catch (err) {
      log.error('Failed to load session:', err)
      return null
    } finally {
      set({ loading: false })
    }
  },

  async updateSession(id: string, update: { llmSummary?: string }, scope: string) {
    const http = _httpClient
    if (!http || !scope) return null
    try {
      const session = await http.updateAgentSession(id, update, scope)
      set((s) => ({
        sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...session } : sess))
      }))
      await get().refreshSessions(scope)
      return session
    } catch (err) {
      log.error('Failed to update session:', err)
      return null
    }
  },

  switchSession(id: string | null) {
    log.debug('Switching session:', id)
    set({ currentSessionId: id })
  },

  async stopGeneration(sessionId: string, scope: string) {
    log.info('Stopping generation:', sessionId)
    const http = _httpClient
    if (http) {
      try {
        await http.stopAgentChat(sessionId, scope)
      } catch (err) {
        log.warn('Stop generation request failed:', err)
      }
    }
    const internals = getInternals(sessionId)
    const ac = internals.abortController
    if (ac) {
      const timer = setTimeout(() => {
        const current = getInternals(sessionId)
        if (current.abortController === ac) {
          ac.abort()
          current.abortController = null
        }
      }, 3000)
      internals.stopTimeout = timer
    }
  },

  async respondToInteract(
    sessionId: string,
    requestId: string,
    approved: boolean,
    scope: string,
    paths?: string[]
  ) {
    const http = _httpClient
    if (!http) return
    try {
      await http.respondToInteract(sessionId, requestId, approved, { paths, scope })
      log.debug('Interact response sent:', requestId, approved)
    } catch (err) {
      log.error('Failed to send interact response:', err)
      const internals = getInternals(sessionId)
      internals.pendingInteractRef = null
      updateStreamingState(setStreaming, sessionId, { pendingInteract: null })
    }
  },

  handleSyncEvent(event: string, scope: string) {
    if (!event.startsWith('agent:')) return
    log.debug('Sync event received:', event, 'scope:', scope)
    if (scope) void get().refreshSessions(scope)
    const state = get()
    const currentId = state.currentSessionId
    if (currentId) {
      const isStreaming = state.streamingStates[currentId]?.sending
      if (!isStreaming) {
        void get().loadSession(currentId, scope)
      }
    }
  },

  async sendMessage(
    sessionId: string,
    content: string,
    scope: string,
    fileRefs?: FilePathRef[],
    model?: string
  ): Promise<string | null> {
    const http = _httpClient
    if (!http || !content.trim()) return null

    const sessionObj = get().sessions.find((s) => s.id === sessionId)
    if (!sessionObj) return null

    const internals = getInternals(sessionId)
    const selectedModel = model ?? get().selectedModel
    log.info('Sending message, session:', sessionId, 'model:', selectedModel, 'contentLen:', content.trim().length)

    updateStreamingState(setStreaming, sessionId, {
      sending: true,
      thinking: false,
      pendingInteract: null
    })
    set({ error: null })
    internals.lastContentTime = Date.now()
    internals.pendingInteractRef = null

    const ac = new AbortController()
    internals.abortController = ac

    const now = Date.now()
    const userMsg: AgentMessage = {
      id: tmpId('user'),
      role: 'user',
      parts: [{ type: 'text', content: content.trim() }],
      createdAt: now
    }
    const assistantMsg: AgentMessage = {
      id: tmpId('assistant'),
      role: 'assistant',
      parts: [],
      createdAt: now
    }

    updateStreamingState(setStreaming, sessionId, {
      optimisticMessages: [userMsg, assistantMsg]
    })

    const acc = createStreamAccumulator()
    const chunkCtx = { set: setStreaming, get: getStreaming, sessionId, internals, acc }

    try {
      await http.streamChat(sessionId, content.trim(), {
        scope,
        signal: ac.signal,
        model: selectedModel,
        fileRefs,
        onChunk: (chunk) => processStreamChunk(chunk, chunkCtx),
        onError: (msg) => set({ error: msg })
      })

      mergeOptimisticIntoSession(setStreaming, getStreaming, sessionId, acc, userMsg, assistantMsg)
      log.info('Stream completed, session:', sessionId)
      updateStreamingState(setStreaming, sessionId, { optimisticMessages: [] })
      await get().refreshSessions(scope)
      return acc.commandResultContent ?? getTextContent({ parts: acc.parts })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        log.info('Stream aborted, session:', sessionId)
        mergeAbortedIntoSession(
          setStreaming,
          getStreaming,
          sessionId,
          userMsg,
          acc.lastModel,
          acc.lastUsage
        )
        updateStreamingState(setStreaming, sessionId, { optimisticMessages: [] })
      } else {
        log.error('Stream error:', err instanceof Error ? err.message : String(err))
        set({ error: err instanceof Error ? err.message : '发送失败' })
        updateStreamingState(setStreaming, sessionId, { optimisticMessages: [] })
      }
      return null
    } finally {
      internals.abortController = null
      if (internals.stopTimeout) {
        clearTimeout(internals.stopTimeout)
        internals.stopTimeout = null
      }
      internals.lastContentTime = 0
      internals.pendingInteractRef = null
      updateStreamingState(setStreaming, sessionId, {
        sending: false,
        thinking: false,
        pendingInteract: null
      })
    }
  }
  }
})

// --- 选择器 ---

/** 获取当前会话对象（从 sessions 列表中查找） */
export function selectCurrentSession(state: AgentSessionStoreState): AgentSession | null {
  if (!state.currentSessionId) return null
  return state.sessions.find((s) => s.id === state.currentSessionId) ?? null
}

/** 获取当前会话的流式状态 */
export function selectCurrentStreamingState(
  state: AgentSessionStoreState
): SessionStreamingState | undefined {
  if (!state.currentSessionId) return undefined
  return state.streamingStates[state.currentSessionId]
}

/** 是否有任何会话正在流式输出（用于导航栏后台指示器） */
export function selectAnySessionSending(state: AgentSessionStoreState): boolean {
  return Object.values(state.streamingStates).some((ss) => ss.sending)
}

/** 是否有任何会话正在等待用户交互（用于全局提示） */
export function selectAnyPendingInteract(state: AgentSessionStoreState): boolean {
  return Object.values(state.streamingStates).some((ss) => ss.pendingInteract != null)
}

/** 获取所有有待交互请求的会话 ID 集合 */
export function selectPendingInteractSessionIds(state: AgentSessionStoreState): Set<string> {
  const ids = new Set<string>()
  for (const [sessionId, ss] of Object.entries(state.streamingStates)) {
    if (ss.pendingInteract != null) ids.add(sessionId)
  }
  return ids
}

/** 获取第一个待交互请求的详细信息（用于全局通知） */
export function selectFirstPendingInteract(state: AgentSessionStoreState): {
  sessionId: string
  interact: InteractRequestPayload
} | null {
  for (const [sessionId, ss] of Object.entries(state.streamingStates)) {
    if (ss.pendingInteract != null) {
      return { sessionId, interact: ss.pendingInteract }
    }
  }
  return null
}
