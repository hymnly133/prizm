/**
 * 同步事件 store - 模块级，lastSyncEvent 变更仅通知订阅者，不触发全局重渲染
 */
import type { EventType } from '@prizm/client-core'
import { emitSyncEvent, type SyncEventPayload } from './syncEventEmitter'

type Listener = (eventType: EventType | null) => void

let lastSyncEvent: EventType | null = null
const listeners = new Set<Listener>()

export function setLastSyncEvent(eventType: EventType | null, payload?: SyncEventPayload): void {
  lastSyncEvent = eventType
  if (eventType) emitSyncEvent(eventType, payload)
  listeners.forEach((fn) => fn(eventType))
}

export function subscribeSyncEventStore(listener: Listener): () => void {
  listener(lastSyncEvent)
  listeners.add(listener)
  return () => listeners.delete(listener)
}
