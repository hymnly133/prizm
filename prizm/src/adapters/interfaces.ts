/**
 * Prizm Server 适配器接口
 * 这些接口定义了 Prizm 服务器与底层服务的交互契约
 */

import type {
  TodoList,
  TodoItem,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
  ClipboardItem,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  AgentSession,
  AgentMessage,
  MessageUsage
} from '../types'

// ============ Notification 适配器 ============

export interface INotificationAdapter {
  /**
   * 发送通知信号
   * @param title 通知标题
   * @param body 通知内容
   */
  notify(title: string, body?: string): void
}

// ============ TODO 列表适配器 ============
// 设计：list 为包装层（含 title），item 为顶层元素，独立 CRUD。支持多 list 每 scope。

export interface CreateTodoItemPayloadExt extends CreateTodoItemPayload {
  /** 指定目标 list id，追加到该 list */
  listId?: string
  /** 新建 list 并添加 item（listTitle 作为新 list 的 title），优先于 listId */
  listTitle?: string
}

export interface ITodoListAdapter {
  /** 列出 scope 下所有 TodoList */
  getTodoLists(scope: string): Promise<TodoList[]>

  /** 按 listId 获取 list；或传 itemId 查找包含该 item 的 list */
  getTodoList(
    scope: string,
    listId?: string,
    options?: { itemId?: string }
  ): Promise<TodoList | null>

  /** 新建 list，返回新建的 list */
  createTodoList(scope: string, payload?: { title?: string }): Promise<TodoList>

  /** 更新 list 标题 */
  updateTodoListTitle(scope: string, listId: string, title: string): Promise<TodoList>

  /** 删除指定 list */
  deleteTodoList(scope: string, listId: string): Promise<void>

  /**
   * 创建 item。必须指定 listId（追加到已有 list）或 listTitle（新建 list 并添加），二者必填其一。
   */
  createTodoItem(
    scope: string,
    payload: CreateTodoItemPayloadExt
  ): Promise<{ list: TodoList; item: TodoItem }>

  updateTodoItem(
    scope: string,
    itemId: string,
    payload: UpdateTodoItemPayload
  ): Promise<TodoList | null>

  deleteTodoItem(scope: string, itemId: string): Promise<TodoList | null>

  /** 全量替换指定 list 的 items（items 可以是部分字段，adapter 负责补充 createdAt/updatedAt） */
  replaceTodoItems(
    scope: string,
    listId: string,
    items: Pick<TodoItem, 'id' | 'title' | 'status' | 'description'>[]
  ): Promise<TodoList>
}

// ============ 剪贴板历史适配器 ============

export interface IClipboardAdapter {
  /**
   * 记录一条剪贴板历史
   */
  addItem?(scope: string, item: Omit<ClipboardItem, 'id'>): Promise<ClipboardItem>

  /**
   * 获取剪贴板历史
   */
  getHistory?(scope: string, options?: { limit?: number }): Promise<ClipboardItem[]>

  /**
   * 删除某条历史记录
   */
  deleteItem?(scope: string, id: string): Promise<void>
}

// ============ 文档适配器 ============

export interface IDocumentsAdapter {
  getAllDocuments?(scope: string): Promise<Document[]>

  getDocumentById?(scope: string, id: string): Promise<Document | null>

  createDocument?(scope: string, payload: CreateDocumentPayload): Promise<Document>

  updateDocument?(scope: string, id: string, payload: UpdateDocumentPayload): Promise<Document>

  deleteDocument?(scope: string, id: string): Promise<void>
}

// ============ Agent  LLM 提供商 ============

/** 工具调用状态 —— 统一使用 @prizm/shared 定义 */
export type { ToolCallStatus } from '@prizm/shared'

/** 单次工具调用记录 —— 统一使用 @prizm/shared 的 MessagePartTool */
export type { MessagePartTool as ToolCallRecord } from '@prizm/shared'

import type { MessagePartTool } from '@prizm/shared'
/** 本文件内部使用的 ToolCallRecord 别名 */
type ToolCallRecord = MessagePartTool

/** 流式 LLM 响应块（usage 在 done 时由 LLM 提供商回传，与 lobehub FinishData.usage 一致） */
export interface LLMStreamChunk {
  text?: string
  reasoning?: string
  done?: boolean
  /** token 使用量，流结束时返回 */
  usage?: MessageUsage
  /** 工具调用，流结束时若有则一并返回（LobeChat 模式） */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  /** LLM 流式生成阶段，一旦检测到工具名即发出，让 UI 提前显示 preparing 卡片 */
  toolCallPreparing?: { id: string; name: string }
  /** 工具调用参数增量，流式生成期间逐 chunk 发出，用于 UI 实时显示参数填充 */
  toolCallArgsDelta?: { id: string; name: string; argumentsDelta: string; argumentsSoFar: string }
  /** 单次工具执行完成，用于 SSE 下发客户端展示 */
  toolCall?: ToolCallRecord
  /** 工具结果分块（大 result 时先流式下发，再发完整 toolCall） */
  toolResultChunk?: { id: string; chunk: string }
  /**
   * 交互请求：工具执行需要用户确认（如文件访问越界、敏感操作等）。
   * yield 此事件后，adapter 将阻塞等待用户通过 API 确认/拒绝。
   * 客户端应显示交互卡片并通过 POST /agent/sessions/:id/interact-response 响应。
   */
  interactRequest?: Record<string, unknown>
  /** 工具执行进度心跳（长时间运行的工具定期发送） */
  toolProgress?: {
    id: string
    name: string
    elapsedMs: number
  }
}

