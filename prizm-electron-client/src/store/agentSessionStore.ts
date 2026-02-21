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
  EnrichedSession,
  AgentMessage,
  InteractRequestPayload,
  PrizmClient,
  RollbackResult
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
  sessions: EnrichedSession[]
  currentSessionId: string | null

  // --- 每会话流式状态（key = sessionId）---
  streamingStates: Record<string, SessionStreamingState>

  // --- 全局 UI 状态 ---
  loading: boolean
  error: string | null
  selectedModel: string | undefined
  thinkingEnabled: boolean
  toolCardCompact: boolean

  /** 开发模式：每轮请求的调试信息，key = `${sessionId}:${messageId}` */
  roundDebugByKey: Record<string, RoundDebugInfo>

  // --- Actions ---
  setHttpClient(http: PrizmClient): void
  refreshSessions(scope: string): Promise<void>
  createSession(scope: string): Promise<AgentSession | null>
  deleteSession(id: string, scope: string): Promise<void>
  loadSession(id: string, scope: string): Promise<AgentSession | null>
  updateSession(
    id: string,
    update: {
      llmSummary?: string
      allowedTools?: string[]
      allowedSkills?: string[]
      allowedMcpServerIds?: string[]
    },
    scope: string
  ): Promise<AgentSession | null>
  switchSession(id: string | null): void
  sendMessage(
    sessionId: string,
    content: string,
    scope: string,
    fileRefs?: FilePathRef[],
    model?: string,
    runRefIds?: string[]
  ): Promise<string | null>
  stopGeneration(sessionId: string, scope: string): Promise<void>
  respondToInteract(
    sessionId: string,
    requestId: string,
    approved: boolean,
    scope: string,
    paths?: string[]
  ): Promise<void>
  rollbackToCheckpoint(
    sessionId: string,
    checkpointId: string,
    scope: string,
    restoreFiles?: boolean
  ): Promise<RollbackResult | null>
  startObserving(sessionId: string, scope: string): void
  stopObserving(sessionId: string): void
  handleSyncEvent(event: string, scope: string, payload?: Record<string, unknown>): void
  setSelectedModel(model: string | undefined): void
  setThinkingEnabled(enabled: boolean): void
  setToolCardCompact(compact: boolean): void
  toggleToolCardCompact(): void
  /** 仅用于 DevTools Playground：注入模拟待审批，不请求服务端 */
  injectPlaygroundInteract(payload: InteractRequestPayload): void
  clearPlaygroundInteract(): void
  /** 开发模式：记录此轮请求的调试信息 */
  setRoundDebug(
    sessionId: string,
    messageId: string,
    requestPayload: RoundDebugRequestPayload
  ): void
}

/** 开发模式：单轮请求的调试载荷（与 streamChat 入参一致） */
export interface RoundDebugRequestPayload {
  content: string
  model?: string
  fileRefs?: FilePathRef[]
  runRefIds?: string[]
  thinking?: boolean
}

export interface RoundDebugInfo {
  requestPayload: RoundDebugRequestPayload
}

/** DevTools 交互 Playground 使用的虚拟 sessionId，不请求服务端 */
export const PLAYGROUND_SESSION_ID = '__playground__'

const THINKING_STORAGE_KEY = 'prizm.agent.thinkingEnabled'
const TOOL_COMPACT_STORAGE_KEY = 'prizm.agent.toolCardCompact'

