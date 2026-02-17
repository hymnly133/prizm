/**
 * 领域数据类型 - 与服务器 API 结构对齐
 */

// ============ 便签（已废弃，保留类型用于迁移兼容） ============

/** @deprecated 已合并到 Document，仅用于迁移兼容 */
export interface StickyNoteFileRef {
  path: string
}

/** @deprecated 已合并到 Document，仅用于迁移兼容 */
export interface StickyNote {
  id: string
  content: string
  imageUrls?: string[]
  tags?: string[]
  createdAt: number
  updatedAt: number
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
  /** 相对 scopeRoot 的路径（含文件名） */
  relativePath: string
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

// ============ 番茄钟（已废弃） ============

/** @deprecated 番茄钟已移除，仅用于迁移兼容 */
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
  /** 可选标签 */
  tags?: string[]
  /** @deprecated 已替换为文档记忆系统（总览记忆），保留兼容存量数据 */
  llmSummary?: string
  /** 相对 scopeRoot 的路径（含文件名） */
  relativePath: string
  createdAt: number
  updatedAt: number
}

export interface CreateDocumentPayload {
  title: string
  content?: string
  tags?: string[]
  /** 可选：指定存放路径（相对 scopeRoot 的目录），默认存在 scopeRoot */
  directory?: string
}

export interface UpdateDocumentPayload {
  title?: string
  content?: string
  tags?: string[]
}

// ============ 文档版本 ============

/** 版本变更者信息 */
export interface VersionChangedBy {
  /** 变更者类型：user=用户手动操作，agent=AI agent 工具调用 */
  type: 'user' | 'agent'
  /** Agent session ID（仅 type='agent' 时有值） */
  sessionId?: string
  /** 操作来源标识，如 'tool:prizm_update_document' / 'api:PATCH' / 'api:restore' */
  apiSource?: string
}

/** 文档版本快照 */
export interface DocumentVersion {
  /** 自增版本号 */
  version: number
  /** 快照时间 ISO */
  timestamp: string
  /** 文档标题（快照时） */
  title: string
  /** 内容 hash（用于快速判断是否有变更） */
  contentHash: string
  /** 文档完整内容（仅单版本查询时返回，列表查询省略） */
  content?: string
  /** 变更者信息 */
  changedBy?: VersionChangedBy
  /** 变更原因/说明 */
  changeReason?: string
}

/** 单个文档的版本历史 */
export interface DocumentVersionHistory {
  documentId: string
  /** 版本列表，按 version 升序 */
  versions: DocumentVersion[]
}

// ============ 资源锁定 ============

/** 可锁定的资源类型 */
export type LockableResourceType = 'document' | 'todo_list'

/** 资源锁状态（API 返回） */
export interface ResourceLockInfo {
  id: string
  resourceType: LockableResourceType
  resourceId: string
  scope: string
  sessionId: string
  fenceToken: number
  reason?: string
  acquiredAt: number
  lastHeartbeat: number
  ttlMs: number
  metadata?: string
}

// ============ Agent 审计 ============

/** 审计日志条目（API 返回） */
export interface AgentAuditEntryInfo {
  id: string
  scope: string
  sessionId: string
  toolName: string
  action: string
  resourceType: string
  resourceId?: string
  resourceTitle?: string
  detail?: string
  memoryType?: string
  documentSubType?: string
  result: string
  errorMessage?: string
  timestamp: number
}

// ============ Agent ============

/** Token 使用量（供后端流式完成后回传） */
export interface MessageUsage {
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
}

/** 工具调用状态：preparing=参数填写中 running=执行中 awaiting_interact=等待用户交互 done=已完成 */
export type ToolCallStatus = 'preparing' | 'running' | 'awaiting_interact' | 'done'

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
  /** 有序段落数组（text + tool 交错排列）—— 唯一数据源 */
  parts: MessagePart[]
  createdAt: number
  model?: string
  /** token 使用量，后端 LLM 返回时填充 */
  usage?: MessageUsage
  /** 思考链 / reasoning，支持 thinking 的模型流式输出 */
  reasoning?: string
  /** 本轮记忆引用（解耦：仅存 ID，不嵌入内容） */
  memoryRefs?: MemoryRefs | null
}

// ============ AgentMessage 工具函数 ============

/** 从 parts 中拼接纯文本内容（替代旧 content 字段） */
export function getTextContent(msg: Pick<AgentMessage, 'parts'>): string {
  return msg.parts
    .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
    .map((p) => p.content)
    .join('')
}

/** 从 parts 中提取所有 tool 段落（替代旧 toolCalls 字段） */
export function getToolCalls(msg: Pick<AgentMessage, 'parts'>): MessagePartTool[] {
  return msg.parts.filter((p): p is MessagePartTool => p.type === 'tool')
}

export interface AgentSession {
  id: string
  scope: string
  messages: AgentMessage[]
  /** LLM 生成的对话摘要，用于压缩长对话上下文 */
  llmSummary?: string
  /** 已压缩为 Session 记忆的轮次上界（滑动窗口 A/B 用） */
  compressedThroughRound?: number
  /** 用户授权的外部文件/文件夹路径列表（仅当前会话有效） */
  grantedPaths?: string[]
  createdAt: number
  updatedAt: number
}

// ============ 文件路径引用 ============

/** 文件路径引用（通用的文件引用，可以是工作区内或外部文件） */
export interface FilePathRef {
  /** 文件绝对路径 */
  path: string
  /** 显示名称（文件名） */
  name: string
}

// ============ 通用文件系统（Layer 0） ============

