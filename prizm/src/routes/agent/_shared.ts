/**
 * Agent 路由共享状态和工具函数
 */

import type { Request } from 'express'
import { createLogger } from '../../logger'
import { scopeStore, DEFAULT_SCOPE } from '../../core/ScopeStore'

export const log = createLogger('Agent')

export function getScopeFromQuery(req: Request): string {
  const s = req.query.scope
  return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_SCOPE
}

/**
 * 将 memoryRefs 写回已持久化的 assistant 消息。
 * appendMessage 在记忆处理之前调用，因此 memoryRefs 需要事后补写。
 */
export function persistMemoryRefs(
  scope: string,
  sessionId: string,
  messageId: string,
  memoryRefs: import('@prizm/shared').MemoryRefs
): void {
  try {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) return
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return
    ;(msg as unknown as Record<string, unknown>).memoryRefs = memoryRefs
    scopeStore.saveScope(scope)
  } catch (e) {
    log.warn('Failed to persist memoryRefs:', messageId, e)
  }
}

/** 正在进行的 chat 流 AbortController 注册表，按 scope:sessionId 隔离 */
export const activeChats = new Map<string, AbortController>()

export function chatKey(scope: string, sessionId: string): string {
  return `${scope}:${sessionId}`
}
