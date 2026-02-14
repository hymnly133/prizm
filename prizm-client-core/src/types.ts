/**
 * Prizm Client Core - 客户端专用类型
 * 领域类型、Auth 类型、WebSocket 消息类型从 @prizm/shared 导入
 */

import type { MessageUsage } from '@prizm/shared'

// 从 shared 重导出，供依赖 client-core 的包使用
export type {
  StickyNote,
  StickyNoteGroup,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  TodoItemStatus,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
  PomodoroSession,
  ClipboardItem,
  ClipboardItemType,
  Document,
  AgentSession,
  AgentMessage,
  MessageUsage,
  NotificationPayload,
  ClientInfo,
  ScopeDescription,
  ConnectedMessage,
  AuthenticatedMessage,
  RegisteredMessage,
  UnregisteredMessage,
  EventPushMessage,
  ErrorMessage,
  RegisterEventMessage,
  UnregisterEventMessage,
  AuthMessage,
  PingMessage
} from '@prizm/shared'

export {
  DEFAULT_SCOPE,
  ONLINE_SCOPE,
  EVENT_TYPES,
  ALL_EVENTS,
  DATA_SYNC_EVENTS
} from '@prizm/shared'
export type { EventType } from '@prizm/shared'

// ============ 客户端配置（仅 client-core） ============

export interface ServerConfig {
  host: string
  port: string
}

export interface ClientConfig {
  name: string
  auto_register: string
  requested_scopes: string[]
}

export interface TrayConfig {
  enabled: string
  minimize_to_tray: string
  show_notification: string
}

export interface PrizmConfig {
  server: ServerConfig
  client: ClientConfig
  api_key: string
  tray: TrayConfig
  /** 需要弹出通知的事件类型 */
  notify_events?: import('@prizm/shared').EventType[]
}

// ============ WebSocket 配置与消息（仅 client-core） ============

export interface WebSocketConfig {
  host: string
  port: number
  apiKey: string
  /** 订阅的事件类型，"all" 表示订阅全部已知事件，默认 ["notification"] */
  subscribeEvents?: string[] | 'all'
}

export type ServerMessage =
  | import('@prizm/shared').ConnectedMessage
  | import('@prizm/shared').AuthenticatedMessage
  | import('@prizm/shared').RegisteredMessage
  | import('@prizm/shared').UnregisteredMessage
  | import('@prizm/shared').EventPushMessage
  | import('@prizm/shared').ErrorMessage
  | { type: 'pong' }

export type ClientMessage =
  | import('@prizm/shared').AuthMessage
  | import('@prizm/shared').RegisterEventMessage
  | import('@prizm/shared').UnregisterEventMessage
  | import('@prizm/shared').PingMessage

export interface EventPushPayload {
  eventType: string
  payload: unknown
}

/** 通知窗口接收的载荷：含原始事件，用于自定义展示 */
export interface NotifyWindowPayload {
  eventType: string
  payload: unknown
  /** 用于合并同一条通知的多次更新，如 todo_list:{scope}:{id} */
  updateId?: string
  /** 兼容：主动通知 (POST /notify) 的 title/body */
  title?: string
  body?: string
  source?: string
}

export type WebSocketEventType = 'connected' | 'disconnected' | 'error' | 'notification' | 'event'

export interface WebSocketClientEventMap {
  connected: import('@prizm/shared').ConnectedMessage
  disconnected: void
  error: Error
  notification: import('@prizm/shared').NotificationPayload
  event: EventPushPayload
}

export type WebSocketEventHandler<T extends WebSocketEventType> = (
  data: WebSocketClientEventMap[T]
) => void

// ============ Agent 流式对话（仅 client-core） ============

/** SSE 流式 chunk：text 为文本片段，done 为结束（含 model、usage），error 为流式错误 */
export interface StreamChatChunk {
  type: string
  value?: string
  model?: string
  usage?: MessageUsage
  /** 是否因用户停止而提前结束 */
  stopped?: boolean
}

export interface StreamChatOptions {
  model?: string
  onChunk?: (chunk: StreamChatChunk) => void
  /** 流式错误回调 */
  onError?: (message: string) => void
  /** AbortSignal，用于前端主动取消流式请求 */
  signal?: AbortSignal
}

// ============ 统一搜索结果（仅 client-core） ============

export type SearchResultKind = 'note' | 'document' | 'clipboard' | 'todoList'

export interface SearchResult {
  kind: SearchResultKind
  id: string
  score: number
  matchedKeywords: string[]
  preview: string
  raw: unknown
}
