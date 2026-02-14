/**
 * Prizm Server 适配器接口
 * 这些接口定义了 Prizm 服务器与底层服务的交互契约
 */

import type {
  StickyNote,
  StickyNoteGroup,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  UpdateTodoListPayload,
  PomodoroSession,
  ClipboardItem,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  AgentSession,
  AgentMessage,
  MessageUsage
} from '../types'

// ============ Sticky Notes 适配器 ============

export interface IStickyNotesAdapter {
  /**
   * 获取所有便签
   * @param scope 数据 scope
   */
  getAllNotes?(scope: string): Promise<StickyNote[]>

  /**
   * 根据 ID 获取便签
   * @param scope 数据 scope
   */
  getNoteById?(scope: string, id: string): Promise<StickyNote | null>

  /**
   * 创建便签
   * @param scope 数据 scope
   */
  createNote?(scope: string, payload: CreateNotePayload): Promise<StickyNote>

  /**
   * 更新便签
   * @param scope 数据 scope
   */
  updateNote?(scope: string, id: string, payload: UpdateNotePayload): Promise<StickyNote>

  /**
   * 删除便签
   * @param scope 数据 scope
   */
  deleteNote?(scope: string, id: string): Promise<void>

  /**
   * 获取所有分组
   * @param scope 数据 scope
   */
  getAllGroups?(scope: string): Promise<StickyNoteGroup[]>

  /**
   * 创建分组
   * @param scope 数据 scope
   */
  createGroup?(scope: string, name: string): Promise<StickyNoteGroup>

  /**
   * 更新分组
   * @param scope 数据 scope
   */
  updateGroup?(scope: string, id: string, name: string): Promise<StickyNoteGroup>

  /**
   * 删除分组
   * @param scope 数据 scope
   */
  deleteGroup?(scope: string, id: string): Promise<void>
}

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

export interface ITodoListAdapter {
  getTodoList?(scope: string, options?: { itemId?: string }): Promise<TodoList | null>

  getTodoItem?(scope: string, itemId: string): Promise<TodoItem | null>

  updateTodoList?(scope: string, payload: UpdateTodoListPayload): Promise<TodoList>
}

// ============ 番茄钟适配器 ============

export interface IPomodoroAdapter {
  /**
   * 创建一个新的番茄钟会话（开始计时）
   */
  startSession?(scope: string, payload: { taskId?: string; tag?: string }): Promise<PomodoroSession>

  /**
   * 结束一个番茄钟会话（更新结束时间和时长）
   */
  stopSession?(scope: string, id: string): Promise<PomodoroSession>

  /**
   * 获取指定范围内的番茄钟记录
   */
  getSessions?(
    scope: string,
    filters?: { taskId?: string; from?: number; to?: number }
  ): Promise<PomodoroSession[]>
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

/** 流式 LLM 响应块（usage 在 done 时由 LLM 提供商回传，与 lobehub FinishData.usage 一致） */
export interface LLMStreamChunk {
  text?: string
  reasoning?: string
  done?: boolean
  /** token 使用量，流结束时返回 */
  usage?: MessageUsage
}

/** OpenAI 风格 tool 定义 */
export interface LLMTool {
  type: 'function'
  function: { name: string; description?: string; parameters?: object }
}

/** 非流式 LLM 响应（用于 tool calling 轮次） */
export interface LLMChatResult {
  content: string
  reasoning?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  usage?: MessageUsage
}

/** LLM 提供商接口（可插拔 OpenAI、Ollama 等） */
export interface ILLMProvider {
  chat(
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; temperature?: number; signal?: AbortSignal }
  ): AsyncIterable<LLMStreamChunk>

  /**
   * 非流式对话，支持 tools。用于 MCP tool calling 轮次。
   */
  chatNonStreaming?(
    messages: Array<
      | { role: string; content: string }
      | {
          role: 'assistant'
          content: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      | { role: 'tool'; tool_call_id: string; content: string }
    >,
    options?: { model?: string; temperature?: number; signal?: AbortSignal; tools?: LLMTool[] }
  ): Promise<LLMChatResult>
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

  /** 更新会话（标题等） */
  updateSession?(scope: string, id: string, update: { title?: string }): Promise<AgentSession>

  /** 流式对话，返回 SSE 流 */
  chat?(
    scope: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; signal?: AbortSignal; mcpEnabled?: boolean }
  ): AsyncIterable<LLMStreamChunk>
}

// ============ 适配器集合 ============

export interface PrizmAdapters {
  notes?: IStickyNotesAdapter
  notification?: INotificationAdapter
  todoList?: ITodoListAdapter
  pomodoro?: IPomodoroAdapter
  clipboard?: IClipboardAdapter
  documents?: IDocumentsAdapter
  agent?: IAgentAdapter
}
