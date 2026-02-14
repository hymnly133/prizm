/**
 * 领域数据类型 - 与服务器 API 结构对齐
 */

// ============ 便签 ============

export interface StickyNoteFileRef {
  path: string
}

export interface StickyNote {
  id: string
  content: string
  imageUrls?: string[]
  createdAt: number
  updatedAt: number
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

export interface StickyNoteGroup {
  id: string
  name: string
}

export interface CreateNotePayload {
  content?: string
  imageUrls?: string[]
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

export interface UpdateNotePayload {
  content?: string
  imageUrls?: string[]
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

// ============ TODO 列表 ============

export type TodoItemStatus = 'todo' | 'doing' | 'done'

/** 单个 TODO 项，以 item 为核心，list 为包装 */
export interface TodoItem {
  id: string
  title: string
  description?: string
  status: TodoItemStatus
  createdAt?: number
  updatedAt?: number
}

/** TODO 列表：一个 scope 一个列表，含标题和若干 TODO 项 */
export interface TodoList {
  id: string
  title: string
  items: TodoItem[]
  createdAt: number
  updatedAt: number
}

export interface UpdateTodoItemPayload {
  status?: TodoItemStatus
  title?: string
  description?: string
}

/** 创建 TODO 项（id 由服务端生成） */
export interface CreateTodoItemPayload {
  title: string
  description?: string
  status?: TodoItemStatus
}

/** @deprecated 使用 createTodoList/updateTodoListTitle/replaceTodoItems/createTodoItem/updateTodoItem/deleteTodoItem 替代 */
export interface UpdateTodoListPayload {
  title?: string
  items?: TodoItem[]
  updateItem?: { id: string } & UpdateTodoItemPayload
  updateItems?: Array<{ id: string } & UpdateTodoItemPayload>
}

// ============ 番茄钟 ============

export interface PomodoroSession {
  id: string
  taskId?: string
  startedAt: number
  endedAt: number
  durationMinutes: number
  tag?: string
}

// ============ 剪贴板 ============

export type ClipboardItemType = 'text' | 'image' | 'file' | 'other'

export interface ClipboardItem {
  id: string
  type: ClipboardItemType
  content: string
  sourceApp?: string
  createdAt: number
}

// ============ 文档 ============

export interface Document {
  id: string
  title: string
  content?: string
  /** LLM 生成的持久化摘要，用于 Agent 上下文 */
  llmSummary?: string
  createdAt: number
  updatedAt: number
}

export interface CreateDocumentPayload {
  title: string
  content?: string
}

export interface UpdateDocumentPayload {
  title?: string
  content?: string
  llmSummary?: string
}

// ============ Agent ============

/** Token 使用量（供后端流式完成后回传） */
export interface MessageUsage {
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
}

/** 单条工具调用（与 client-core ToolCallRecord 对齐，用于 parts） */
export interface MessagePartTool {
  type: 'tool'
  id: string
  name: string
  arguments: string
  result: string
  isError?: boolean
}

/** 消息段落：文本或工具调用，按流式顺序排列 */
export type MessagePart = { type: 'text'; content: string } | MessagePartTool

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  model?: string
  toolCalls?: unknown[]
  /** 按流式顺序的段落（文本 + 工具），存在时优先于 content+toolCalls 展示 */
  parts?: MessagePart[]
  /** token 使用量，后端 LLM 返回时填充 */
  usage?: MessageUsage
  /** 思考链 / reasoning，支持 thinking 的模型流式输出 */
  reasoning?: string
}

export interface AgentSession {
  id: string
  title?: string
  scope: string
  messages: AgentMessage[]
  /** LLM 生成的对话摘要，用于压缩长对话上下文 */
  llmSummary?: string
  createdAt: number
  updatedAt: number
}

// ============ Agent Scope / 上下文（API 与客户端类型） ============

/** 可引用项类型 */
export type ScopeRefKind = 'note' | 'todo' | 'document'

/** 顶层聚合类型 */
export type ScopeTopLevelKind = 'notes' | 'todoList' | 'document' | 'sessions'

/** 可引用的单条项（用于 @ 补全与 scope-items API） */
export interface ScopeRefItem {
  id: string
  kind: ScopeRefKind
  title: string
  charCount: number
  isShort: boolean
  updatedAt: number
  groupOrStatus?: string
}

/** 顶层元素（列表/文档/会话聚合） */
export interface ScopeTopLevelItem {
  kind: ScopeTopLevelKind
  id: string
  title: string
  itemCount: number
  totalCharCount: number
  updatedAt: number
  dataAvailable?: boolean
}

/** 工作区统计 */
export interface ScopeStats {
  totalItems: number
  totalChars: number
  byKind: Record<ScopeTopLevelKind, { count: number; chars: number }>
}

/** 会话中某条的提供状态 */
export interface ItemProvision {
  itemId: string
  kind: ScopeRefKind
  mode: 'summary' | 'full'
  providedAt: number
  charCount: number
  version: number
  stale: boolean
}

/** Agent 修改记录 */
export interface ModificationRecord {
  itemId: string
  type: ScopeRefKind
  action: 'create' | 'update' | 'delete'
  timestamp: number
}

/** 会话上下文追踪状态（GET /agent/sessions/:id/context） */
export interface SessionContextState {
  sessionId: string
  scope: string
  provisions: ItemProvision[]
  totalProvidedChars: number
  modifications: ModificationRecord[]
}

// ============ 通知 ============

export interface NotificationPayload {
  title: string
  body?: string
  /** 事件产生者 clientId，用于客户端判断是否为本机用户操作 */
  sourceClientId?: string
  /** 用于更新同一条通知而非新建，如 todo_list:{scope}:{id} 使 TODO 列表多次更新合并为一条 */
  updateId?: string
}
