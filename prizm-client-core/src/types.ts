/**
 * Prizm Client Core - 客户端专用类型
 * 领域类型、Auth 类型、WebSocket 消息类型从 @prizm/shared 导入
 */

import type { MessageUsage, TokenUsageScope } from '@prizm/shared'

// 从 shared 重导出，供依赖 client-core 的包使用
export type {
  StickyNote,
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
  MessagePart,
  MessagePartTool,
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
export type {
  MemoryItem,
  RoundMemoryGrowth,
  TokenUsageRecord,
  TokenUsageScope,
  DedupLogEntry
} from '@prizm/shared'

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

/** 工具调用状态：preparing=参数填写中 running=执行中 done=已完成 */
export type ToolCallStatus = 'preparing' | 'running' | 'done'

/** 工具调用记录（SSE tool_call 事件） */
export interface ToolCallRecord {
  id: string
  name: string
  arguments: string
  result: string
  isError?: boolean
  /** 调用状态，默认 'done' 向后兼容 */
  status?: ToolCallStatus
}

/** Scope 交互记录（从工具调用解析） */
export interface ScopeInteraction {
  toolName: string
  action: 'read' | 'create' | 'update' | 'delete' | 'list' | 'search'
  itemKind?: 'note' | 'document' | 'todo' | 'clipboard'
  itemId?: string
  title?: string
  timestamp?: number
}

/** 工具结果流式分块（大 result 时先下发） */
export interface ToolResultChunkValue {
  id: string
  chunk: string
}

/** 记忆注入载荷：本轮 chat 注入的三层记忆 */
export interface MemoryInjectedPayload {
  user: import('@prizm/shared').MemoryItem[]
  scope: import('@prizm/shared').MemoryItem[]
  session: import('@prizm/shared').MemoryItem[]
}

/** SSE 流式 chunk：memory_injected / text / tool_result_chunk / tool_call / done / error */
export interface StreamChatChunk {
  type: string
  value?: string | ToolCallRecord | ToolResultChunkValue | MemoryInjectedPayload
  model?: string
  usage?: MessageUsage
  /** 是否因用户停止而提前结束 */
  stopped?: boolean
  /** 服务端生成的 assistant 消息 ID，用于替换客户端 tmpId */
  messageId?: string
  /** 本轮对话的记忆增长（done 时带回） */
  memoryGrowth?: import('@prizm/shared').RoundMemoryGrowth | null
}

export interface StreamChatOptions {
  model?: string
  /** 是否注入 scope 上下文，默认 true */
  includeScopeContext?: boolean
  /** 完全上下文轮数 A（可选，覆盖服务端设置） */
  fullContextTurns?: number
  /** 缓存轮数 B（可选，覆盖服务端设置） */
  cachedContextTurns?: number
  onChunk?: (chunk: StreamChatChunk) => void
  /** 流式错误回调 */
  onError?: (message: string) => void
  /** AbortSignal，用于前端主动取消流式请求 */
  signal?: AbortSignal
}

// ============ 会话级统计（仅 client-core） ============

/** 会话 token 用量聚合 */
export interface SessionTokenSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  /** 对话轮次数 */
  rounds: number
  /** 按模型分组统计 */
  byModel: Record<string, { input: number; output: number; total: number; count: number }>
  /** 按功能分类统计 */
  byScope?: Partial<
    Record<TokenUsageScope, { input: number; output: number; total: number; count: number }>
  >
}

/** 会话记忆创建聚合 */
export interface SessionMemorySummary {
  /** 本会话创建的记忆总数 */
  totalCount: number
  /** 按记忆类型统计 */
  byType: Record<string, number>
  /** 具体记忆列表 */
  memories: Array<{
    id: string
    memory: string
    memory_type?: string
    /** 关联的 assistant 消息 ID */
    messageId: string
  }>
}

/** GET /agent/sessions/:id/stats 返回结构 */
export interface SessionStats {
  sessionId: string
  scope: string
  tokenUsage: SessionTokenSummary
  memoryCreated: SessionMemorySummary
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
