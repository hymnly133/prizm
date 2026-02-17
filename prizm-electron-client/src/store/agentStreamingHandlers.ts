/**
 * Agent SSE 流式处理 — chunk 处理与流式状态更新
 *
 * 接收 store 的 get/set，更新 streaming state 与 optimistic messages。
 * 不依赖 React，可在任意上下文中调用。
 */
import type {
  AgentMessage,
  InteractRequestPayload,
  MessagePart,
  MessagePartTool,
  StreamChatChunk,
  ToolCallRecord
} from '@prizm/client-core'
import { createClientLogger, getTextContent } from '@prizm/client-core'
import type { MemoryItem } from '@prizm/shared'
import {
  DEFAULT_STREAMING_STATE,
  type SessionStreamingState,
  type StreamingInternals
} from './agentStreamingInternals'

const log = createClientLogger('AgentStream')

/** 流式处理所需的状态最小形状，便于与 store 的 set/get 兼容 */
export interface StreamingStateSlice {
  sessions: Array<{ id: string; messages: AgentMessage[] }>
  streamingStates: Record<string, SessionStreamingState>
}

/**
 * 与 zustand 的 set(getState => partial) 兼容的类型，避免 store 与 handlers 循环依赖。
 * 使用 unknown 以便任意 store 的 set/get 均可传入。
 */
export type SetStateLike = (fn: (state: unknown) => unknown) => void
export type GetStateLike = () => unknown

/** 单次流式调用的累积状态 */
export interface StreamAccumulator {
  segmentContent: string
  fullReasoning: string
  parts: MessagePart[]
  lastUsage: AgentMessage['usage'] | undefined
  lastModel: string | undefined
  lastMemoryRefs: AgentMessage['memoryRefs'] | undefined
  lastMessageId: string | undefined
  wasStopped: boolean
  commandResultContent: string | null
}

function tmpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 辅助：更新指定会话的 streaming state */
export function updateStreamingState(
  set: SetStateLike,
  sessionId: string,
  patch: Partial<SessionStreamingState>
): void {
  set((state) => {
    const s = state as StreamingStateSlice
    const prev = s.streamingStates[sessionId] ?? { ...DEFAULT_STREAMING_STATE }
    return {
      streamingStates: {
        ...s.streamingStates,
        [sessionId]: { ...prev, ...patch }
      }
    }
  })
}

/** 辅助：更新指定会话的 optimisticMessages（函数式更新） */
export function updateOptimisticMessages(
  set: SetStateLike,
  get: GetStateLike,
  sessionId: string,
  updater: (prev: AgentMessage[]) => AgentMessage[]
): void {
  const s = get() as StreamingStateSlice
  const current = s.streamingStates[sessionId]?.optimisticMessages ?? []
  const next = updater(current)
  if (next === current) return
  updateStreamingState(set, sessionId, { optimisticMessages: next })
}

/** 创建一次流式调用的累积器 */
export function createStreamAccumulator(): StreamAccumulator {
  return {
    segmentContent: '',
    fullReasoning: '',
    parts: [],
    lastUsage: undefined,
    lastModel: undefined,
    lastMemoryRefs: undefined,
    lastMessageId: undefined,
    wasStopped: false,
    commandResultContent: null
  }
}

export interface ProcessChunkContext {
  set: SetStateLike
  get: GetStateLike
  sessionId: string
  internals: StreamingInternals
  acc: StreamAccumulator
}

