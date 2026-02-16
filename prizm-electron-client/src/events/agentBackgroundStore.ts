/**
 * Agent 后台状态 - 从 agentSessionStore 派生
 * 当任意会话正在流式输出时返回 true，用于导航栏后台指示器
 * 当任意会话有待交互请求时返回 true，用于导航栏交互指示器
 */
import { useRef } from 'react'
import {
  useAgentSessionStore,
  selectAnySessionSending,
  selectAnyPendingInteract,
  selectPendingInteractSessionIds,
  selectFirstPendingInteract
} from '../store/agentSessionStore'
import type { InteractRequestPayload } from '@prizm/client-core'

/** React hook：订阅 agent 后台发送状态（任意会话正在流式输出） */
export function useAgentSending(): boolean {
  return useAgentSessionStore(selectAnySessionSending)
}

/** React hook：订阅是否有任意会话正在等待用户交互 */
export function useAgentPendingInteract(): boolean {
  return useAgentSessionStore(selectAnyPendingInteract)
}

/** Set 浅比较：仅当集合内容变化时才更新引用 */
export function usePendingInteractSessionIds(): Set<string> {
  const prevRef = useRef<Set<string>>(new Set())
  const next = useAgentSessionStore(selectPendingInteractSessionIds)
  const prev = prevRef.current
  if (prev.size === next.size) {
    let same = true
    for (const id of next) {
      if (!prev.has(id)) {
        same = false
        break
      }
    }
    if (same) return prev
  }
  prevRef.current = next
  return next
}

/** React hook：获取第一个待交互请求的详细信息（引用稳定） */
export function useFirstPendingInteract(): {
  sessionId: string
  interact: InteractRequestPayload
} | null {
  const prevRef = useRef<{ sessionId: string; interact: InteractRequestPayload } | null>(null)
  const next = useAgentSessionStore(selectFirstPendingInteract)
  const prev = prevRef.current
  if (prev === next) return prev
  if (
    prev != null &&
    next != null &&
    prev.sessionId === next.sessionId &&
    prev.interact.requestId === next.interact.requestId
  ) {
    return prev
  }
  prevRef.current = next
  return next
}
