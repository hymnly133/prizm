/**
 * 领域数据类型 - 与服务器 API 结构对齐
 */

import { WORKFLOW_MANAGEMENT_SOURCE, WORKFLOW_MANAGEMENT_SESSION_LABEL_PENDING } from './constants'

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

// ============ 统一操作者身份 ============

/** 操作者身份标识 — Agent 和 User 统一使用 */
export interface OperationActor {
  /** 操作者类型：agent=AI agent，user=用户/API 客户端，system=系统内部 */
  type: 'agent' | 'user' | 'system'
  /** Agent session ID（仅 type='agent' 时有值） */
  sessionId?: string
  /** API 客户端 ID（仅 type='user' 时有值） */
  clientId?: string
  /** 操作来源标识，如 'tool:prizm_create_document' / 'api:documents' / 'api:restore' */
  source?: string
}

// ============ 文档版本 ============

/**
 * @deprecated 使用 OperationActor 替代
 */
export type VersionChangedBy = OperationActor

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
  /** 从 API 前缀缓存命中的输入 token 数 */
  cachedInputTokens?: number
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

export interface MessageContentOptions {
  /** 是否将 tool parts 序列化为摘要文本追加到内容中 */
  includeToolSummary?: boolean
  /** tool result 最大截取长度（默认 150） */
  toolResultMaxLen?: number
}

/**
 * 从 parts 中提取内容文本，可选附带工具调用摘要。
 * chat 历史构建使用 includeToolSummary:true 保留跨轮次工具上下文；
 * 记忆提取/摘要等场景不传或传 false，等同于 getTextContent。
 */
export function getMessageContent(
  msg: Pick<AgentMessage, 'parts'>,
  opts?: MessageContentOptions
): string {
  const textContent = getTextContent(msg)
  if (!opts?.includeToolSummary) return textContent

  const toolParts = msg.parts.filter((p): p is MessagePartTool => p.type === 'tool')
  if (toolParts.length === 0) return textContent

  const maxLen = opts.toolResultMaxLen ?? 150
  const toolLines = toolParts.map((t) => {
    const resultPreview = t.result.length > maxLen ? t.result.slice(0, maxLen) + '...' : t.result
    return `[${t.name}] ${t.isError ? 'ERROR: ' : ''}${resultPreview}`
  })

  const toolBlock = '<tool_history>\n' + toolLines.join('\n') + '\n</tool_history>'
  return textContent ? textContent + '\n\n' + toolBlock : toolBlock
}

// ============ Background Session 类型 ============

/** 会话使用场景：interactive=用户对话 background=触发器驱动 tool=工具会话（如工作流管理） */
export type SessionKind = 'interactive' | 'background' | 'tool'

/** 工具会话来源（派生类型），当前仅工作流管理 */
export type ToolSessionSource = typeof WORKFLOW_MANAGEMENT_SOURCE

/** 工具会话元数据 — 仅 kind='tool' 时有值；source 区分具体派生 */
export interface ToolSessionMeta {
  /** 派生类型，见 WORKFLOW_MANAGEMENT_SOURCE */
  source: ToolSessionSource
  /** 人类可读标签 */
  label?: string
  /** 所属工作流定义 ID（已绑定时有值） */
  workflowDefId?: string
  /** 所属工作流名称（已绑定时有值） */
  workflowName?: string
  /** 工作流工作区路径（跨 run 共享，已绑定工作流时有值） */
  persistentWorkspaceDir?: string
  /** 某次 run 的工作区路径（引用 run 并授权后可选设置，便于工具解析 workspace:"run"） */
  runWorkspaceDir?: string
}

/** 仅读取时兼容的旧 source 值（不再写入） */
const LEGACY_WORKFLOW_SOURCE_READ = 'workflow_management' as const

function isWorkflowManagementSource(source: string | undefined): boolean {
  return source === WORKFLOW_MANAGEMENT_SOURCE || source === LEGACY_WORKFLOW_SOURCE_READ
}

