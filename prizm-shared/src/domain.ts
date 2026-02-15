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
  tags?: string[]
  createdAt: number
  updatedAt: number
  fileRefs?: StickyNoteFileRef[]
}

export interface CreateNotePayload {
  content?: string
  imageUrls?: string[]
  tags?: string[]
  fileRefs?: StickyNoteFileRef[]
}

export interface UpdateNotePayload {
  content?: string
  imageUrls?: string[]
  tags?: string[]
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
  createdAt: number
  updatedAt: number
}

/** TODO 列表：一个 scope 可拥有若干个列表，各含标题和若干 TODO 项 */
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

/** 工具调用状态：preparing=参数填写中 running=执行中 done=已完成 */
export type ToolCallStatus = 'preparing' | 'running' | 'done'

/** 单条工具调用（与 client-core ToolCallRecord 对齐，用于 parts） */
export interface MessagePartTool {
  type: 'tool'
  id: string
  name: string
  arguments: string
  result: string
  isError?: boolean
  /** 调用状态，默认 'done' 向后兼容 */
  status?: ToolCallStatus
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
  /** 本轮对话的记忆增长（done 事件带回或懒加载） */
  memoryGrowth?: RoundMemoryGrowth | null
}

export interface AgentSession {
  id: string
  title?: string
  scope: string
  messages: AgentMessage[]
  /** LLM 生成的对话摘要，用于压缩长对话上下文 */
  llmSummary?: string
  /** 已压缩为 Session 记忆的轮次上界（滑动窗口 A/B 用） */
  compressedThroughRound?: number
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

// ============ 统一 Scope 活动记录 ============

/** 活动动作类型（覆盖读/写/删/列/搜全部操作） */
export type ScopeActivityAction = 'read' | 'create' | 'update' | 'delete' | 'list' | 'search'

/** 活动目标项类型 */
export type ScopeActivityItemKind = 'note' | 'todo' | 'document' | 'clipboard'

/** 统一 Scope 活动记录 */
export interface ScopeActivityRecord {
  /** 产出此活动的工具名 */
  toolName: string
  /** 动作类型 */
  action: ScopeActivityAction
  /** 目标项类型 */
  itemKind?: ScopeActivityItemKind
  /** 目标项 ID */
  itemId?: string
  /** 显示标题（如便签内容前缀、文档标题） */
  title?: string
  /** 活动时间戳 (ms) */
  timestamp: number
}

/** 会话上下文追踪状态（GET /agent/sessions/:id/context） */
export interface SessionContextState {
  sessionId: string
  scope: string
  provisions: ItemProvision[]
  totalProvidedChars: number
  /** 统一活动时间线 */
  activities: ScopeActivityRecord[]
}

// ============ 记忆模块 ============

/** 记忆模块设置（EverMemOS） */
export interface MemorySettings {
  /** 是否启用记忆模块 */
  enabled?: boolean
  /** 用于记忆处理的模型 ID，空则用默认 */
  model?: string
}

/** 单轮对话记忆增长（对话结束时返回，用于在消息旁展示标签） */
export interface RoundMemoryGrowth {
  /** 关联的 assistant 消息 ID */
  messageId: string
  /** 新增记忆总数 */
  count: number
  /** 按类型统计，如 { episodic_memory: 1, event_log: 3 } */
  byType: Record<string, number>
  /** 具体记忆列表（用于详情展示） */
  memories: MemoryItem[]
}

/** 单条记忆项（API 返回结构） */
export interface MemoryItem {
  id: string
  /** 记忆正文 */
  memory: string
  /** 用户标识 */
  user_id?: string
  /** 创建时间 ISO */
  created_at?: string
  /** 更新时间 ISO */
  updated_at?: string
  /** 元数据 */
  metadata?: Record<string, unknown>
  /** 搜索时的相似度/得分，仅搜索接口返回 */
  score?: number
  /** 分区：null/undefined=User 层；scope=Scope 层；scope:docs=文档记忆；scope:session:id=Session 层（列表接口返回用于 UI 分区） */
  group_id?: string | null
  /** 记忆类型（列表接口返回） */
  memory_type?: string
}

// ============ Dedup Log ============

/** 去重日志条目（API 返回结构） */
export interface DedupLogEntry {
  id: string
  /** 被保留的记忆 ID */
  kept_memory_id: string
  /** 被保留的记忆内容 */
  kept_memory_content: string | null
  /** 被抑制（去重）的新记忆内容 */
  new_memory_content: string
  /** 被抑制的新记忆类型 */
  new_memory_type: string
  /** 被抑制的新记忆元数据 JSON */
  new_memory_metadata: string | null
  /** 向量距离 */
  vector_distance: number | null
  /** LLM 判断理由 */
  llm_reasoning: string | null
  /** 用户标识 */
  user_id: string | null
  /** 分区 */
  group_id: string | null
  /** 创建时间 ISO */
  created_at: string
  /** 是否已回退：0=否 1=是 */
  rolled_back: number
}

// ============ Token Usage ============

/** 功能 scope：区分不同功能消耗的 token（与数据 scope 无关） */
export type TokenUsageScope =
  | 'chat' // 对话
  | 'document_summary' // 文档摘要
  | 'conversation_summary' // 对话摘要
  | 'memory' // 记忆

export interface TokenUsageRecord {
  id: string
  /** 功能维度，用于按功能统计 */
  usageScope: TokenUsageScope
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
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
