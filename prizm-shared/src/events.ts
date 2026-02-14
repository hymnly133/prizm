/**
 * 服务端 WebSocket 事件类型
 * 单一数据源：数组为权威定义，对象形式供 server 键式访问
 */

import type {
  NotificationPayload,
  StickyNote,
  StickyNoteGroup,
  ClipboardItem,
  Document,
  PomodoroSession,
  TodoItem
} from './domain'

export const EVENT_TYPES = [
  'notification',
  'smtc:change',
  'note:created',
  'note:updated',
  'note:deleted',
  'group:created',
  'group:updated',
  'group:deleted',
  'todo_list:created',
  'todo_list:updated',
  'todo_list:deleted',
  'todo_item:created',
  'todo_item:updated',
  'todo_item:deleted',
  'pomodoro:started',
  'pomodoro:stopped',
  'clipboard:itemAdded',
  'clipboard:itemDeleted',
  'document:created',
  'document:updated',
  'document:deleted'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 对象形式，供 server 使用 EVENT_TYPES_OBJ.NOTE_CREATED 等键式访问 */
export const EVENT_TYPES_OBJ = {
  NOTIFICATION: 'notification',
  SMTC_CHANGE: 'smtc:change',
  NOTE_CREATED: 'note:created',
  NOTE_UPDATED: 'note:updated',
  NOTE_DELETED: 'note:deleted',
  GROUP_CREATED: 'group:created',
  GROUP_UPDATED: 'group:updated',
  GROUP_DELETED: 'group:deleted',
  TODO_LIST_CREATED: 'todo_list:created',
  TODO_LIST_UPDATED: 'todo_list:updated',
  TODO_LIST_DELETED: 'todo_list:deleted',
  TODO_ITEM_CREATED: 'todo_item:created',
  TODO_ITEM_UPDATED: 'todo_item:updated',
  TODO_ITEM_DELETED: 'todo_item:deleted',
  POMODORO_STARTED: 'pomodoro:started',
  POMODORO_STOPPED: 'pomodoro:stopped',
  CLIPBOARD_ITEM_ADDED: 'clipboard:itemAdded',
  CLIPBOARD_ITEM_DELETED: 'clipboard:itemDeleted',
  DOCUMENT_CREATED: 'document:created',
  DOCUMENT_UPDATED: 'document:updated',
  DOCUMENT_DELETED: 'document:deleted'
} as const satisfies Record<string, EventType>

/** 服务端全部事件类型（用于 subscribeEvents: "all"） */
export const ALL_EVENTS: readonly string[] = [...EVENT_TYPES]

/** 数据同步事件：便签/任务/剪贴板/文档变更时触发，用于客户端实时刷新列表 */
export const DATA_SYNC_EVENTS = [
  'note:created',
  'note:updated',
  'note:deleted',
  'todo_list:created',
  'todo_list:updated',
  'todo_list:deleted',
  'todo_item:created',
  'todo_item:updated',
  'todo_item:deleted',
  'clipboard:itemAdded',
  'clipboard:itemDeleted',
  'document:created',
  'document:updated',
  'document:deleted'
] as const

export type DataSyncEventType = (typeof DATA_SYNC_EVENTS)[number]

/** 判断是否为数据同步事件 */
export function isDataSyncEvent(eventType: string): eventType is DataSyncEventType {
  return (DATA_SYNC_EVENTS as readonly string[]).includes(eventType)
}

// ============ Event-Payload 类型映射 ============

/** 带 scope 和 sourceClientId 的通用事件载荷基类 */
export interface EventPayloadBase {
  scope?: string
  sourceClientId?: string
}

/** TODO 列表更新载荷（listId 显式，与 id 语义区分） */
export interface TodoListUpdatePayload extends EventPayloadBase {
  listId?: string
  title?: string
  itemCount?: number
  doneCount?: number
  items?: TodoItem[]
  updatedAt?: number
  deleted?: boolean
  /** 仅 title 变更时省略 items，客户端做本地合并 */
  itemsOmitted?: true
}

/** TODO 列表删除载荷 */
export interface TodoListDeletedPayload extends EventPayloadBase {
  scope: string
  listId?: string
  deleted: true
}

/** TODO 项删除载荷 */
export interface TodoItemDeletedPayload extends EventPayloadBase {
  itemId: string
  scope?: string
}

/** SMTC 媒体控制载荷 */
export interface SMTCPayload extends EventPayloadBase {
  sessionId?: string
  action: 'play' | 'pause' | 'stop' | 'skipNext' | 'skipPrevious' | 'toggle'
}

/** 各事件类型对应的 payload 类型 */
export interface EventPayloadMap {
  notification: NotificationPayload
  'smtc:change': SMTCPayload
  'note:created': Partial<StickyNote> & EventPayloadBase
  'note:updated': Partial<StickyNote> & EventPayloadBase
  'note:deleted': { id: string } & EventPayloadBase
  'group:created': Partial<StickyNoteGroup> & EventPayloadBase
  'group:updated': Partial<StickyNoteGroup> & EventPayloadBase
  'group:deleted': { id: string } & EventPayloadBase
  'todo_list:created': import('./domain').TodoList & { listId: string } & EventPayloadBase
  'todo_list:updated': TodoListUpdatePayload
  'todo_list:deleted': TodoListDeletedPayload
  'todo_item:created': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:updated': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:deleted': TodoItemDeletedPayload
  'pomodoro:started': PomodoroSession & EventPayloadBase
  'pomodoro:stopped': PomodoroSession & EventPayloadBase
  'clipboard:itemAdded': ClipboardItem & EventPayloadBase
  'clipboard:itemDeleted': { id: string } & EventPayloadBase
  'document:created': Partial<Document> & EventPayloadBase
  'document:updated': Partial<Document> & EventPayloadBase
  'document:deleted': { id: string } & EventPayloadBase
}

/** 类型安全的 EventPushMessage，payload 与 eventType 对应 */
export interface TypedEventPushMessage<T extends EventType = EventType> {
  type: 'event'
  eventType: T
  payload: EventPayloadMap[T]
  scope?: string
  timestamp: number
}