/** 判断是否为工具会话（与交互、背景并列的 session 类，可被下游派生为工作流管理等） */
export function isToolSession(
  s: { kind?: SessionKind; bgMeta?: { source?: string }; toolMeta?: { source?: string } } | null
): boolean {
  if (!s) return false
  if (s.kind === 'tool') return true
  if (s.kind === 'background' && isWorkflowManagementSource(s.bgMeta?.source)) return true
  return false
}

/** 判断是否为工作流管理会话（tool 派生或兼容的 legacy background） */
export function isWorkflowManagementSession(
  s: { kind?: SessionKind; bgMeta?: { source?: string }; toolMeta?: { source?: string } } | null
): boolean {
  if (!s) return false
  if (s.kind === 'tool' && isWorkflowManagementSource(s.toolMeta?.source)) return true
  if (s.kind === 'background' && isWorkflowManagementSource(s.bgMeta?.source)) return true
  return false
}

/** 工作流管理会话展示名：workflowName 优先，否则 label，否则使用待创建默认名 */
export function getWorkflowManagementSessionLabel(
  session: {
    workflowName?: string
    toolMeta?: { workflowName?: string; label?: string }
    bgMeta?: { workflowName?: string; label?: string }
  } | null,
  fallback: string = WORKFLOW_MANAGEMENT_SESSION_LABEL_PENDING
): string {
  if (!session) return fallback
  const name =
    session.workflowName ?? session.toolMeta?.workflowName ?? session.bgMeta?.workflowName
  const label = session.toolMeta?.label ?? session.bgMeta?.label
  return name || label || fallback
}

/** 是否在「聊天会话列表」中展示（排除工具会话与 task/workflow 触发的 background） */
export function isChatListSession(
  s: { kind?: SessionKind; bgMeta?: { source?: string }; toolMeta?: { source?: string } } | null
): boolean {
  if (!s) return false
  if (isToolSession(s)) return false
  if (s.toolMeta != null) return false
  if (s.kind !== 'background') return true
  const src = s.bgMeta?.source
  return !src || src === 'direct'
}

/**
 * 权限模式：
 * - default: 标准模式，写操作需审批
 * - acceptEdits: 自动批准编辑操作（BG Session 默认）
 * - bypassPermissions: 跳过所有权限检查
 * - plan: 只读模式，拒绝所有写操作
 * - dontAsk: 拒绝所有需要审批的操作
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'

/** 交互式会话的对话状态 */
export type SessionChatStatus = 'idle' | 'chatting'

/** BG Session 触发方式 */
export type BgTriggerType = 'tool_spawn' | 'api' | 'cron' | 'event_hook'

/** BG Session 上层来源：direct=直接触发 task=TaskRunner workflow=WorkflowRunner；workflow-management 仅用于兼容旧数据，新会话请用 kind=tool */
export type BgSessionSource = 'direct' | 'task' | 'workflow' | 'workflow-management'

/** BG Session 运行状态 */
export type BgStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'interrupted'

/** 会话级记忆策略 — 运行时可配置的豁免粒度 */
export interface SessionMemoryPolicy {
  /** 豁免 P1 每轮记忆抽取，BG 默认 true */
  skipPerRoundExtract?: boolean
  /** 豁免 P2 叙述性批量抽取，BG 默认 true */
  skipNarrativeBatchExtract?: boolean
  /** 豁免文档记忆抽取，BG 默认 false */
  skipDocumentExtract?: boolean
  /** 豁免对话摘要生成，BG 默认 true */
  skipConversationSummary?: boolean
  /** 自定义抽取提示词覆盖（BG 场景优化） */
  extractionPromptOverride?: string
}

/** Agent 定义 — 预定义的 Agent 模板，用于子任务工具隔离和行为定制 */
export interface AgentDefinition {
  /** 唯一 ID */
  id: string
  /** 人类可读名称 */
  name: string
  /** Agent 描述 */
  description?: string
  /** 系统提示词覆盖 */
  systemPrompt?: string
  /** 启用深度思考（reasoning chain），默认 true。 */
  thinking?: boolean
  /** 工具白名单（undefined 表示使用全部工具）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedTools?: string[]
  /** 可用的 Skill 名称白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedSkills?: string[]
  /** 可用的 MCP 服务器 ID 白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedMcpServerIds?: string[]
  /** 指定 LLM 模型 */
  model?: string
  /** 最大工具调用轮次 */
  maxTurns?: number
  /** 权限模式覆盖 */
  permissionMode?: PermissionMode
  /** 记忆抽取策略 */
  memoryPolicy?: SessionMemoryPolicy
  /** 记忆注入策略 */
  memoryInjectPolicy?: MemoryInjectPolicy
}

