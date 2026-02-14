/**
 * Prizm Server 默认适配器实现
 * 用于独立运行或测试场景
 */

import { createLogger } from '../logger'
import type {
  IStickyNotesAdapter,
  INotificationAdapter,
  ITodoListAdapter,
  IPomodoroAdapter,
  IClipboardAdapter,
  IDocumentsAdapter,
  IAgentAdapter,
  PrizmAdapters,
  LLMStreamChunk,
  LLMTool
} from './interfaces'
import type {
  StickyNote,
  StickyNoteGroup,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  TodoItemStatus,
  UpdateTodoListPayload,
  UpdateTodoItemPayload,
  PomodoroSession,
  ClipboardItem,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  AgentSession,
  AgentMessage
} from '../types'
import { scopeStore } from '../core/ScopeStore'
import { getLLMProvider } from '../llm'
import { getMcpClientManager } from '../mcp-client/McpClientManager'

const log = createLogger('Adapter')

// ============ 默认 Sticky Notes 适配器 ============

export class DefaultStickyNotesAdapter implements IStickyNotesAdapter {
  async getAllNotes(scope: string): Promise<StickyNote[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.notes]
  }

  async getNoteById(scope: string, id: string): Promise<StickyNote | null> {
    const data = scopeStore.getScopeData(scope)
    return data.notes.find((n) => n.id === id) ?? null
  }

  async createNote(scope: string, payload: CreateNotePayload): Promise<StickyNote> {
    const data = scopeStore.getScopeData(scope)
    const note: StickyNote = {
      id: Math.random().toString(36).substring(2, 15),
      content: payload.content ?? '',
      imageUrls: payload.imageUrls,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      groupId: payload.groupId,
      fileRefs: payload.fileRefs
    }
    data.notes.push(note)
    scopeStore.saveScope(scope)
    log.info('Note created:', note.id, 'scope:', scope)
    return note
  }

  async updateNote(scope: string, id: string, payload: UpdateNotePayload): Promise<StickyNote> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.notes.findIndex((n) => n.id === id)
    if (idx < 0) throw new Error(`Note not found: ${id}`)

    const existing = data.notes[idx]
    const updated: StickyNote = {
      ...existing,
      ...(payload.content !== undefined && { content: payload.content }),
      ...(payload.imageUrls !== undefined && { imageUrls: payload.imageUrls }),
      ...(payload.groupId !== undefined && { groupId: payload.groupId }),
      ...(payload.fileRefs !== undefined && { fileRefs: payload.fileRefs }),
      updatedAt: Date.now()
    }
    data.notes[idx] = updated
    scopeStore.saveScope(scope)
    log.info('Note updated:', id, 'scope:', scope)
    return updated
  }

  async deleteNote(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.notes.findIndex((n) => n.id === id)
    if (idx >= 0) {
      data.notes.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Note deleted:', id, 'scope:', scope)
    }
  }

  async getAllGroups(scope: string): Promise<StickyNoteGroup[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.groups]
  }

  async createGroup(scope: string, name: string): Promise<StickyNoteGroup> {
    const data = scopeStore.getScopeData(scope)
    const group: StickyNoteGroup = {
      id: Math.random().toString(36).substring(2, 15),
      name
    }
    data.groups.push(group)
    scopeStore.saveScope(scope)
    log.info('Group created:', group.id, 'scope:', scope)
    return group
  }

  async updateGroup(scope: string, id: string, name: string): Promise<StickyNoteGroup> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.groups.findIndex((g) => g.id === id)
    if (idx < 0) throw new Error(`Group not found: ${id}`)

    data.groups[idx] = { ...data.groups[idx], name }
    scopeStore.saveScope(scope)
    log.info('Group updated:', id, 'scope:', scope)
    return data.groups[idx]
  }

  async deleteGroup(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.groups.findIndex((g) => g.id === id)
    if (idx >= 0) {
      data.groups.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Group deleted:', id, 'scope:', scope)
    }
  }
}

// ============ 默认 Notification 适配器 ============

export class DefaultNotificationAdapter implements INotificationAdapter {
  notify(title: string, body?: string): void {
    log.info('Notify:', title, body ?? '')
  }
}

