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

/** 工具调用状态：preparing=参数填写中 running=执行中 done=已完成 */
export type ToolCallStatus = 'preparing' | 'running' | 'done'

/** 单次工具调用记录（用于 SSE 下发客户端展示） */
export interface ToolCallRecord {
  id: string
  name: string
  arguments: string
  result: string
  isError?: boolean
  /** 调用状态，默认 'done' 向后兼容 */
  status?: ToolCallStatus
}

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
  /** 单次工具执行完成，用于 SSE 下发客户端展示 */
  toolCall?: ToolCallRecord
  /** 工具结果分块（大 result 时先流式下发，再发完整 toolCall） */
  toolResultChunk?: { id: string; chunk: string }
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

  /** 更新会话（对话摘要、压缩轮次等） */
  updateSession?(
    scope: string,
    id: string,
    update: { llmSummary?: string; compressedThroughRound?: number }
  ): Promise<AgentSession>

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
      /** 已激活的 skill 指令（注入系统提示） */
      activeSkillInstructions?: Array<{ name: string; instructions: string }>
      /** 外部项目规则内容 */
      rulesContent?: string
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
