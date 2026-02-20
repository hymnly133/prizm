/**
 * Agent 路由共享状态和工具函数
 */

import type { Request } from 'express'
import type { SessionChatStatus, OperationActor } from '@prizm/shared'
import { createLogger } from '../../logger'
import { getScopeFromQuery as _getScopeFromQuery } from '../../scopeUtils'
import { scopeStore, DEFAULT_SCOPE } from '../../core/ScopeStore'
import { emit } from '../../core/eventBus'

export const log = createLogger('Agent')

export function getScopeFromQuery(req: Request): string {
  return _getScopeFromQuery(req) ?? DEFAULT_SCOPE
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

/**
 * 更新 session 的 chatStatus 并持久化 + 发送事件。
 * 仅在状态实际变化时执行，避免冗余写入。
 */
export function setSessionChatStatus(
  scope: string,
  sessionId: string,
  chatStatus: SessionChatStatus,
  actor?: OperationActor
): void {
  try {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) return
    const prev = session.chatStatus ?? 'idle'
    if (prev === chatStatus) return
    session.chatStatus = chatStatus
    session.updatedAt = Date.now()
    scopeStore.saveScope(scope)
    emit('agent:session.chatStatusChanged', { scope, sessionId, chatStatus, actor }).catch(() => {})
  } catch (e) {
    log.warn('Failed to set chatStatus:', sessionId, chatStatus, e)
  }
}

/**
 * 服务启动时重置所有 chatStatus='chatting' 的会话为 'idle'。
 * 防止上次进程异常退出导致的脏状态残留。
 */
export function resetStaleChatStatus(): void {
  try {
    for (const scope of scopeStore.getAllScopes()) {
      const data = scopeStore.getScopeData(scope)
      let dirty = false
      for (const session of data.agentSessions) {
        if (session.chatStatus === 'chatting') {
          session.chatStatus = 'idle'
          dirty = true
        }
      }
      if (dirty) scopeStore.saveScope(scope)
    }
  } catch (e) {
    log.warn('Failed to reset stale chatStatus:', e)
  }
}

/** 正在进行的 chat 流 AbortController 注册表，按 scope:sessionId 隔离 */
export const activeChats = new Map<string, AbortController>()

export function chatKey(scope: string, sessionId: string): string {
  return `${scope}:${sessionId}`
}