/** OpenAI 风格 tool 定义 */
export interface LLMTool {
  type: 'function'
  function: { name: string; description?: string; parameters?: object }
}

/** 消息类型：支持 assistant（含 tool_calls）和 tool 角色，用于多轮工具调用 */
export type LLMChatMessage =
  | { role: string; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/** LLM 提供商接口（可插拔 OpenAI、Ollama 等），LobeChat 模式：单一 chat 接口支持 tools */
export interface ILLMProvider {
  chat(
    messages: LLMChatMessage[],
    options?: {
      model?: string
      temperature?: number
      signal?: AbortSignal
      tools?: LLMTool[]
      /** 启用深度思考（reasoning / thinking chain） */
      thinking?: boolean
      /** 缓存路由键（OpenAI prompt_cache_key），相同 key 的请求优先路由到同一缓存节点 */
      promptCacheKey?: string
    }
  ): AsyncIterable<LLMStreamChunk>
}

// ============ Agent 适配器 ============

export interface IAgentAdapter {
  listSessions?(scope: string): Promise<AgentSession[]>

  getSession?(scope: string, id: string): Promise<AgentSession | null>

  createSession?(scope: string): Promise<AgentSession>

  deleteSession?(scope: string, id: string): Promise<void>

  appendMessage?(
    scope: string,
    sessionId: string,
    message: Omit<AgentMessage, 'id' | 'createdAt'>
  ): Promise<AgentMessage>

  getMessages?(scope: string, sessionId: string): Promise<AgentMessage[]>

  /** 更新会话（对话摘要、压缩轮次、授权路径、BG 状态、允许的 Skills/MCP 等） */
  updateSession?(
    scope: string,
    id: string,
    update: {
      llmSummary?: string
      compressedThroughRound?: number
      compressionSummaries?: Array<{ throughRound: number; text: string }>
      grantedPaths?: string[]
      allowedTools?: string[]
      allowedSkills?: string[]
      allowedMcpServerIds?: string[]
      kind?: import('@prizm/shared').SessionKind
      toolMeta?: import('@prizm/shared').ToolSessionMeta
      bgMeta?: import('@prizm/shared').BgSessionMeta
      bgStatus?: import('@prizm/shared').BgStatus
      bgResult?: string
      bgStructuredData?: string
      bgArtifacts?: string[]
      startedAt?: number
      finishedAt?: number
    }
  ): Promise<AgentSession>

  /**
   * 截断会话消息到指定位置，用于 checkpoint 回退。
   * 同时清除 checkpoint.messageIndex 之后的所有 checkpoint。
   */
  truncateMessages?(scope: string, sessionId: string, messageIndex: number): Promise<AgentSession>

  /**
   * 从 checkpoint 分叉出新 session，继承截止到 checkpointId 的消息。
   * 如未指定 checkpointId，则复制全部消息。
   */
  forkSession?(scope: string, sourceSessionId: string, checkpointId?: string): Promise<AgentSession>

  /** 流式对话，返回 SSE 流 */
  chat?(
    scope: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string
      signal?: AbortSignal
      mcpEnabled?: boolean
      /** 是否注入 scope 上下文（便签、待办、文档等），默认 true */
      includeScopeContext?: boolean
      /** 渐进式发现：仅注入技能 name+description，模型按需用 prizm_get_skill_instructions 拉取全文 */
      skillMetadataForDiscovery?: Array<{ name: string; description: string }>
      /** 已激活的 skill 完整指令（注入系统提示）；与 skillMetadataForDiscovery 二选一 */
      activeSkillInstructions?: Array<{ name: string; instructions: string }>
      /** 外部项目规则内容 */
      rulesContent?: string
      /** 用户自定义规则内容（用户级 + scope 级） */
      customRulesContent?: string
      /** 用户授权的外部文件路径列表 */
      grantedPaths?: string[]
      /** 工具白名单（AgentDefinition.allowedTools，undefined 表示全部） */
      allowedTools?: string[]
      /** 可用的 MCP 服务器 ID 白名单（空/未设置 = 全部） */
      allowedMcpServerIds?: string[]
      /** 启用深度思考 */
      thinking?: boolean
      /** 记忆系统消息文本（画像 + 上下文记忆），注入到消息末尾动态区 */
      memoryTexts?: string[]
      /** BG 前置系统消息（会话内不变），合并到静态前缀区 */
      systemPreamble?: string
      /** Slash 命令注入（本轮临时指令），注入到消息末尾动态区 */
      promptInjection?: string
      /** 工作流管理会话：当前工作流 YAML，注入 perTurn（cache 友好，不放入 static） */
      workflowEditContext?: string
    }
  ): AsyncIterable<LLMStreamChunk>
}

// ============ 适配器集合 ============

export interface PrizmAdapters {
  notification?: INotificationAdapter
  todoList?: ITodoListAdapter
  clipboard?: IClipboardAdapter
  documents?: IDocumentsAdapter
  agent?: IAgentAdapter
}