function ensureTodoItem(it: Partial<TodoItem> & { title: string }): TodoItem {
  const now = Date.now()
  return {
    id: (it as TodoItem).id ?? Math.random().toString(36).substring(2, 15),
    title: it.title,
    description: it.description,
    status: (it as TodoItem).status ?? 'todo',
    createdAt: (it as TodoItem).createdAt ?? now,
    updatedAt: (it as TodoItem).updatedAt ?? now
  }
}

// ============ 默认 TODO 列表适配器 ============

export class DefaultTodoListAdapter implements ITodoListAdapter {
  async getTodoList(scope: string, options?: { itemId?: string }): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const list = data.todoList
    if (!list) return null
    if (options?.itemId) {
      const item = list.items.find((it) => it.id === options.itemId)
      return item ? { ...list, items: [item] } : list
    }
    return list
  }

  async getTodoItem(scope: string, itemId: string): Promise<TodoItem | null> {
    const data = scopeStore.getScopeData(scope)
    return data.todoList?.items.find((it) => it.id === itemId) ?? null
  }

  async updateTodoList(scope: string, payload: UpdateTodoListPayload): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()

    if (!data.todoList) {
      const items = (payload.items ?? []).map((it) =>
        ensureTodoItem(it as Partial<TodoItem> & { title: string })
      )
      const list: TodoList = {
        id: Math.random().toString(36).substring(2, 15),
        title: payload.title ?? '待办',
        items,
        createdAt: now,
        updatedAt: now
      }
      data.todoList = list
      scopeStore.saveScope(scope)
      log.info('TodoList created:', list.id, 'scope:', scope)
      return list
    }

    const existing = data.todoList
    let items = [...existing.items]

    if (payload.updateItem) {
      const { id, ...upd } = payload.updateItem
      const idx = items.findIndex((it) => it.id === id)
      if (idx >= 0) {
        const cur = items[idx]
        items[idx] = {
          ...cur,
          ...(upd.status !== undefined && { status: upd.status as TodoItemStatus }),
          ...(upd.title !== undefined && { title: upd.title }),
          ...(upd.description !== undefined && { description: upd.description }),
          updatedAt: now
        }
      }
    }
    if (payload.updateItems?.length) {
      for (const { id, ...upd } of payload.updateItems) {
        const idx = items.findIndex((it) => it.id === id)
        if (idx >= 0) {
          const cur = items[idx]
          items[idx] = {
            ...cur,
            ...(upd.status !== undefined && { status: upd.status as TodoItemStatus }),
            ...(upd.title !== undefined && { title: upd.title }),
            ...(upd.description !== undefined && { description: upd.description }),
            updatedAt: now
          }
        }
      }
    }
    if (payload.items !== undefined && !payload.updateItem && !payload.updateItems?.length) {
      items = payload.items.map((it) => ensureTodoItem(it as Partial<TodoItem> & { title: string }))
    }

    if (items.length === 0) {
      data.todoList = null
      scopeStore.saveScope(scope)
      log.info('TodoList cleared (items empty), scope:', scope)
      return null
    }

    const updated: TodoList = {
      ...existing,
      ...(payload.title !== undefined && { title: payload.title }),
      items,
      updatedAt: now
    }
    data.todoList = updated
    scopeStore.saveScope(scope)
    log.info('TodoList updated:', updated.id, 'scope:', scope)
    return updated
  }
}

// ============ 默认 Pomodoro 适配器 ============

export class DefaultPomodoroAdapter implements IPomodoroAdapter {
  async startSession(
    scope: string,
    payload: { taskId?: string; tag?: string }
  ): Promise<PomodoroSession> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const session: PomodoroSession = {
      id: Math.random().toString(36).substring(2, 15),
      taskId: payload.taskId,
      startedAt: now,
      endedAt: now,
      durationMinutes: 0,
      tag: payload.tag
    }
    data.pomodoroSessions.push(session)
    scopeStore.saveScope(scope)
    log.info('Session started:', session.id, 'scope:', scope)
    return session
  }

  async stopSession(scope: string, id: string): Promise<PomodoroSession> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.pomodoroSessions.findIndex((s) => s.id === id)
    if (idx < 0) throw new Error(`Pomodoro session not found: ${id}`)

    const existing = data.pomodoroSessions[idx]
    const endedAt = Date.now()
    const durationMinutes = Math.max(0, Math.round((endedAt - existing.startedAt) / 60000))

    const updated: PomodoroSession = {
      ...existing,
      endedAt,
      durationMinutes
    }

    data.pomodoroSessions[idx] = updated
    scopeStore.saveScope(scope)
    log.info('Session stopped:', id, 'scope:', scope)
    return updated
  }

  async getSessions(
    scope: string,
    filters?: { taskId?: string; from?: number; to?: number }
  ): Promise<PomodoroSession[]> {
    const data = scopeStore.getScopeData(scope)
    let sessions = [...data.pomodoroSessions]

    if (filters?.taskId) {
      sessions = sessions.filter((s) => s.taskId === filters.taskId)
    }
    if (typeof filters?.from === 'number') {
      sessions = sessions.filter((s) => s.startedAt >= filters.from!)
    }
    if (typeof filters?.to === 'number') {
      sessions = sessions.filter((s) => s.startedAt <= filters.to!)
    }

    return sessions
  }
}

