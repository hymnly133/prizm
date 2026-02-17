/**
 * Agent streaming internals — 流式内部上下文与类型
 *
 * 不放入 store state 的对象（AbortController、定时器等）与每会话流式状态常量。
 * 供 agentSessionStore 与 agentStreamingHandlers 使用。
 */
import type { AgentMessage, InteractRequestPayload } from '@prizm/client-core'
import type { MemoryItem } from '@prizm/shared'

/** 每会话的流式状态（与 store 中的 streamingStates 一致） */
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
export interface StreamingInternals {
  abortController: AbortController | null
  stopTimeout: ReturnType<typeof setTimeout> | null
  lastContentTime: number
  /** ref 追踪 pendingInteract，避免闭包问题 */
  pendingInteractRef: InteractRequestPayload | null
}

export const DEFAULT_STREAMING_STATE: SessionStreamingState = {
  sending: false,
  thinking: false,
  optimisticMessages: [],
  pendingInteract: null,
  lastInjectedMemories: null
}

/** 模块级：每会话的流式内部上下文 */
const _streamingInternals = new Map<string, StreamingInternals>()

export function getInternals(sessionId: string): StreamingInternals {
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