/** 文件/目录条目（/files/list 返回结构） */
export interface FileEntry {
  name: string
  /** 相对 scopeRoot 的路径 */
  relativePath: string
  isDir: boolean
  isFile: boolean
  size?: number
  lastModified?: number
  children?: FileEntry[]
  /** 仅 Prizm 管理文件有此字段 */
  prizmType?: string
  /** 仅 Prizm 管理文件有此字段 */
  prizmId?: string
}

/** 文件读取结果（/files/read 返回结构） */
export interface FileReadResult {
  relativePath: string
  size: number
  lastModified: number
  /** 文件内容（UTF-8 文本） */
  content?: string
  /** 仅 Prizm 管理文件：解析后的 frontmatter */
  frontmatter?: Record<string, unknown>
  /** 仅 Prizm 管理文件的 prizm_type */
  prizmType?: string
}

// ============ Agent Scope / 上下文（API 与客户端类型） ============

/** 可引用项类型 */
export type ScopeRefKind = 'document' | 'todo' | 'file'

/** 顶层聚合类型 */
export type ScopeTopLevelKind = 'todoList' | 'document' | 'sessions' | 'files'

/** 可引用的单条项（用于 @ 补全与 scope-items API） */
export interface ScopeRefItem {
  id: string
  kind: ScopeRefKind
  title: string
  /** 文件相对路径 */
  relativePath?: string
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
export type ScopeActivityItemKind = 'todo' | 'document' | 'clipboard' | 'file'

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

/** 按存储层分类的记忆 ID 集合（用于精确 DB 路由） */
export interface MemoryIdsByLayer {
  /** User DB 中的记忆 ID（Profile 等） */
  user: string[]
  /** Scope DB 中的记忆 ID（Narrative / Foresight / Document） */
  scope: string[]
  /** Scope DB 中 Session 级别的记忆 ID */
  session: string[]
}

/** 解耦的双向记忆引用（消息侧，仅存 ID + 层级路由） */
export interface MemoryRefs {
  /** 本轮注入到上下文的记忆 ID（消费端） */
  injected: MemoryIdsByLayer
  /** 本轮产生的新记忆 ID（产出端） */
  created: MemoryIdsByLayer
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
  /** 分区：null/undefined=User 层；scope=Scope 层；scope:session:id=Session 层 */
  group_id?: string | null
  /** 记忆类型：profile / narrative / foresight / document / event_log */
  memory_type?: string
  /** 记忆层级：user / scope / session */
  memory_layer?: string
  /** 记忆来源类型：conversation / document / compression / manual */
  source_type?: string
  /** 来源会话 ID */
  source_session_id?: string
  /** 来源轮次消息 ID */
  source_round_id?: string
  /** 文档子类型：overview / fact / migration（仅 type=document 时有值） */
  sub_type?: string
  /** 累计被注入到对话上下文的次数（引用索引） */
  ref_count?: number
  /** 最近一次被引用的时间 ISO（引用索引） */
  last_ref_at?: string
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
  /** 向量距离（L2），-1 表示未使用向量匹配 */
  vector_distance: number | null
  /** 文本相似度分数 (0~1)，-1 表示未使用文本匹配 */
  text_similarity: number | null
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

/** Token 使用的功能类别，细粒度区分不同操作 */
export type TokenUsageCategory =
  | 'chat' // 对话
  | 'conversation_summary' // 对话轮次摘要
  | 'memory:conversation_extract' // 对话记忆提取（profile+narrative+foresight+event_log）
  | 'memory:document_extract' // 文档记忆提取（overview+fact）
  | 'memory:document_migration' // 文档迁移记忆
  | 'memory:dedup' // 记忆语义去重
  | 'memory:profile_merge' // 画像合并
  | 'memory:query_expansion' // 记忆查询扩展
  | 'document_summary' // 文档摘要（兼容旧数据）

export interface TokenUsageRecord {
  /** UUID，唯一标识 */
  id: string
  /** 功能类别 */
  category: TokenUsageCategory
  /** 数据 scope（'default' 等），用于按工作区统计 */
  dataScope: string
  /** 关联的 agent session ID（可选） */
  sessionId?: string
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// ============ 终端 ============

/** 终端会话类型：exec=一次性命令执行 interactive=持久交互终端 */
export type TerminalSessionType = 'exec' | 'interactive'

/** 终端会话状态 */
export type TerminalSessionStatus = 'running' | 'exited'

/** 终端会话（作为 Agent Session 的子资源） */
export interface TerminalSession {
  id: string
  /** 所属 Agent Session ID */
  agentSessionId: string
  /** 所属 scope */
  scope: string
  /** 终端类型 */
  sessionType: TerminalSessionType
  /** Shell 程序路径或名称 */
  shell: string
  /** 当前工作目录 */
  cwd: string
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 进程 PID */
  pid: number
  /** 终端标题（用户设置或从进程名获取） */
  title?: string
  /** 终端状态 */
  status: TerminalSessionStatus
  /** 退出码（仅 exited 状态） */
  exitCode?: number
  /** 退出信号（仅 exited 状态） */
  signal?: number
  /** 创建时间戳 (ms) */
  createdAt: number
  /** 最后活动时间戳 (ms) */
  lastActivityAt: number
}

/** 创建终端的请求参数 */
export interface CreateTerminalOptions {
  /** 所属 Agent Session ID */
  agentSessionId: string
  /** 所属 scope */
  scope: string
  /** 终端类型，默认 interactive */
  sessionType?: TerminalSessionType
  /** Shell 程序（默认系统默认 shell） */
  shell?: string
  /** 初始工作目录（相对 scope root 或绝对路径） */
  cwd?: string
  /** 列数，默认 80 */
  cols?: number
  /** 行数，默认 24 */
  rows?: number
  /** 终端标题 */
  title?: string
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