/** 记忆注入策略 — 控制注入哪些类型的记忆 */
export interface MemoryInjectPolicy {
  /** 注入的记忆类型白名单（undefined = 全部） */
  allowedTypes?: string[]
  /** 是否注入 User Profile（默认 true） */
  injectProfile?: boolean
  /** 自定义检索 query（覆盖用户消息作为 query） */
  customQuery?: string
  /** 最大注入条数（默认使用全局配置） */
  maxInjectCount?: number
}

/** Session 函数化 I/O 配置 — 将 Session 视为函数，定义输入输出契约 */
export interface SessionIOConfig {
  /** 输入参数（schema 描述 + 实际值，注入系统提示词） */
  inputParams?: {
    schema: Record<string, { type?: string; description?: string }>
    values: Record<string, unknown>
  }
  /** 输出参数（schema 描述，用于动态构建 prizm_set_result 工具） */
  outputParams?: {
    schema: Record<string, { type?: string; description?: string }>
    required?: string[]
  }
}

/** 后台会话元数据 — 仅 kind='background' 时有值 */
export interface BgSessionMeta {
  triggerType: BgTriggerType
  /** 父会话 ID（tool_spawn 时有值） */
  parentSessionId?: string
  /** 人类可读标签 */
  label?: string
  /** 指定 LLM 模型（可用廉价模型降低成本） */
  model?: string
  /** 最大执行时间 ms，默认 600_000 */
  timeoutMs?: number
  /** 完成后从内存追踪中自动清理（不删除持久化资源） */
  autoCleanup?: boolean
  /** 结果回传目标 session */
  announceTarget?: { sessionId: string; scope: string }
  /** 记忆策略覆盖 */
  memoryPolicy?: SessionMemoryPolicy
  /** 嵌套深度（spawn 链追踪，根 = 0） */
  depth?: number
  /** 引用的 AgentDefinition ID */
  agentDefinitionId?: string
  /** 内联 AgentDefinition（优先于 agentDefinitionId） */
  inlineAgentDef?: Omit<AgentDefinition, 'id' | 'name'>
  /** 记忆注入策略覆盖 */
  memoryInjectPolicy?: MemoryInjectPolicy
  /** 工作区目录覆盖（Workflow 步骤执行时指向当前 run 工作区） */
  workspaceDir?: string
  /** 工作流工作区路径（跨 run 共享，存放长期数据） */
  persistentWorkspaceDir?: string
  /** 上层来源：direct=直接触发 task=TaskRunner workflow=WorkflowRunner（默认 direct） */
  source?: BgSessionSource
  /** 关联的上层记录 ID（TaskRun.id 或 WorkflowRun.id） */
  sourceId?: string
  /** 函数化 I/O 配置（动态 prizm_set_result 工具 + 输入参数注入） */
  ioConfig?: SessionIOConfig
  /** 工具组开关覆盖：groupId → enabled */
  toolGroups?: Record<string, boolean>
  /** 所属工作流定义 ID（工作流管理会话：kind=tool 或 旧 background+workflow-management 时，双向引用） */
  workflowDefId?: string
  /** 所属工作流名称（工作流管理会话，用于展示与跳转） */
  workflowName?: string
  /** 工作流步骤 id 序列（仅 workflow 步骤，用于 workflow_context 片段） */
  workflowStepIds?: string[]
  /** 下一步步骤 id（仅 workflow 步骤，无则 null） */
  workflowNextStepId?: string | null
}

