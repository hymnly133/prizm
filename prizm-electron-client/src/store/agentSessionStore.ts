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
  ToolCallRecord,
  MessagePart,
  MessagePartTool,
  InteractRequestPayload,
  PrizmClient
} from '@prizm/client-core'
import type { MemoryItem, FilePathRef } from '@prizm/shared'

function tmpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 每会话的流式状态 */
export interface SessionStreamingState {
  sending: boolean
  thinking: boolean
  optimisticMessages: AgentMessage[]
  pendingInteract: InteractRequestPayload | null
  lastInjectedMemories: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null
}

/** 流式内部上下文（不放入 store state，避免非序列化对象触发订阅） */
interface StreamingInternals {
  abortController: AbortController | null
  stopTimeout: ReturnType<typeof setTimeout> | null
  lastContentTime: number
  /** ref 追踪 pendingInteract，避免闭包问题 */
  pendingInteractRef: InteractRequestPayload | null
}

const DEFAULT_STREAMING_STATE: SessionStreamingState = {
  sending: false,
  thinking: false,
  optimisticMessages: [],
  pendingInteract: null,
  lastInjectedMemories: null
}

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

/** 模块级：每会话的流式内部上下文（AbortController 等不可序列化对象） */
const _streamingInternals = new Map<string, StreamingInternals>()

function getInternals(sessionId: string): StreamingInternals {
  let internals = _streamingInternals.get(sessionId)
  if (!internals) {
    internals = {
      abortController: null,
      stopTimeout: null,
      lastContentTime: 0,
      pendingInteractRef: null
    }
    _streamingInternals.set(sessionId, internals)
  }
  return internals
}

/** 辅助：更新指定会话的 streaming state */
function updateStreamingState(
  set: (fn: (state: AgentSessionStoreState) => Partial<AgentSessionStoreState>) => void,
  sessionId: string,
  patch: Partial<SessionStreamingState>
) {
  set((state) => {
    const prev = state.streamingStates[sessionId] ?? { ...DEFAULT_STREAMING_STATE }
    return {
      streamingStates: {
        ...state.streamingStates,
        [sessionId]: { ...prev, ...patch }
      }
    }
  })
}

/** 辅助：更新指定会话的 optimisticMessages（函数式更新） */
function updateOptimisticMessages(
  set: (fn: (state: AgentSessionStoreState) => Partial<AgentSessionStoreState>) => void,
  get: () => AgentSessionStoreState,
  sessionId: string,
  updater: (prev: AgentMessage[]) => AgentMessage[]
) {
  const current = get().streamingStates[sessionId]?.optimisticMessages ?? []
  const next = updater(current)
  if (next === current) return
  updateStreamingState(set, sessionId, { optimisticMessages: next })
}