/** 处理单条 SSE chunk，更新 store 与 acc */
export function processStreamChunk(chunk: StreamChatChunk, ctx: ProcessChunkContext): void {
  const { set, get, sessionId, internals, acc } = ctx

  // SSE 心跳
  if (chunk.type === 'heartbeat') {
    const gap = Date.now() - internals.lastContentTime
    if (gap > 2000) {
      updateStreamingState(set, sessionId, { thinking: true })
    }
    return
  }
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
    log.debug('Memory injected')
  }

  // 交互请求
  if (
    chunk.type === 'interact_request' &&
    chunk.value &&
    typeof chunk.value === 'object' &&
    'requestId' in chunk.value
  ) {
    const interact = chunk.value as InteractRequestPayload
    log.debug('Interact request:', interact.requestId, interact.toolName, interact.paths.join(', '))
    internals.pendingInteractRef = interact
    updateStreamingState(set, sessionId, { pendingInteract: interact })
  }

  // command_result
  if (chunk.type === 'command_result' && typeof chunk.value === 'string') {
    acc.commandResultContent = chunk.value
    updateOptimisticMessages(set, get, sessionId, (prev) => {
      if (prev.length < 1) return prev
      return [
        prev[0],
        {
          id: tmpId('cmd'),
          role: 'system',
          parts: [{ type: 'text' as const, content: chunk.value as string }],
          createdAt: Date.now()
        }
      ]
    })
  }

  // text
  if (chunk.type === 'text' && chunk.value) {
    acc.segmentContent += chunk.value
    updateOptimisticMessages(set, get, sessionId, (prev) => {
      if (prev.length < 2) return prev
      const liveParts = [
        ...acc.parts,
        { type: 'text' as const, content: acc.segmentContent }
      ]
      return [prev[0], { ...prev[1], parts: liveParts }]
    })
  }

  // reasoning
  if (chunk.type === 'reasoning' && chunk.value) {
    acc.fullReasoning += chunk.value
    updateOptimisticMessages(set, get, sessionId, (prev) => {
      if (prev.length < 2) return prev
      return [prev[0], { ...prev[1], reasoning: acc.fullReasoning }]
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
    if (acc.segmentContent) {
      acc.parts.push({ type: 'text', content: acc.segmentContent })
      acc.segmentContent = ''
    }
    const existing = acc.parts.find(
      (p): p is MessagePartTool => p.type === 'tool' && p.id === id
    )
    const newParts: MessagePart[] = existing
      ? acc.parts.map((p) =>
          p.type === 'tool' && p.id === id ? { ...p, result: p.result + chunkText } : p
        )
      : [
          ...acc.parts,
          {
            type: 'tool' as const,
            id,
            name: '\u2026',
            arguments: '',
            result: chunkText,
            status: 'running' as const
          }
        ]
    acc.parts.length = 0
    acc.parts.push(...newParts)
    updateOptimisticMessages(set, get, sessionId, (prev) => {
      if (prev.length < 2) return prev
      return [prev[0], { ...prev[1], parts: [...newParts] }]
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
    log.debug('Tool call:', tc.status ?? 'done', tc.id, tc.name)
    if (
      internals.pendingInteractRef &&
      tc.id === internals.pendingInteractRef.toolCallId &&
      (tc.status === 'running' || tc.status === 'done')
    ) {
      internals.pendingInteractRef = null
      updateStreamingState(set, sessionId, { pendingInteract: null })
    }
    if (acc.segmentContent) {
      acc.parts.push({ type: 'text', content: acc.segmentContent })
      acc.segmentContent = ''
    }
    const existingTool = acc.parts.find(
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
      const idx = acc.parts.indexOf(existingTool)
      acc.parts[idx] = toolPart
    } else {
      acc.parts.push(toolPart)
    }
    updateOptimisticMessages(set, get, sessionId, (prev) => {
      if (prev.length < 2) return prev
      return [prev[0], { ...prev[1], parts: [...acc.parts] }]
    })
  }

  // 独立 usage 事件
  if (chunk.type === 'usage' && chunk.value) {
    acc.lastUsage = chunk.value as AgentMessage['usage']
  }

  // done
  if (chunk.type === 'done') {
    if (chunk.usage) acc.lastUsage = chunk.usage
    if (chunk.model) acc.lastModel = chunk.model
    if (chunk.stopped) acc.wasStopped = true
    if (acc.segmentContent) {
      acc.parts.push({ type: 'text', content: acc.segmentContent })
      acc.segmentContent = ''
    }
    acc.lastMemoryRefs = chunk.memoryRefs ?? undefined
    acc.lastMessageId = chunk.messageId
    if (!acc.commandResultContent) {
      updateOptimisticMessages(set, get, sessionId, (prev) => {
        if (prev.length < 2) return prev
        return [
          prev[0],
          {
            ...prev[1],
            id: acc.lastMessageId ?? prev[1].id,
            parts: [...acc.parts],
            model: acc.lastModel ?? prev[1].model,
            usage: acc.lastUsage ?? prev[1].usage,
            ...(acc.fullReasoning && { reasoning: acc.fullReasoning }),
            ...(acc.lastMemoryRefs && { memoryRefs: acc.lastMemoryRefs })
          }
        ]
      })
    }
    log.info('Stream done, messageId:', acc.lastMessageId, 'model:', acc.lastModel)
  }
}

/** 流式正常结束后，将乐观消息合并进 sessions */
export function mergeOptimisticIntoSession(
  set: SetStateLike,
  get: GetStateLike,
  sessionId: string,
  acc: StreamAccumulator,
  userMsg: AgentMessage,
  assistantMsg: AgentMessage
): void {
  log.debug('Merging optimistic messages into session:', sessionId)
  set((state) => {
    const s = state as StreamingStateSlice
    const baseSession = s.sessions.find((sess) => sess.id === sessionId)
    if (!baseSession) return {}

    if (
      acc.lastMessageId &&
      baseSession.messages.some((m) => m.id === acc.lastMessageId)
    ) {
      return {}
    }

    let newMessages: AgentMessage[]
    if (acc.commandResultContent != null) {
      newMessages = [
        ...baseSession.messages,
        userMsg,
        {
          id: tmpId('cmd'),
          role: 'system' as const,
          parts: [{ type: 'text' as const, content: acc.commandResultContent }],
          createdAt: Date.now()
        }
      ]
    } else {
      const assistantFinal: AgentMessage = {
        ...assistantMsg,
        id: acc.lastMessageId ?? assistantMsg.id,
        parts: [...acc.parts],
        model: acc.lastModel,
        usage: acc.lastUsage,
        ...(acc.fullReasoning && { reasoning: acc.fullReasoning }),
        ...(acc.lastMemoryRefs && { memoryRefs: acc.lastMemoryRefs })
      }
      newMessages = [...baseSession.messages, userMsg, assistantFinal]
    }

    return {
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, messages: newMessages } : sess
      )
    }
  })
}

/** 用户停止后，将已有乐观 assistant 消息合并进 session */
export function mergeAbortedIntoSession(
  set: SetStateLike,
  get: GetStateLike,
  sessionId: string,
  userMsg: AgentMessage,
  lastModel: string | undefined,
  lastUsage: AgentMessage['usage'] | undefined
): void {
  log.debug('Merging aborted messages into session:', sessionId)
  const s = get() as StreamingStateSlice
  const currentOptimistic = s.streamingStates[sessionId]?.optimisticMessages ?? []
  if (currentOptimistic.length < 2) return
  const assistant = currentOptimistic[1]
  if (!getTextContent(assistant)) return

  set((state) => {
    const st = state as StreamingStateSlice
    const baseSession = st.sessions.find((sess) => sess.id === sessionId)
    if (!baseSession) return {}
    return {
      sessions: st.sessions.map((sess) =>
        sess.id === sessionId
          ? {
              ...sess,
              messages: [
                ...sess.messages,
                userMsg,
                {
                  ...assistant,
                  parts: assistant.parts,
                  model: lastModel ?? assistant.model,
                  usage: lastUsage ?? assistant.usage,
                  ...(assistant.reasoning && { reasoning: assistant.reasoning })
                }
              ]
            }
          : sess
      )
    }
  })
}