export interface AgentSession {
  id: string
  scope: string
  messages: AgentMessage[]
  /** LLM 生成的对话摘要，用于压缩长对话上下文 */
  llmSummary?: string
  /** 已压缩为 Session 记忆的轮次上界（滑动窗口 A/B 用） */
  compressedThroughRound?: number
  /** 压缩摘要链：每次压缩追加一段不可变摘要，用于 API 前缀缓存优化 */
  compressionSummaries?: Array<{ throughRound: number; text: string }>
  /** 用户授权的外部文件/文件夹路径列表（仅当前会话有效） */
  grantedPaths?: string[]
  /** 工具白名单（undefined = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedTools?: string[]
  /** 可用的 Skill 名称白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedSkills?: string[]
  /** 可用的 MCP 服务器 ID 白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedMcpServerIds?: string[]
  /** 会话 checkpoint 列表（按时间序，每轮对话前自动创建） */
  checkpoints?: SessionCheckpoint[]
  /** 会话使用场景，默认 'interactive'（向后兼容：无此字段 = interactive） */
  kind?: SessionKind
  /** 工具会话元数据（仅 kind='tool' 时有值） */
  toolMeta?: ToolSessionMeta
  /** 后台会话元数据 */
  bgMeta?: BgSessionMeta
  /** 后台运行状态 */
  bgStatus?: BgStatus
  /** 后台执行结果（由 prizm_set_result 工具写入） */
  bgResult?: string
  /** 后台结构化数据（由 prizm_set_result 的 structured_data 参数写入） */
  bgStructuredData?: string
  /** 后台产出文件列表（由 prizm_set_result 的 artifacts 参数写入，相对于工作区的路径） */
  bgArtifacts?: string[]
  /** 后台运行开始时间 */
  startedAt?: number
  /** 后台运行结束时间 */
  finishedAt?: number
  /** 交互式会话的对话状态：idle=空闲 chatting=正在对话 */
  chatStatus?: SessionChatStatus
  /** 工具权限模式 */
  permissionMode?: PermissionMode
  createdAt: number
  updatedAt: number
}

// ============ 会话 Checkpoint（回退点） ============

/** Checkpoint 关联的文件变更记录 */
export interface CheckpointFileChange {
  /** 相对路径（scope root 或外部绝对路径） */
  path: string
  /** 操作类型 */
  action: 'created' | 'modified' | 'deleted' | 'moved'
  /** 变更前的文件内容快照（created 时为空） */
  previousContent?: string
  /** 移动操作的源路径 */
  fromPath?: string
}