export const useAgentSessionStore = create<AgentSessionStoreState>()((set, get) => ({
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
    set({ loading: true })
    try {
      const list = await http.listAgentSessions(scope)
      set({ sessions: list })
    } catch {
      set({ sessions: [] })
    } finally {
      set({ loading: false })
    }
  },

  async createSession(scope: string) {
    const http = _httpClient
    if (!http || !scope) return null
    set({ loading: true })
    try {
      const session = await http.createAgentSession(scope)
      await get().refreshSessions(scope)
      set({ currentSessionId: session.id })
      return session
    } catch {
      return null
    } finally {
      set({ loading: false })
    }
  },

  async deleteSession(id: string, scope: string) {
    const http = _httpClient
    if (!http || !scope) return
    set({ loading: true })
    try {
      await http.deleteAgentSession(id, scope)
      const state = get()
      if (state.currentSessionId === id) {
        set({ currentSessionId: null })
        // 清除该会话的流式状态
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
    set({ loading: true, error: null })
    try {
      const session = await http.getAgentSession(id, scope)
      const state = get()
      // 如果该会话正在流式输出，不清除其乐观消息
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
      // upsert：更新 sessions 列表中的对应会话数据，如果不存在则追加
      set((s) => {
        const exists = s.sessions.some((sess) => sess.id === id)
        return {
          sessions: exists
            ? s.sessions.map((sess) => (sess.id === id ? session : sess))
            : [...s.sessions, session]
        }
      })
      return session
    } catch {
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
      // 更新 sessions 列表
      set((s) => ({
        sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...session } : sess))
      }))
      await get().refreshSessions(scope)
      return session
    } catch {
      return null
    }
  },

  switchSession(id: string | null) {
    set({ currentSessionId: id })
  },

  async stopGeneration(sessionId: string, scope: string) {
    const http = _httpClient
    // 1. 通知后端停止
    if (http) {
      try {
        await http.stopAgentChat(sessionId, scope)
      } catch {
        // 忽略：后端可能已结束
      }
    }
    // 2. 设置超时兜底
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
      console.debug(
        '[agentStore] interact response sent: requestId=%s approved=%s',
        requestId,
        approved
      )
    } catch (err) {
      console.error('[agentStore] Failed to send interact response:', err)
      const internals = getInternals(sessionId)
      internals.pendingInteractRef = null
      updateStreamingState(set, sessionId, { pendingInteract: null })
    }
  },

  handleSyncEvent(event: string, scope: string) {
    if (!event.startsWith('agent:')) return
    if (scope) void get().refreshSessions(scope)
    const state = get()
    // 流式传输期间跳过 loadSession，避免竞态条件导致消息重复
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

    // 获取当前 session 对象（用于消息合并时的 base）
    const sessionObj = get().sessions.find((s) => s.id === sessionId)
    if (!sessionObj) return null

    const internals = getInternals(sessionId)
    const selectedModel = model ?? get().selectedModel

    // 初始化流式状态
    updateStreamingState(set, sessionId, {
      sending: true,
      thinking: false,
      pendingInteract: null
    })
    set({ error: null })
    internals.lastContentTime = Date.now()
    internals.pendingInteractRef = null

    // 创建 AbortController
    const ac = new AbortController()
    internals.abortController = ac

    const now = Date.now()
    const userMsg: AgentMessage = {
      id: tmpId('user'),
      role: 'user',
      content: content.trim(),
      createdAt: now
    }
    const assistantMsg: AgentMessage = {
      id: tmpId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: now
    }

    updateStreamingState(set, sessionId, {
      optimisticMessages: [userMsg, assistantMsg]
    })

    let lastUsage: AgentMessage['usage'] | undefined
    let lastModel: string | undefined
    let lastMemoryGrowth: AgentMessage['memoryGrowth'] | undefined
    let lastMessageId: string | undefined

    try {
      let fullContent = ''
      let segmentContent = ''
      let fullReasoning = ''
      const fullToolCalls: ToolCallRecord[] = []
      const parts: MessagePart[] = []
      let wasStopped = false
      let commandResultContent: string | null = null

      await http.streamChat(sessionId, content.trim(), {
        scope,
        signal: ac.signal,
        model: selectedModel,
        fileRefs,
        onChunk: (chunk) => {
          // SSE 心跳
          if (chunk.type === 'heartbeat') {
            const gap = Date.now() - internals.lastContentTime
            if (gap > 2000) {
              updateStreamingState(set, sessionId, { thinking: true })
            }
            return
          }
          // 收到任何内容事件，重置 thinking 状态
          internals.lastContentTime = Date.now()
          updateStreamingState(set, sessionId, { thinking: false })

          // memory_injected
          if (
            chunk.type === 'memory_injected' &&
            chunk.value &&
            typeof chunk.value === 'object' &&
            'user' in chunk.value &&
            'scope' in chunk.value &&
            'session' in chunk.value
          ) {
            updateStreamingState(set, sessionId, {
              lastInjectedMemories: chunk.value as {
                user: MemoryItem[]
                scope: MemoryItem[]
                session: MemoryItem[]
              }
            })
          }

          // 交互请求
          if (
            chunk.type === 'interact_request' &&
            chunk.value &&
            typeof chunk.value === 'object' &&
            'requestId' in chunk.value
          ) {
            const interact = chunk.value as InteractRequestPayload
            console.debug(
              '[agentStore] interact_request received: requestId=%s tool=%s paths=%s',
              interact.requestId,
              interact.toolName,
              interact.paths.join(', ')
            )
            internals.pendingInteractRef = interact
            updateStreamingState(set, sessionId, { pendingInteract: interact })
          }

          // command_result
          if (chunk.type === 'command_result' && typeof chunk.value === 'string') {
            commandResultContent = chunk.value
            updateOptimisticMessages(set, get, sessionId, (prev) => {
              if (prev.length < 1) return prev
              return [
                prev[0],
                {
                  id: tmpId('cmd'),
                  role: 'system',
                  content: chunk.value as string,
                  createdAt: Date.now()
                }
              ]
            })
          }

          // text
          if (chunk.type === 'text' && chunk.value) {
            fullContent += chunk.value
            segmentContent += chunk.value
            updateOptimisticMessages(set, get, sessionId, (prev) => {
              if (prev.length < 2) return prev
              const assistant = {
                ...prev[1],
                content: fullContent,
                ...(parts.length > 0
                  ? { parts: [...parts, { type: 'text' as const, content: segmentContent }] }
                  : {})
              }
              return [prev[0], assistant]
            })
          }

          // reasoning
          if (chunk.type === 'reasoning' && chunk.value) {
            fullReasoning += chunk.value
            updateOptimisticMessages(set, get, sessionId, (prev) => {
              if (prev.length < 2) return prev
              const assistant = {
                ...prev[1],
                content: prev[1].content,
                reasoning: fullReasoning
              }
              return [prev[0], assistant]
            })
          }

          // tool_result_chunk
          if (
            chunk.type === 'tool_result_chunk' &&
            chunk.value &&
            typeof chunk.value === 'object' &&
            'id' in chunk.value &&
            'chunk' in chunk.value
          ) {
            const { id, chunk: chunkText } = chunk.value as { id: string; chunk: string }
            if (segmentContent) {
              parts.push({ type: 'text', content: segmentContent })
              segmentContent = ''
            }
            const existing = parts.find(
              (p): p is MessagePartTool => p.type === 'tool' && p.id === id
            )
            const newParts: MessagePart[] = existing
              ? parts.map((p) =>
                  p.type === 'tool' && p.id === id ? { ...p, result: p.result + chunkText } : p
                )
              : [
                  ...parts,
                  { type: 'tool' as const, id, name: '\u2026', arguments: '', result: chunkText }
                ]
            parts.length = 0
            parts.push(...newParts)
            updateOptimisticMessages(set, get, sessionId, (prev) => {
              if (prev.length < 2) return prev
              return [
                prev[0],
                {
                  ...prev[1],
                  content: fullContent,
                  toolCalls: [...fullToolCalls],
                  parts: [...newParts]
                }
              ]
            })
          }

          // tool_call
          if (
            chunk.type === 'tool_call' &&
            chunk.value &&
            typeof chunk.value === 'object' &&
            'id' in chunk.value
          ) {
            const tc = chunk.value as ToolCallRecord
            console.debug(
              '[agentStore] tool_call received: status=%s id=%s name=%s',
              tc.status ?? 'done',
              tc.id,
              tc.name
            )
            // 交互完成后服务端恢复执行，清除交互卡片
            if (
              internals.pendingInteractRef &&
              tc.id === internals.pendingInteractRef.toolCallId &&
              (tc.status === 'running' || tc.status === 'done')
            ) {
              internals.pendingInteractRef = null
              updateStreamingState(set, sessionId, { pendingInteract: null })
            }
            const existingIdx = fullToolCalls.findIndex((t) => t.id === tc.id)
            if (existingIdx >= 0) fullToolCalls[existingIdx] = tc
            else fullToolCalls.push(tc)
            if (segmentContent) {
              parts.push({ type: 'text', content: segmentContent })
              segmentContent = ''
            }
            const existingTool = parts.find(
              (p): p is MessagePartTool => p.type === 'tool' && p.id === tc.id
            )
            const toolPart: MessagePartTool = {
              type: 'tool',
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments ?? '',
              result: tc.result ?? existingTool?.result ?? '',
              ...(tc.isError && { isError: true }),
              ...(tc.status && { status: tc.status })
            }
            if (existingTool) {
              const idx = parts.indexOf(existingTool)
              parts[idx] = toolPart
            } else {
              parts.push(toolPart)
            }
            updateOptimisticMessages(set, get, sessionId, (prev) => {
              if (prev.length < 2) return prev
              return [
                prev[0],
                {
                  ...prev[1],
                  content: fullContent,
                  toolCalls: [...fullToolCalls],
                  parts: [...parts]
                }
              ]
            })
          }

          // 独立 usage 事件
          if (chunk.type === 'usage' && chunk.value) {
            lastUsage = chunk.value as AgentMessage['usage']
          }

          // done
          if (chunk.type === 'done') {
            if (chunk.usage) lastUsage = chunk.usage
            if (chunk.model) lastModel = chunk.model
            if (chunk.stopped) wasStopped = true
            if (segmentContent) {
              parts.push({ type: 'text', content: segmentContent })
              segmentContent = ''
            }
            lastMemoryGrowth = chunk.memoryGrowth ?? undefined
            lastMessageId = chunk.messageId
            if (!commandResultContent) {
              updateOptimisticMessages(set, get, sessionId, (prev) => {
                if (prev.length < 2) return prev
                return [
                  prev[0],
                  {
                    ...prev[1],
                    id: lastMessageId ?? prev[1].id,
                    content: prev[1].content,
                    model: lastModel ?? prev[1].model,
                    usage: lastUsage ?? prev[1].usage,
                    toolCalls: fullToolCalls.length > 0 ? fullToolCalls : prev[1].toolCalls,
                    ...(parts.length > 0 && { parts: [...parts] }),
                    ...(fullReasoning && { reasoning: fullReasoning }),
                    ...(lastMemoryGrowth && { memoryGrowth: lastMemoryGrowth })
                  }
                ]
              })
            }
          }
        },
        onError: (msg) => {
          set({ error: msg })
        }
      })

      // 流式结束：将乐观消息合并进 sessions 中对应的 session
      set((state) => {
        const baseSession = state.sessions.find((s) => s.id === sessionId)
        if (!baseSession) return {}

        // 防御竞态：若已加载了包含最终消息的 session
        if (lastMessageId && baseSession.messages.some((m) => m.id === lastMessageId)) {
          return {}
        }

        let newMessages: AgentMessage[]
        if (commandResultContent != null) {
          newMessages = [
            ...baseSession.messages,
            userMsg,
            {
              id: tmpId('cmd'),
              role: 'system',
              content: commandResultContent,
              createdAt: Date.now()
            }
          ]
        } else {
          const assistantWithGrowth: AgentMessage = {
            ...assistantMsg,
            id: lastMessageId ?? assistantMsg.id,
            content: fullContent,
            model: lastModel,
            usage: lastUsage,
            ...(fullReasoning && { reasoning: fullReasoning }),
            ...(fullToolCalls.length > 0 && { toolCalls: fullToolCalls }),
            ...(parts.length > 0 && { parts: [...parts] }),
            ...(lastMemoryGrowth && { memoryGrowth: lastMemoryGrowth })
          }
          newMessages = [...baseSession.messages, userMsg, assistantWithGrowth]
        }

        return {
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, messages: newMessages } : s
          )
        }
      })

      // 清除乐观消息
      updateStreamingState(set, sessionId, { optimisticMessages: [] })
      await get().refreshSessions(scope)
      return commandResultContent ?? fullContent
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        // 停止时将已有内容合并进 session
        const currentOptimistic = get().streamingStates[sessionId]?.optimisticMessages ?? []
        if (currentOptimistic.length >= 2) {
          const assistant = currentOptimistic[1]
          if (assistant?.content) {
            set((state) => {
              const baseSession = state.sessions.find((s) => s.id === sessionId)
              if (!baseSession) return {}
              return {
                sessions: state.sessions.map((s) =>
                  s.id === sessionId
                    ? {
                        ...s,
                        messages: [
                          ...s.messages,
                          userMsg,
                          {
                            ...assistant,
                            content: assistant.content,
                            model: lastModel ?? assistant.model,
                            usage: lastUsage ?? assistant.usage,
                            ...(assistant.toolCalls?.length && { toolCalls: assistant.toolCalls }),
                            ...(assistant.parts?.length && { parts: assistant.parts }),
                            ...(assistant.reasoning && { reasoning: assistant.reasoning })
                          }
                        ]
                      }
                    : s
                )
              }
            })
          }
        }
        updateStreamingState(set, sessionId, { optimisticMessages: [] })
      } else {
        set({ error: err instanceof Error ? err.message : '发送失败' })
        updateStreamingState(set, sessionId, { optimisticMessages: [] })
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
      updateStreamingState(set, sessionId, {
        sending: false,
        thinking: false,
        pendingInteract: null
      })
    }
  }
}))

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
  interact: import('@prizm/client-core').InteractRequestPayload
} | null {
  for (const [sessionId, ss] of Object.entries(state.streamingStates)) {
    if (ss.pendingInteract != null) {
      return { sessionId, interact: ss.pendingInteract }
    }
  }
  return null
}