// ============ 默认 Clipboard 适配器 ============

export class DefaultClipboardAdapter implements IClipboardAdapter {
  async addItem(scope: string, item: Omit<ClipboardItem, 'id'>): Promise<ClipboardItem> {
    const data = scopeStore.getScopeData(scope)
    const record: ClipboardItem = {
      id: Math.random().toString(36).substring(2, 15),
      ...item
    }
    data.clipboard.unshift(record)
    scopeStore.saveScope(scope)
    log.info('Clipboard item added:', record.id, 'scope:', scope)
    return record
  }

  async getHistory(scope: string, options?: { limit?: number }): Promise<ClipboardItem[]> {
    const data = scopeStore.getScopeData(scope)
    const list = [...data.clipboard]
    if (typeof options?.limit === 'number') {
      return list.slice(0, options.limit)
    }
    return list
  }

  async deleteItem(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.clipboard.findIndex((c) => c.id === id)
    if (idx >= 0) {
      data.clipboard.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Clipboard item deleted:', id, 'scope:', scope)
    }
  }
}

// ============ 默认文档适配器 ============

export class DefaultDocumentsAdapter implements IDocumentsAdapter {
  async getAllDocuments(scope: string): Promise<Document[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.documents]
  }

  async getDocumentById(scope: string, id: string): Promise<Document | null> {
    const data = scopeStore.getScopeData(scope)
    return data.documents.find((d) => d.id === id) ?? null
  }

  async createDocument(scope: string, payload: CreateDocumentPayload): Promise<Document> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const doc: Document = {
      id: Math.random().toString(36).substring(2, 15),
      title: payload.title || '未命名文档',
      content: payload.content ?? '',
      createdAt: now,
      updatedAt: now
    }
    data.documents.push(doc)
    scopeStore.saveScope(scope)
    log.info('Document created:', doc.id, 'scope:', scope)
    return doc
  }

  async updateDocument(
    scope: string,
    id: string,
    payload: UpdateDocumentPayload
  ): Promise<Document> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.documents.findIndex((d) => d.id === id)
    if (idx < 0) throw new Error(`Document not found: ${id}`)

    const existing = data.documents[idx]
    const updated: Document = {
      ...existing,
      ...(payload.title !== undefined && { title: payload.title }),
      ...(payload.content !== undefined && { content: payload.content }),
      updatedAt: Date.now()
    }
    data.documents[idx] = updated
    scopeStore.saveScope(scope)
    log.info('Document updated:', id, 'scope:', scope)
    return updated
  }

  async deleteDocument(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.documents.findIndex((d) => d.id === id)
    if (idx >= 0) {
      data.documents.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Document deleted:', id, 'scope:', scope)
    }
  }
}

// ============ 默认 Agent 适配器 ============

export class DefaultAgentAdapter implements IAgentAdapter {
  async listSessions(scope: string): Promise<AgentSession[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.agentSessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getSession(scope: string, id: string): Promise<AgentSession | null> {
    const data = scopeStore.getScopeData(scope)
    return data.agentSessions.find((s) => s.id === id) ?? null
  }

  async createSession(scope: string): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const session: AgentSession = {
      id: Math.random().toString(36).substring(2, 15),
      title: '新会话',
      scope,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    data.agentSessions.push(session)
    scopeStore.saveScope(scope)
    log.info('Agent session created:', session.id, 'scope:', scope)
    return session
  }

  async deleteSession(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.agentSessions.findIndex((s) => s.id === id)
    if (idx >= 0) {
      data.agentSessions.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Agent session deleted:', id, 'scope:', scope)
    }
  }

  async updateSession(
    scope: string,
    id: string,
    update: { title?: string }
  ): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === id)
    if (!session) throw new Error(`Session not found: ${id}`)