/** 会话 Checkpoint - 代表一个可回退的时间点 */
export interface SessionCheckpoint {
  /** 唯一 ID */
  id: string
  /** 所属会话 ID */
  sessionId: string
  /** checkpoint 创建时的消息数量（回退时截断到此处） */
  messageIndex: number
  /** 本轮用户消息内容（用于显示） */
  userMessage: string
  /** 创建时间 */
  createdAt: number
  /** 本轮完成后记录的文件变更列表 */
  fileChanges: CheckpointFileChange[]
  /** 本轮是否已完成（流式结束后标记） */
  completed: boolean
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
  /** 来源轮次消息 ID（Pipeline 1 单轮引用） */
  source_round_id?: string
  /** 来源轮次消息 ID 列表（Pipeline 2 多轮引用） */
  source_round_ids?: string[]
  /** 来源文档 ID（文档记忆） */
  source_document_id?: string
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
  | 'chat' // 对话（旧数据兼容，迁移前的未分类对话）
  | 'chat:user' // 用户交互对话
  | 'chat:workflow' // 工作流步骤执行
  | 'chat:task' // 任务 / Cron 定时任务执行
  | 'chat:tool-llm' // 已废弃，兼容旧 token 记录
  | 'chat:workflow-management' // 工作流管理会话
  | 'chat:background' // 未知后台系统操作（无法分类的 background session）
  | 'chat:guard' // 系统守卫（BG 结果检查 / Schema 重试）
  | 'conversation_summary' // 对话轮次摘要
  | 'memory:conversation_extract' // 对话记忆提取（unified: profile+narrative+foresight+event_log）
  | 'memory:per_round_extract' // Pipeline 1：每轮轻量抽取（event_log+profile+foresight）
  | 'memory:narrative_batch_extract' // Pipeline 2：阈值触发叙述性批量抽取（narrative+profile+foresight）
  | 'memory:document_extract' // 文档记忆提取（overview+fact）
  | 'memory:document_migration' // 文档迁移记忆
  | 'memory:dedup' // 记忆语义去重
  | 'memory:profile_merge' // 画像合并
  | 'memory:query_expansion' // 记忆查询扩展
  | 'memory:eventlog_extract' // 事件日志抽取（遗留 per-type，防御性保留）
  | 'memory:foresight_extract' // 前瞻抽取（遗留 per-type，防御性保留）
  | 'memory:episode_extract' // 叙事抽取（遗留 per-type，防御性保留）
  | 'memory:profile_extract' // 画像抽取（遗留 per-type，防御性保留）
  | 'document_summary' // 文档摘要（兼容旧数据）

/** Token 类别的中文标签，与 TokenUsageCategory 枚举对齐 */
export const TOKEN_CATEGORY_LABELS: Partial<Record<TokenUsageCategory, string>> = {
  chat: '对话（旧）',
  'chat:user': '对话',
  'chat:workflow': '工作流',
  'chat:task': '任务',
  'chat:tool-llm': '工具 LLM（旧）',
  'chat:workflow-management': '工作流管理',
  'chat:background': '后台系统',
  'chat:guard': '系统守卫',
  conversation_summary: '对话摘要',
  'memory:per_round_extract': '记忆提取（每轮·P1）',
  'memory:narrative_batch_extract': '记忆提取（叙述·P2）',
  'memory:conversation_extract': '记忆提取（对话·旧）',
  'memory:document_extract': '记忆提取（文档）',
  'memory:document_migration': '文档迁移记忆',
  'memory:dedup': '记忆去重',
  'memory:profile_merge': '画像合并',
  'memory:query_expansion': '查询扩展',
  'memory:eventlog_extract': '事件日志抽取',
  'memory:foresight_extract': '前瞻抽取',
  'memory:episode_extract': '叙事抽取',
  'memory:profile_extract': '画像抽取',
  document_summary: '文档摘要'
}

/** Token 类别的展示颜色 */
export const TOKEN_CATEGORY_COLORS: Partial<Record<TokenUsageCategory, string>> = {
  chat: '#1677ff',
  'chat:user': '#1677ff',
  'chat:workflow': '#0958d9',
  'chat:task': '#531dab',
  'chat:tool-llm': '#d46b08',
  'chat:workflow-management': '#d46b08',
  'chat:background': '#8c8c8c',
  'chat:guard': '#c41d7f',
  conversation_summary: '#722ed1',
  'memory:per_round_extract': '#08979c',
  'memory:narrative_batch_extract': '#006d75',
  'memory:conversation_extract': '#13c2c2',
  'memory:document_extract': '#52c41a',
  'memory:document_migration': '#fa8c16',
  'memory:dedup': '#eb2f96',
  'memory:profile_merge': '#faad14',
  'memory:query_expansion': '#2f54eb',
  'memory:eventlog_extract': '#597ef7',
  'memory:foresight_extract': '#9254de',
  'memory:episode_extract': '#36cfc9',
  'memory:profile_extract': '#ffc53d',
  document_summary: '#389e0d'
}

/** Token 类别的排序（UI 条形图 / 列表中的显示顺序） */
export const TOKEN_CATEGORY_ORDER: TokenUsageCategory[] = [
  'chat:user',
  'chat:workflow',
  'chat:task',
  'chat:workflow-management',
  'chat:tool-llm',
  'chat:background',
  'chat:guard',
  'chat',
  'conversation_summary',
  'memory:per_round_extract',
  'memory:narrative_batch_extract',
  'memory:conversation_extract',
  'memory:document_extract',
  'memory:document_migration',
  'memory:dedup',
  'memory:profile_merge',
  'memory:query_expansion',
  'memory:eventlog_extract',
  'memory:foresight_extract',
  'memory:episode_extract',
  'memory:profile_extract',
  'document_summary'
]

/** 判断类别是否属于对话系统（包括旧 'chat' 和新 'chat:*' 子类别） */
export function isChatCategory(cat: string): boolean {
  return cat === 'chat' || cat.startsWith('chat:')
}

/** 判断类别是否属于记忆系统 */
export function isMemoryCategory(cat: string): boolean {
  return cat.startsWith('memory:')
}

/** 格式化 token 数量为人类可读形式（1.2K / 3.5M） */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

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
  /** 从 API 前缀缓存命中的输入 token 数 */
  cachedInputTokens?: number
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

// ============ 日程 ============

/** 日程类型 */
export type ScheduleItemType = 'event' | 'reminder' | 'deadline'

/** 循环频率 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

/** 循环规则 */
export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  /** 每 N 个频率单位重复 */
  interval: number
  /** 0-6 (周日-周六), 仅 weekly */
  daysOfWeek?: number[]
  /** 1-31, 仅 monthly */
  dayOfMonth?: number
  /** 截止时间戳 (ms), 可选 */
  endDate?: number
  /** 最大重复次数, 可选 */
  maxOccurrences?: number
}

