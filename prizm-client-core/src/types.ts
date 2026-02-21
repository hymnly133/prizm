/**
 * Prizm Client Core - 客户端专用类型
 * 领域类型、Auth 类型、WebSocket 消息类型从 @prizm/shared 导入
 */

import type { MessageUsage, TokenUsageCategory } from '@prizm/shared'

// 从 shared 重导出，供依赖 client-core 的包使用
export type {
  StickyNote,
  StickyNoteFileRef,
  FileEntry,
  FileReadResult,
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
  ToolCallStatus,
  SessionKind,
  BgTriggerType,
  BgStatus,
  BgSessionMeta,
  SessionMemoryPolicy,
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

export { getTextContent, getToolCalls } from '@prizm/shared'

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
  MemoryIdsByLayer,
  MemoryRefs,
  TokenUsageRecord,
  TokenUsageCategory,
  DedupLogEntry,
  ResourceLockInfo,
  EnrichedDocument,
  EnrichedSession,
  SessionCheckpoint,
  CheckpointFileChange
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

/** 工具调用记录（SSE tool_call 事件）—— 统一使用 @prizm/shared 的 MessagePartTool */
export type ToolCallRecord = import('@prizm/shared').MessagePartTool

/** Scope 交互记录（从工具调用解析） */
export interface ScopeInteraction {
  toolName: string
  action: 'read' | 'create' | 'update' | 'delete' | 'list' | 'search'
  itemKind?: 'document' | 'todo' | 'clipboard' | 'file'
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

/** 交互类型标识 */
export type InteractKind = 'file_access' | 'terminal_command' | 'destructive_operation' | 'custom'

/** 交互请求载荷：工具执行需要用户确认时发送 */
export interface InteractRequestPayload {
  /** 唯一请求 ID，用于回传交互结果 */
  requestId: string
  /** 关联的工具调用 ID */
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 交互类型 */
  kind: InteractKind
  /** 需要授权的路径列表 (file_access) */
  paths?: string[]
  /** 终端命令 (terminal_command) */
  command?: string
  /** 工作目录 (terminal_command) */
  cwd?: string
  /** 资源类型 (destructive_operation) */
  resourceType?: string
  /** 资源 ID (destructive_operation) */
  resourceId?: string
  /** 描述 (destructive_operation / custom) */
  description?: string
  /** 标题 (custom) */
  title?: string
}

/** 工具调用参数增量载荷 */
export interface ToolCallArgsDeltaValue {
  id: string
  name: string
  argumentsDelta: string
  argumentsSoFar: string
}

/** SSE 流式 chunk：memory_injected / text / tool_result_chunk / tool_call / tool_call_args_delta / interact_request / done / error */
export interface StreamChatChunk {
  type: string
  value?:
    | string
    | import('@prizm/shared').MessagePartTool
    | ToolResultChunkValue
    | ToolCallArgsDeltaValue
    | MemoryInjectedPayload
    | InteractRequestPayload
  model?: string
  usage?: MessageUsage
  /** 是否因用户停止而提前结束 */
  stopped?: boolean
  /** 服务端生成的 assistant 消息 ID，用于替换客户端 tmpId */
  messageId?: string
  /** 本轮记忆引用（done 时带回，仅存 ID） */
  memoryRefs?: import('@prizm/shared').MemoryRefs | null
}

export interface StreamChatOptions {
  model?: string
  /** 是否注入 scope 上下文，默认 true */
  includeScopeContext?: boolean
  /** 完全上下文轮数 A（可选，覆盖服务端设置） */
  fullContextTurns?: number
  /** 缓存轮数 B（可选，覆盖服务端设置） */
  cachedContextTurns?: number
  /** 文件路径引用，通过路径引用文件以便 agent 访问 */
  fileRefs?: import('@prizm/shared').FilePathRef[]
  /** 工作流 run 引用 ID 列表；管理会话下服务端会据此自动 grant 对应 run/步骤工作区路径 */
  runRefIds?: string[]
  /** 启用深度思考（reasoning / thinking chain） */
  thinking?: boolean
  onChunk?: (chunk: StreamChatChunk) => void
  /** 流式错误回调 */
  onError?: (message: string) => void
  /** AbortSignal，用于前端主动取消流式请求 */
  signal?: AbortSignal
}

export interface ObserveBgOptions {
  onChunk?: (chunk: StreamChatChunk) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

// ============ 会话级统计（仅 client-core） ============

/** 会话 token 用量聚合 */
export interface SessionTokenSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  /** API 前缀缓存命中的输入 token 总数 */
  totalCachedInputTokens?: number
  /** 对话轮次数 */
  rounds: number
  /** 按模型分组统计 */
  byModel: Record<string, { input: number; output: number; total: number; cached?: number; count: number }>
  /** 按功能类别统计 */
  byCategory?: Partial<
    Record<TokenUsageCategory, { input: number; output: number; total: number; cached?: number; count: number }>
  >
}

/** 会话记忆引用聚合 */
export interface SessionMemorySummary {
  /** 本会话创建的记忆总数 */
  totalCount: number
  /** 按层分类的记忆 ID */
  ids: { user: string[]; scope: string[]; session: string[] }
}

/** GET /agent/sessions/:id/stats 返回结构 */
export interface SessionStats {
  sessionId: string
  scope: string
  tokenUsage: SessionTokenSummary
  memoryCreated: SessionMemorySummary
  /** 本会话累计注入到上下文的记忆次数 */
  memoryInjectedTotal: number
}

// ============ 统一搜索结果（仅 client-core） ============

export type SearchResultKind = 'document' | 'clipboard' | 'todoList' | 'file'

export interface SearchResult {
  kind: SearchResultKind
  id: string
  score: number
  matchedKeywords: string[]
  preview: string
  raw: unknown
}