function loadThinkingEnabled(): boolean {
  try {
    const v = localStorage.getItem(THINKING_STORAGE_KEY)
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

function saveThinkingEnabled(v: boolean): void {
  try {
    localStorage.setItem(THINKING_STORAGE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function loadToolCardCompact(): boolean {
  try {
    return localStorage.getItem(TOOL_COMPACT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveToolCardCompact(v: boolean): void {
  try {
    localStorage.setItem(TOOL_COMPACT_STORAGE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 模块级：HTTP client 引用（避免存入 zustand state） */
let _httpClient: PrizmClient | null = null

/** 模块级：loadSession in-flight 去重 */
const _loadInflight = new Map<string, Promise<AgentSession | null>>()

/** 模块级：BG session observe AbortController 追踪 */
const _observeControllers = new Map<string, AbortController>()

/** 模块级：每个 session 的最后成功 fetch 时间（用于 stale-while-revalidate） */
const _lastFetchTime = new Map<string, number>()

/** 缓存新鲜期：距上次 fetch 未超过此时间的 session 不发起后台刷新 */
const STALE_THRESHOLD_MS = 30_000

/**
 * 后台静默刷新：stale-while-revalidate 模式。
 * 仅在距上次 fetch 超过 STALE_THRESHOLD_MS 时才发起 HTTP，
 * 且不设 loading 状态，不阻塞 UI。
 */
function _backgroundRevalidate(id: string, scope: string): void {
  const lastFetch = _lastFetchTime.get(id) ?? 0
  if (Date.now() - lastFetch < STALE_THRESHOLD_MS) return
  const http = _httpClient
  if (!http) return

  _lastFetchTime.set(id, Date.now())

  http
    .getAgentSession(id, scope)
    .then((session) => {
      useAgentSessionStore.setState((s) => {
        const ex = s.sessions.find((sess) => sess.id === id)
        if (
          ex &&
          ex.updatedAt === session.updatedAt &&
          ex.messages.length === session.messages.length
        ) {
          return {}
        }
        log.debug('Background revalidate: merging updated data for session:', id.slice(0, 8))
        return {
          sessions: s.sessions.map((sess) => (sess.id === id ? session : sess))
        }
      })
    })
    .catch((err) => {
      log.debug('Background revalidate failed for session:', id.slice(0, 8), err)
    })
}

/** 将指定 session 标记为 stale（清除 fetch 时间），下次访问时触发后台刷新 */
function _invalidateSessionCache(id: string): void {
  _lastFetchTime.delete(id)
}

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
    thinkingEnabled: loadThinkingEnabled(),
    toolCardCompact: loadToolCardCompact(),
    roundDebugByKey: {},

    // --- Actions ---

    setHttpClient(http: PrizmClient) {
      _httpClient = http
    },

    setSelectedModel(model: string | undefined) {
      set({ selectedModel: model })
    },

    setThinkingEnabled(enabled: boolean) {
      set({ thinkingEnabled: enabled })
      saveThinkingEnabled(enabled)
    },

    setToolCardCompact(compact: boolean) {
      set({ toolCardCompact: compact })
      saveToolCardCompact(compact)
    },

    toggleToolCardCompact() {
      const next = !get().toolCardCompact
      set({ toolCardCompact: next })
      saveToolCardCompact(next)
    },

    injectPlaygroundInteract(payload: InteractRequestPayload) {
      const internals = getInternals(PLAYGROUND_SESSION_ID)
      internals.pendingInteractRef = payload
      set((s) => ({
        streamingStates: {
          ...s.streamingStates,
          [PLAYGROUND_SESSION_ID]: { ...DEFAULT_STREAMING_STATE, pendingInteract: payload }
        }
      }))
    },

    clearPlaygroundInteract() {
      const internals = getInternals(PLAYGROUND_SESSION_ID)
      internals.pendingInteractRef = null
      set((s) => {
        const { [PLAYGROUND_SESSION_ID]: _, ...rest } = s.streamingStates
        return { streamingStates: rest }
      })
    },

    setRoundDebug(sessionId: string, messageId: string, requestPayload: RoundDebugRequestPayload) {
      if (typeof import.meta !== 'undefined' && !import.meta.env?.DEV) return
      const key = `${sessionId}:${messageId}`
      set((s) => ({
        roundDebugByKey: {
          ...s.roundDebugByKey,
          [key]: { requestPayload }
        }
      }))
    },

    async refreshSessions(scope: string) {
      const http = _httpClient
      if (!http || !scope) return
      log.debug('Refreshing sessions, scope:', scope)
      set({ loading: true })
      try {
        const list = await http.listAgentSessions(scope)
        _lastFetchTime.clear()
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
        const enriched = await http.getAgentSession(session.id, scope)
        _lastFetchTime.set(session.id, Date.now())
        set((s) => ({
          sessions: [enriched, ...s.sessions.filter((sess) => sess.id !== session.id)],
          currentSessionId: session.id
        }))
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
      } catch (err) {
        log.warn('Server delete failed (removing locally):', err)
      }
      _lastFetchTime.delete(id)
      const state = get()
      if (state.currentSessionId === id) {
        set({ currentSessionId: null })
        const { [id]: _, ...rest } = state.streamingStates
        set({ streamingStates: rest })
      }
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.id !== id)
      }))
      set({ loading: false })
    },

    async loadSession(id: string, scope: string) {
      const http = _httpClient
      if (!http || !scope) return null

      const _t0 = performance.now()

      // In-flight dedup: if a request for the same session is already pending, reuse it
      const inflightKey = `${id}:${scope}`
      const existing = _loadInflight.get(inflightKey)

      // Always optimistically switch to this session
      const prevState = get()
      const isStreaming = prevState.streamingStates[id]?.sending
      const prevSessionId = prevState.currentSessionId
      set({
        currentSessionId: id,
        error: null,
        ...(isStreaming
          ? {}
          : {
              streamingStates: {
                ...prevState.streamingStates,
                [id]: { ...DEFAULT_STREAMING_STATE }
              }
            })
      })

      if (existing) {
        log.debug('Reusing in-flight loadSession for:', id)
        return existing
      }

      // Cache hit: session already in store → return immediately, optionally revalidate in background
      const cached = prevState.sessions.find((s) => s.id === id)
      if (cached) {
        console.log(
          `[perf] loadSession CACHE HIT %c${(performance.now() - _t0).toFixed(1)}ms`,
          'color:#4CAF50;font-weight:bold',
          {
            from: prevSessionId?.slice(0, 8),
            to: id.slice(0, 8),
            messages: cached.messages?.length
          }
        )
        _backgroundRevalidate(id, scope)
        return cached
      }

      // Cache miss: first-time load via HTTP
      log.debug('Loading session (cache miss):', id)
      set({ loading: true })

      const promise = (async (): Promise<AgentSession | null> => {
        const _tHttp0 = performance.now()
        try {
          const session = await http.getAgentSession(id, scope)
          _lastFetchTime.set(id, Date.now())
          console.log(
            `[perf] loadSession HTTP %c${(performance.now() - _tHttp0).toFixed(1)}ms`,
            'color:#2196F3;font-weight:bold',
            { messages: session.messages?.length }
          )

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
          _loadInflight.delete(inflightKey)
          set({ loading: false })
          console.log(
            `[perf] loadSession TOTAL %c${(performance.now() - _t0).toFixed(1)}ms`,
            'color:#E91E63;font-weight:bold'
          )
        }
      })()

      _loadInflight.set(inflightKey, promise)
      return promise
    },

    async updateSession(
      id: string,
      update: {
        llmSummary?: string
        allowedTools?: string[]
        allowedSkills?: string[]
        allowedMcpServerIds?: string[]
      },
      scope: string
    ) {
      const http = _httpClient
      if (!http || !scope) return null
      try {
        const session = await http.updateAgentSession(id, update, scope)
        set((s) => ({
          sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...session } : sess))
        }))
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
      if (sessionId === PLAYGROUND_SESSION_ID) {
        const internals = getInternals(sessionId)
        internals.pendingInteractRef = null
        updateStreamingState(setStreaming, sessionId, { pendingInteract: null })
        return
      }
      const http = _httpClient
      if (!http) return
      try {
        await http.respondToInteract(sessionId, requestId, approved, {
          paths,
          scope
        })
      } catch (err) {
        log.error('respondToInteract failed:', err)
        const internals = getInternals(sessionId)
        internals.pendingInteractRef = null
        updateStreamingState(setStreaming, sessionId, { pendingInteract: null })
      }
    },

    async rollbackToCheckpoint(
      sessionId: string,
      checkpointId: string,
      scope: string,
      restoreFiles = true
    ): Promise<RollbackResult | null> {
      const http = _httpClient
      if (!http) return null
      log.info('Rolling back session:', sessionId, 'to checkpoint:', checkpointId)
      set({ loading: true, error: null })
      try {
        const result = await http.rollbackToCheckpoint(sessionId, checkpointId, {
          restoreFiles,
          scope
        })
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, ...result.session } : sess
          )
        }))
        _lastFetchTime.set(sessionId, Date.now())
        updateStreamingState(setStreaming, sessionId, {
          sending: false,
          thinking: false,
          optimisticMessages: [],
          pendingInteract: null
        })
        log.info(
          'Rollback complete: removed %d messages, restored %d files',
          result.rolledBackMessageCount,
          result.restoredFiles.length
        )
        return result
      } catch (err) {
        log.error('Rollback failed:', err)
        set({ error: err instanceof Error ? err.message : '回退失败' })
        return null
      } finally {
        set({ loading: false })
      }
    },

    startObserving(sessionId: string, scope: string) {
      const http = _httpClient
      if (!http) return

      if (_observeControllers.has(sessionId)) return

      const ac = new AbortController()
      _observeControllers.set(sessionId, ac)

      const phantomMsg: AgentMessage = {
        id: tmpId('observe-phantom'),
        role: 'user',
        parts: [{ type: 'text', content: '' }],
        createdAt: Date.now()
      }
      const assistantMsg: AgentMessage = {
        id: tmpId('observe'),
        role: 'assistant',
        parts: [],
        createdAt: Date.now()
      }

      updateStreamingState(setStreaming, sessionId, {
        sending: true,
        thinking: true,
        optimisticMessages: [phantomMsg, assistantMsg]
      })

      const acc = createStreamAccumulator()
      const internals = getInternals(sessionId)
      internals.lastContentTime = Date.now()

      const chunkCtx = { set: setStreaming, get: getStreaming, sessionId, internals, acc }

      http
        .observeBgSession(sessionId, {
          scope,
          signal: ac.signal,
          onChunk: (chunk) => {
            if (chunk.type === 'done') return
            processStreamChunk(chunk, chunkCtx)
          },
          onError: (msg) => log.warn('Observe error:', msg)
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          log.error('Observe stream error:', err)
        })
        .finally(() => {
          _observeControllers.delete(sessionId)
          updateStreamingState(setStreaming, sessionId, {
            sending: false,
            thinking: false,
            optimisticMessages: []
          })
          internals.lastContentTime = 0
          _invalidateSessionCache(sessionId)
          _backgroundRevalidate(sessionId, scope)
        })
    },

    stopObserving(sessionId: string) {
      const ac = _observeControllers.get(sessionId)
      if (ac) {
        ac.abort()
        _observeControllers.delete(sessionId)
      }
    },

    handleSyncEvent(event: string, scope: string, payload?: Record<string, unknown>) {
      if (!event.startsWith('agent:') && !event.startsWith('bg:session.')) return
      const http = _httpClient

      log.debug('Sync event received:', event, 'scope:', scope)

      if (event === 'agent:session.created') {
        const sessionId = payload?.sessionId as string | undefined
        if (sessionId && http && scope) {
          void http
            .getAgentSession(sessionId, scope)
            .then((session) => {
              _lastFetchTime.set(sessionId, Date.now())
              set((s) => {
                const exists = s.sessions.some((sess) => sess.id === sessionId)
                return exists ? s : { sessions: [session, ...s.sessions] }
              })
            })
            .catch(() => {
              if (scope) void get().refreshSessions(scope)
            })
        }
        return
      }

      if (event === 'agent:session.deleted') {
        const sessionId = payload?.sessionId as string | undefined
        if (sessionId) {
          _lastFetchTime.delete(sessionId)
          set((s) => {
            const next: Partial<AgentSessionStoreState> = {
              sessions: s.sessions.filter((sess) => sess.id !== sessionId)
            }
            if (s.currentSessionId === sessionId) {
              next.currentSessionId = null
              const { [sessionId]: _, ...rest } = s.streamingStates
              next.streamingStates = rest
            }
            return next
          })
        }
        return
      }

      if (event === 'agent:session.chatStatusChanged') {
        const sessionId = payload?.sessionId as string | undefined
        const chatStatus = payload?.chatStatus as string | undefined
        if (sessionId && chatStatus) {
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === sessionId
                ? { ...sess, chatStatus: chatStatus as 'idle' | 'chatting' }
                : sess
            )
          }))
        }
        return
      }

      // agent:message.completed / agent:session.compressing / agent:session.rolledBack
      // Mark affected session as stale and trigger background revalidation (no blocking HTTP).
      const affectedSessionId = (payload?.sessionId as string | undefined) ?? get().currentSessionId
      if (affectedSessionId) {
        _invalidateSessionCache(affectedSessionId)
        const state = get()
        const isStreaming = state.streamingStates[affectedSessionId]?.sending
        if (!isStreaming) {
          _backgroundRevalidate(affectedSessionId, scope)
        }
      }
    },

    async sendMessage(
      sessionId: string,
      content: string,
      scope: string,
      fileRefs?: FilePathRef[],
      model?: string,
      runRefIds?: string[]
    ): Promise<string | null> {
      const http = _httpClient
      if (!http || !content.trim()) return null

      const sessionObj = get().sessions.find((s) => s.id === sessionId)
      if (!sessionObj) return null

      const internals = getInternals(sessionId)
      const selectedModel = model ?? get().selectedModel
      log.info(
        'Sending message, session:',
        sessionId,
        'model:',
        selectedModel,
        'contentLen:',
        content.trim().length
      )

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

      const thinkingEnabled = get().thinkingEnabled
      const requestPayload: RoundDebugRequestPayload = {
        content: content.trim(),
        model: selectedModel,
        fileRefs,
        runRefIds,
        thinking: thinkingEnabled || undefined
      }
      try {
        await http.streamChat(sessionId, content.trim(), {
          scope,
          signal: ac.signal,
          model: selectedModel,
          fileRefs,
          runRefIds,
          thinking: thinkingEnabled || undefined,
          onChunk: (chunk) => processStreamChunk(chunk, chunkCtx),
          onError: (msg) => set({ error: msg })
        })

        mergeOptimisticIntoSession(
          setStreaming,
          getStreaming,
          sessionId,
          acc,
          userMsg,
          assistantMsg
        )
        const finalMessageId = acc.lastMessageId ?? assistantMsg.id
        get().setRoundDebug(sessionId, finalMessageId, requestPayload)
        _lastFetchTime.set(sessionId, Date.now())
        log.info('Stream completed, session:', sessionId)
        updateStreamingState(setStreaming, sessionId, { optimisticMessages: [] })

        // 对话完成 → 桌面通知
        try {
          const session = get().sessions.find((s) => s.id === sessionId)
          const sessionLabel = session?.llmSummary?.trim() || '会话'
          const replyPreview = getTextContent({ parts: acc.parts })
          const bodyText = replyPreview
            ? replyPreview.slice(0, 100) + (replyPreview.length > 100 ? '…' : '')
            : '回复已生成'
          window.prizm?.showNotification?.({
            title: `Agent 回复完成`,
            body: `[${sessionLabel}] ${bodyText}`,
            eventType: 'agent:message.completed',
            updateId: `agent-chat-done:${sessionId}`
          })
        } catch {
          // ignore notification errors
        }

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

// --- 选择器（从独立文件导入，避免 Vite ESM 分析问题） ---
export {
  selectCurrentSession,
  selectCurrentStreamingState,
  selectAnySessionSending,
  selectAnyPendingInteract,
  selectPendingInteractSessionIds,
  selectFirstPendingInteract
} from './agentSessionSelectors'