/** 日程关联项 */
export interface ScheduleLinkedItem {
  type: 'todo' | 'document'
  id: string
  title?: string
}

/** 日程状态 */
export type ScheduleStatus = 'upcoming' | 'active' | 'completed' | 'cancelled'

/** 日程项 */
export interface ScheduleItem {
  id: string
  title: string
  description?: string
  type: ScheduleItemType
  /** 开始时间 Unix ms */
  startTime: number
  /** 结束时间 Unix ms, event 类型必填 */
  endTime?: number
  allDay?: boolean
  recurrence?: RecurrenceRule
  /** 提前 N 分钟提醒 (如 [15, 60]) */
  reminders?: number[]
  linkedItems?: ScheduleLinkedItem[]
  tags?: string[]
  status: ScheduleStatus
  completedAt?: number
  /** 相对 scopeRoot 的路径（含文件名） */
  relativePath: string
  createdAt: number
  updatedAt: number
}

export interface CreateSchedulePayload {
  title: string
  description?: string
  type: ScheduleItemType
  startTime: number
  endTime?: number
  allDay?: boolean
  recurrence?: RecurrenceRule
  reminders?: number[]
  linkedItems?: ScheduleLinkedItem[]
  tags?: string[]
}

export interface UpdateSchedulePayload {
  title?: string
  description?: string
  type?: ScheduleItemType
  startTime?: number
  endTime?: number
  allDay?: boolean
  recurrence?: RecurrenceRule | null
  reminders?: number[] | null
  linkedItems?: ScheduleLinkedItem[]
  tags?: string[]
  status?: ScheduleStatus
}

// ============ 定时任务 (Cron) ============

export type CronJobStatus = 'active' | 'paused' | 'completed' | 'failed'

export type CronExecutionMode = 'isolated' | 'main'

export interface CronJob {
  id: string
  name: string
  description?: string
  scope: string
  /** cron 表达式 或 'once:{ISO时间戳}' */
  schedule: string
  /** IANA 时区, 默认系统时区 */
  timezone?: string
  /** 执行时发给 Agent 的提示词 */
  taskPrompt: string
  /** JSON 格式上下文 */
  taskContext?: string
  executionMode: CronExecutionMode
  /** 指定 LLM 模型 */
  model?: string
  timeoutMs?: number
  maxRetries?: number
  /** 关联的日程 ID */
  linkedScheduleId?: string
  status: CronJobStatus
  lastRunAt?: number
  lastRunStatus?: string
  nextRunAt?: number
  runCount: number
  createdAt: number
  updatedAt: number
}

export interface CronRunLog {
  id: string
  jobId: string
  sessionId?: string
  status: 'running' | 'success' | 'failed' | 'timeout'
  startedAt: number
  finishedAt?: number
  error?: string
  durationMs?: number
}

// ============ 任务执行 (Task Run) ============

export type TaskRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

/** 独立任务运行记录 — Workflow 子模块级复用组件，单步执行单元 */
export interface TaskRun {
  id: string
  scope: string
  label?: string
  status: TaskRunStatus
  /** 底层 BG Session ID（双向引用） */
  sessionId?: string
  /** 结构化输入 */
  input: {
    prompt: string
    context?: Record<string, unknown>
    expectedOutputFormat?: string
    model?: string
    timeoutMs?: number
  }
  /** 执行输出 */
  output?: string
  structuredData?: string
  artifacts?: string[]
  error?: string
  /** 触发来源 */
  triggerType: 'manual' | 'tool_spawn' | 'workflow_step'
  parentSessionId?: string
  createdAt: number
  finishedAt?: number
  durationMs?: number
}

