/**
 * 服务端 WebSocket 事件类型
 * 单一数据源：数组为权威定义，对象形式供 server 键式访问
 */

import type {
  NotificationPayload,
  ClipboardItem,
  Document,
  TodoItem,
  TerminalSession
} from './domain'

export const EVENT_TYPES = [
  'notification',
  'smtc:change',
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
  'document:deleted',
  'file:created',
  'file:updated',
  'file:deleted',
  'file:moved',
  'terminal:created',
  'terminal:exited',
  'terminal:killed',
  'resource:locked',
  'resource:unlocked',
  'agent:session.created',
  'agent:session.deleted',
  'agent:session.rolledBack',
  'agent:message.completed',
  'bg:session.triggered',
  'bg:session.started',
  'bg:session.completed',
  'bg:session.failed',
  'bg:session.timeout',
  'bg:session.cancelled'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 对象形式，供 server 使用 EVENT_TYPES_OBJ.DOCUMENT_CREATED 等键式访问 */
export const EVENT_TYPES_OBJ = {
  NOTIFICATION: 'notification',
  SMTC_CHANGE: 'smtc:change',
  TODO_LIST_CREATED: 'todo_list:created',
  TODO_LIST_UPDATED: 'todo_list:updated',
  TODO_LIST_DELETED: 'todo_list:deleted',
  TODO_ITEM_CREATED: 'todo_item:created',
  TODO_ITEM_UPDATED: 'todo_item:updated',
  TODO_ITEM_DELETED: 'todo_item:deleted',
  CLIPBOARD_ITEM_ADDED: 'clipboard:itemAdded',
  CLIPBOARD_ITEM_DELETED: 'clipboard:itemDeleted',
  DOCUMENT_CREATED: 'document:created',
  DOCUMENT_UPDATED: 'document:updated',
  DOCUMENT_DELETED: 'document:deleted',
  FILE_CREATED: 'file:created',
  FILE_UPDATED: 'file:updated',
  FILE_DELETED: 'file:deleted',
  FILE_MOVED: 'file:moved',
  TERMINAL_CREATED: 'terminal:created',
  TERMINAL_EXITED: 'terminal:exited',
  TERMINAL_KILLED: 'terminal:killed',
  RESOURCE_LOCKED: 'resource:locked',
  RESOURCE_UNLOCKED: 'resource:unlocked',
  AGENT_SESSION_CREATED: 'agent:session.created',
  AGENT_SESSION_DELETED: 'agent:session.deleted',
  AGENT_SESSION_ROLLED_BACK: 'agent:session.rolledBack',
  AGENT_MESSAGE_COMPLETED: 'agent:message.completed',
  BG_SESSION_TRIGGERED: 'bg:session.triggered',
  BG_SESSION_STARTED: 'bg:session.started',
  BG_SESSION_COMPLETED: 'bg:session.completed',
  BG_SESSION_FAILED: 'bg:session.failed',
  BG_SESSION_TIMEOUT: 'bg:session.timeout',
  BG_SESSION_CANCELLED: 'bg:session.cancelled'
} as const satisfies Record<string, EventType>

/** 服务端全部事件类型（用于 subscribeEvents: "all"） */
export const ALL_EVENTS: readonly string[] = [...EVENT_TYPES]

/** 数据同步事件：任务/剪贴板/文档/文件变更时触发，用于客户端实时刷新列表 */
export const DATA_SYNC_EVENTS = [
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
  'document:deleted',
  'file:created',
  'file:updated',
  'file:deleted',
  'file:moved',
  'agent:session.created',
  'agent:session.deleted',
  'agent:session.rolledBack',
  'agent:message.completed',
  'bg:session.triggered',
  'bg:session.started',
  'bg:session.completed',
  'bg:session.failed',
  'bg:session.timeout',
  'bg:session.cancelled'
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

/** 文件事件载荷 */
export interface FileEventPayload extends EventPayloadBase {
  /** 相对 scopeRoot 的路径 */
  relativePath: string
  /** 旧路径（仅 file:moved 事件） */
  oldRelativePath?: string
  isDir?: boolean
}

/** 资源锁事件载荷 */
export interface ResourceLockEventPayload extends EventPayloadBase {
  resourceType: 'document' | 'todo_list'
  resourceId: string
  sessionId?: string
  reason?: string
}

/** Agent 会话事件载荷 */
export interface AgentSessionEventPayload extends EventPayloadBase {
  sessionId: string
}

/** Agent 会话回退事件载荷 */
export interface AgentSessionRolledBackPayload extends EventPayloadBase {
  sessionId: string
  checkpointId: string
  remainingMessageCount: number
}

/** Agent 消息完成事件载荷 */
export interface AgentMessageCompletedPayload extends EventPayloadBase {
  sessionId: string
}

/** BG Session 事件载荷 */
export interface BgSessionEventPayload extends EventPayloadBase {
  sessionId: string
  triggerType?: string
  parentSessionId?: string
  label?: string
  result?: string
  error?: string
  durationMs?: number
  timeoutMs?: number
}

/** 各事件类型对应的 payload 类型 */
export interface EventPayloadMap {
  notification: NotificationPayload
  'smtc:change': SMTCPayload
  'todo_list:created': import('./domain').TodoList & { listId: string } & EventPayloadBase
  'todo_list:updated': TodoListUpdatePayload
  'todo_list:deleted': TodoListDeletedPayload
  'todo_item:created': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:updated': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:deleted': TodoItemDeletedPayload
  'clipboard:itemAdded': ClipboardItem & EventPayloadBase
  'clipboard:itemDeleted': { id: string } & EventPayloadBase
  'document:created': Partial<Document> & EventPayloadBase
  'document:updated': Partial<Document> & EventPayloadBase
  'document:deleted': { id: string } & EventPayloadBase
  'file:created': FileEventPayload
  'file:updated': FileEventPayload
  'file:deleted': FileEventPayload
  'file:moved': FileEventPayload
  'terminal:created': TerminalSession & EventPayloadBase
  'terminal:exited': { id: string; exitCode: number; signal?: number } & EventPayloadBase
  'terminal:killed': { id: string } & EventPayloadBase
  'resource:locked': ResourceLockEventPayload
  'resource:unlocked': ResourceLockEventPayload
  'agent:session.created': AgentSessionEventPayload
  'agent:session.deleted': AgentSessionEventPayload
  'agent:session.rolledBack': AgentSessionRolledBackPayload
  'agent:message.completed': AgentMessageCompletedPayload
  'bg:session.triggered': BgSessionEventPayload
  'bg:session.started': BgSessionEventPayload
  'bg:session.completed': BgSessionEventPayload
  'bg:session.failed': BgSessionEventPayload
  'bg:session.timeout': BgSessionEventPayload
  'bg:session.cancelled': BgSessionEventPayload
}

/** 类型安全的 EventPushMessage，payload 与 eventType 对应 */
export interface TypedEventPushMessage<T extends EventType = EventType> {
  type: 'event'
  eventType: T
  payload: EventPayloadMap[T]
  scope?: string
  timestamp: number
}
