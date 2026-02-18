/**
 * Agent Session Store 选择器 — 纯函数，从 store state 中派生数据
 *
 * 从 agentSessionStore 拆分出来，便于独立导入，也避免 Vite ESM 分析问题。
 */
import type { EnrichedSession, InteractRequestPayload } from '@prizm/client-core'
import type { SessionStreamingState } from './agentStreamingInternals'

export interface AgentSessionStoreStateForSelectors {
  sessions: EnrichedSession[]
  currentSessionId: string | null
  streamingStates: Record<string, SessionStreamingState>
}

/** 获取当前会话对象（从 sessions 列表中查找） */
export function selectCurrentSession(
  state: AgentSessionStoreStateForSelectors
): EnrichedSession | null {
  if (!state.currentSessionId) return null
  return state.sessions.find((s) => s.id === state.currentSessionId) ?? null
}

/** 获取当前会话的流式状态 */
export function selectCurrentStreamingState(
  state: AgentSessionStoreStateForSelectors
): SessionStreamingState | undefined {
  if (!state.currentSessionId) return undefined
  return state.streamingStates[state.currentSessionId]
}

/** 是否有任何会话正在流式输出（用于导航栏后台指示器） */
export function selectAnySessionSending(state: AgentSessionStoreStateForSelectors): boolean {
  return Object.values(state.streamingStates).some((ss) => ss.sending)
}

/** 是否有任何会话正在等待用户交互（用于全局提示） */
export function selectAnyPendingInteract(state: AgentSessionStoreStateForSelectors): boolean {
  return Object.values(state.streamingStates).some((ss) => ss.pendingInteract != null)
}

/** 获取所有有待交互请求的会话 ID 集合 */
export function selectPendingInteractSessionIds(
  state: AgentSessionStoreStateForSelectors
): Set<string> {
  const ids = new Set<string>()
  for (const [sessionId, ss] of Object.entries(state.streamingStates)) {
    if (ss.pendingInteract != null) ids.add(sessionId)
  }
  return ids
}

/** 获取第一个待交互请求的详细信息（用于全局通知） */
export function selectFirstPendingInteract(state: AgentSessionStoreStateForSelectors): {
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