// ============ 工作流引擎 (Workflow Engine) ============

export type WorkflowStepType = 'agent' | 'approve' | 'transform'

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 步骤完成后触发的 Prizm 系统联动操作 */
export interface WorkflowLinkedAction {
  type: 'create_todo' | 'update_todo' | 'create_document' | 'update_schedule' | 'notify'
  /** 支持 $stepId.output 变量引用 */
  params: Record<string, string>
}

/** 工作流声明式触发条件 */
export interface WorkflowTriggerDef {
  type: 'cron' | 'schedule_remind' | 'todo_completed' | 'document_saved'
  /** 事件过滤条件 */
  filter?: Record<string, string>
}

/** Agent 步骤的 Session 高级配置 */
export interface WorkflowStepSessionConfig {
  /** 启用深度思考（reasoning chain），默认 true。 */
  thinking?: boolean
  /** 激活的技能名称列表 */
  skills?: string[]
  /** 系统提示词覆盖/追加 */
  systemPrompt?: string
  /** 工具白名单（undefined = 使用全部工具）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedTools?: string[]
  /** 可用的 Skill 名称白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedSkills?: string[]
  /** 可用的 MCP 服务器 ID 白名单（空/未设置 = 全部）。用户未显式指定时保持留空，避免模型执行时误改导致工作流异常。 */
  allowedMcpServerIds?: string[]
  /** 指定 LLM 模型（覆盖步骤级 model） */
  model?: string
  /** 最大工具调用轮次 */
  maxTurns?: number
  /** 权限模式覆盖 */
  permissionMode?: PermissionMode
  /** 记忆抽取策略覆盖 */
  memoryPolicy?: SessionMemoryPolicy
  /** 记忆注入策略覆盖 */
  memoryInjectPolicy?: MemoryInjectPolicy
  /** 期望的输出格式描述 */
  expectedOutputFormat?: string
  /** JSON Schema 描述期望的输出结构（启用结构化输出验证） */
  outputSchema?: Record<string, unknown>
  /** Schema 验证失败时的最大重试次数 */
  maxSchemaRetries?: number
  /** 工具组开关覆盖：groupId → enabled */
  toolGroups?: Record<string, boolean>
}

/** 步骤级重试配置 */
export interface WorkflowStepRetryConfig {
  /** 最大重试次数，默认 0（不重试） */
  maxRetries?: number
  /** 重试间隔 ms */
  retryDelayMs?: number
  /** 哪些状态触发重试 */
  retryOn?: ('failed' | 'timeout')[]
}

/** 工作流步骤定义 */
export interface WorkflowStepDef {
  id: string
  type: WorkflowStepType
  /** 步骤描述（可选） */
  description?: string
  /** agent step 的 prompt */
  prompt?: string
  /** approve step 的审批提示 */
  approvePrompt?: string
  /** transform step 的 jq-like 表达式 */
  transform?: string
  /** 输入引用：'$prev.output' 或 '$stepId.output' */
  input?: string
  /** 条件表达式：'$stepId.approved' 等 */
  condition?: string
  model?: string
  timeoutMs?: number
  /** Agent 步骤的 Session 高级配置 */
  sessionConfig?: WorkflowStepSessionConfig
  /** 步骤级重试配置 */
  retryConfig?: WorkflowStepRetryConfig
  /** 步骤完成后触发的联动操作 */
  linkedActions?: WorkflowLinkedAction[]
}

/**
 * 工作空间模式：
 * - 'dual'（默认）: 双层工作空间，持久空间跨 run 共享 + run 级独立空间
 * - 'shared': 所有 run 共享同一个工作空间（旧 reuseWorkspace=true 行为）
 * - 'isolated': 每次 run 全新独立空间，run 结束后保留
 */
export type WorkflowWorkspaceMode = 'dual' | 'shared' | 'isolated'

