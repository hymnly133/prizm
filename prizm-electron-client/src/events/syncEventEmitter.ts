/**
 * 同步事件发射器 - 用于 useFileList 等在不受 lastSyncEvent 上下文更新影响下监听数据变更
 * 避免每次 WebSocket 事件都导致 WorkPage 重渲染
 */
import type { EventType } from '@prizm/client-core'

export type SyncEventPayload = { id?: string; scope?: string } & Record<string, unknown>

export type SyncEventListener = (eventType: EventType, payload?: SyncEventPayload) => void

const listeners = new Set<SyncEventListener>()

export function subscribeSyncEvents(listener: SyncEventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitSyncEvent(eventType: EventType, payload?: SyncEventPayload): void {
  listeners.forEach((fn) => fn(eventType, payload))
}