    if (update.title !== undefined) {
      session.title = update.title
    }
    session.updatedAt = Date.now()
    scopeStore.saveScope(scope)
    log.info('Agent session updated:', id, 'scope:', scope)
    return { ...session }
  }

  async appendMessage(
    scope: string,
    sessionId: string,
    message: Omit<AgentMessage, 'id' | 'createdAt'>
  ): Promise<AgentMessage> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const now = Date.now()
    const msg: AgentMessage = {
      id: Math.random().toString(36).substring(2, 15),
      ...message,
      createdAt: now
    }
    session.messages.push(msg)
    session.updatedAt = now
    scopeStore.saveScope(scope)
    log.info('Agent message appended:', msg.id, 'session:', sessionId)
    return msg
  }

  async getMessages(scope: string, sessionId: string): Promise<AgentMessage[]> {
    const session = await this.getSession(scope, sessionId)
    return session ? [...session.messages] : []
  }

  async *chat(
    scope: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; signal?: AbortSignal; mcpEnabled?: boolean }
  ): AsyncIterable<LLMStreamChunk> {
    const provider = getLLMProvider()
    const mcpEnabled = options?.mcpEnabled !== false

    if (mcpEnabled && provider.chatNonStreaming) {
      const manager = getMcpClientManager()
      await manager.connectAll()
      const mcpTools = await manager.listAllTools()
      const llmTools: LLMTool[] = mcpTools.map((t) => ({
        type: 'function',
        function: {
          name: t.fullName,
          description: t.description,
          parameters: t.inputSchema
        }
      }))

      if (llmTools.length > 0) {
        const MAX_ROUNDS = 5
        let currentMessages: Array<
          | { role: string; content: string }
          | {
              role: 'assistant'
              content: string | null
              tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
            }
          | { role: 'tool'; tool_call_id: string; content: string }
        > = [...messages]
        let lastUsage: LLMStreamChunk['usage']
        let fullReasoning = ''

        for (let round = 0; round < MAX_ROUNDS; round++) {
          if (options?.signal?.aborted) break

          const result = await provider.chatNonStreaming(currentMessages, {
            model: options?.model,
            temperature: 0.7,
            signal: options?.signal,
            tools: llmTools
          })

          if (result.usage) {
            lastUsage = {
              totalTokens: result.usage.totalTokens,
              totalInputTokens: result.usage.totalInputTokens,
              totalOutputTokens: result.usage.totalOutputTokens
            }
          }
          if (result.reasoning) fullReasoning += result.reasoning

          if (!result.toolCalls?.length) {
            if (result.reasoning) yield { reasoning: result.reasoning }
            if (result.content) yield { text: result.content }
            yield { done: true, usage: lastUsage }
            return
          }

          currentMessages = [
            ...currentMessages,
            {
              role: 'assistant' as const,
              content: result.content || null,
              tool_calls: result.toolCalls.map((tc) => ({
                id: tc.id,
                function: { name: tc.name, arguments: tc.arguments }
              }))
            }
          ]

          for (const tc of result.toolCalls) {
            try {
              const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
              const toolResult = await manager.callTool(tc.name, args)
              const text =
                toolResult.content
                  ?.map((c) => ('text' in c ? c.text : JSON.stringify(c)))
                  .join('\n') ?? ''
              currentMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: toolResult.isError ? `Error: ${text}` : text
              })
            } catch (err) {
              currentMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`
              })
            }
          }
        }

        yield { text: '（MCP 工具调用达到最大轮次，请简化请求）' }
        yield { done: true, usage: lastUsage }
        return
      }
    }

    yield* provider.chat(messages, {
      model: options?.model,
      temperature: 0.7,
      signal: options?.signal
    })
  }
}

// ============ 创建默认适配器集合 ============

export function createDefaultAdapters(): PrizmAdapters {
  return {
    notes: new DefaultStickyNotesAdapter(),
    notification: new DefaultNotificationAdapter(),
    todoList: new DefaultTodoListAdapter(),
    pomodoro: new DefaultPomodoroAdapter(),
    clipboard: new DefaultClipboardAdapter(),
    documents: new DefaultDocumentsAdapter(),
    agent: new DefaultAgentAdapter()
  }
}