/** 工作流运行配置 */
export interface WorkflowDefConfig {
  /** 工作流总超时 ms */
  maxTotalTimeoutMs?: number
  /** 错误策略：fail_fast=立即停止 continue=跳过失败步骤继续 */
  errorStrategy?: 'fail_fast' | 'continue'
  /** @deprecated 使用 workspaceMode 替代 */
  reuseWorkspace?: boolean
  /** @deprecated 使用 workspaceMode 替代 */
  cleanBefore?: boolean
  /** 工作空间模式（默认 'dual'） */
  workspaceMode?: WorkflowWorkspaceMode
  /** 完成时发送通知 */
  notifyOnComplete?: boolean
  /** 失败时发送通知 */
  notifyOnFail?: boolean
  /** 单步文本 output 最大字符数，超出截断并追加 "... (truncated)"；不配置则不限制 */
  maxStepOutputChars?: number
  /** 标签/分类 */
  tags?: string[]
  /** 版本号 */
  version?: string
}

/** 工作流定义 */
export interface WorkflowDef {
  name: string
  description?: string
  steps: WorkflowStepDef[]
  /** 流水线输入 schema，与 run.args 配合；每参数可带 description、default、type。有 default（含空）即可选，不填时用 default */
  args?: Record<string, { default?: unknown; description?: string; type?: string }>
  /** 工作流输出 schema（与 args 形态对称：description + type），传入最后一步做结构化对齐输出 */
  outputs?: Record<string, { type?: string; description?: string }>
  /** 声明式触发条件 */
  triggers?: WorkflowTriggerDef[]
  /** 工作流运行配置 */
  config?: WorkflowDefConfig
}

export type WorkflowStepResultStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'paused'

/** 单步执行结果 */
export interface WorkflowStepResult {
  stepId: string
  status: WorkflowStepResultStatus
  /** 步骤类型 */
  type?: WorkflowStepType
  output?: string
  /** 结构化数据（JSON 字符串，由 prizm_set_result 的 structured_data 写入） */
  structuredData?: string
  /** 产出文件列表（相对于 workflow 工作区的路径） */
  artifacts?: string[]
  /** agent step 关联的 BG Session ID */
  sessionId?: string
  /** approve step 的审批结果 */
  approved?: boolean
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** 简短错误消息 */
  error?: string
  /** 堆栈或完整错误详情（便于排查） */
  errorDetail?: string
}

/** 工作流运行实例 */
export interface WorkflowRun {
  id: string
  workflowName: string
  scope: string
  status: WorkflowRunStatus
  currentStepIndex: number
  stepResults: Record<string, WorkflowStepResult>
  resumeToken?: string
  args?: Record<string, unknown>
  /** 触发方式 */
  triggerType?: 'manual' | 'cron' | 'schedule' | 'event'
  linkedScheduleId?: string
  linkedTodoId?: string
  /** Run 级工作空间相对路径（相对于 workflow 工作区） */
  runWorkspaceDir?: string
  createdAt: number
  updatedAt: number
  /** Run 级简短错误消息 */
  error?: string
  /** Run 级堆栈或完整错误详情（便于排查） */
  errorDetail?: string
}

/** 已注册的工作流定义（持久化形态） */
export interface WorkflowDefRecord {
  id: string
  name: string
  scope: string
  yamlContent: string
  description?: string
  triggersJson?: string
  createdAt: number
  updatedAt: number
  /** 关联的工作流管理会话 ID（双向引用，一个工作流一个） */
  workflowManagementSessionId?: string
  /** 工作流描述/使用说明文档 ID（管理会话内至多一份指导文档可标记为此） */
  descriptionDocumentId?: string
}

/** 流水线版本快照项（列表用，无记忆功能） */
export interface WorkflowDefVersionItem {
  id: string
  createdAt: number
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

// ============ 路由层 DTO（富化响应类型） ============

/** 富化文档 DTO — 路由返回时附加锁和版本信息，领域类型 Document 保持不变 */
export interface EnrichedDocument extends Document {
  lockInfo?: ResourceLockInfo | null
  versionCount?: number
}

/** 富化会话 DTO — 路由返回时附加持有锁列表，领域类型 AgentSession 保持不变 */
export interface EnrichedSession extends AgentSession {
  heldLocks?: ResourceLockInfo[]
}
