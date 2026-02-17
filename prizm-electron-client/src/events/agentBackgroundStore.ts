/**
 * Agent 后台状态 - 从 agentSessionStore 派生
 * 当任意会话正在流式输出时返回 true，用于导航栏后台指示器
 * 当任意会话有待交互请求时返回 true，用于导航栏交互指示器
 *
 * 注意：返回非原始值的选择器必须提供自定义 equalityFn，
 * 否则 useSyncExternalStore 的 getSnapshot 每次返回新引用会触发无限循环。
 */
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  useAgentSessionStore,
  selectAnySessionSending,
  selectAnyPendingInteract,
  selectPendingInteractSessionIds,
  selectFirstPendingInteract
} from '../store/agentSessionStore'
import type { InteractRequestPayload } from '@prizm/client-core'

/** Set 浅比较 */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** 待交互信息浅比较 */
function pendingInteractEqual(
  a: { sessionId: string; interact: InteractRequestPayload } | null,
  b: { sessionId: string; interact: InteractRequestPayload } | null
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.sessionId === b.sessionId && a.interact.requestId === b.interact.requestId
}

/** React hook：订阅 agent 后台发送状态（任意会话正在流式输出） */
export function useAgentSending(): boolean {
  return useAgentSessionStore(selectAnySessionSending)
}

/** React hook：订阅是否有任意会话正在等待用户交互 */
export function useAgentPendingInteract(): boolean {
  return useAgentSessionStore(selectAnyPendingInteract)
}

/** React hook：获取所有有待交互请求的会话 ID 集合（引用稳定） */
export function usePendingInteractSessionIds(): Set<string> {
  return useStoreWithEqualityFn(useAgentSessionStore, selectPendingInteractSessionIds, setsEqual)
}

/** React hook：获取第一个待交互请求的详细信息（引用稳定） */
export function useFirstPendingInteract(): {
  sessionId: string
  interact: InteractRequestPayload
} | null {
  return useStoreWithEqualityFn(
    useAgentSessionStore,
    selectFirstPendingInteract,
    pendingInteractEqual
  )
}
