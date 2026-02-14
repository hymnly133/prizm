/**
 * Prizm Server 默认适配器实现
 * 用于独立运行或测试场景
 */

import { createLogger } from '../logger'
import type {
  IStickyNotesAdapter,
  INotificationAdapter,
  ITodoListAdapter,
  CreateTodoItemPayloadExt,
  IPomodoroAdapter,
  IClipboardAdapter,
  IDocumentsAdapter,
  IAgentAdapter,
  PrizmAdapters,
  LLMStreamChunk,
  LLMTool,
  LLMChatMessage
} from './interfaces'
import type {
  StickyNote,
  StickyNoteGroup,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  TodoItemStatus,
  CreateTodoItemPayload,
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
import { genUniqueId } from '../id'
import { getLLMProvider } from '../llm'
import { scheduleDocumentSummary } from '../llm/documentSummaryService'
import { getMcpClientManager } from '../mcp-client/McpClientManager'
import { getTavilySettings } from '../settings/agentToolsStore'
import { searchTavily } from '../llm/tavilySearch'
import { buildSystemPrompt } from '../llm/systemPrompt'
import { processMessageAtRefs } from '../llm/atReferenceParser'
import { registerBuiltinAtReferences } from '../llm/atReferenceRegistry'
import { getBuiltinTools, executeBuiltinTool, BUILTIN_TOOL_NAMES } from '../llm/builtinTools'

const log = createLogger('Adapter')

/** 工具 result 超过此长度时先流式下发 tool_result_chunk，再发完整 tool_call */
const TOOL_RESULT_STREAM_THRESHOLD = 500
const TOOL_RESULT_CHUNK_SIZE = 200

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
      id: genUniqueId(),
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
      id: genUniqueId(),
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

function ensureTodoItem(
  it: Partial<TodoItem> & { title: string },
  usedIds?: Set<string>
): TodoItem {
  const now = Date.now()
  let id = (it as TodoItem).id
  if (!id || (usedIds && usedIds.has(id))) {
    id = genUniqueId()
  }
  usedIds?.add(id)
  return {
    id,
    title: it.title,
    description: it.description,
    status: (it as TodoItem).status ?? 'todo',
    createdAt: (it as TodoItem).createdAt ?? now,
    updatedAt: (it as TodoItem).updatedAt ?? now
  }
}

// ============ 默认 TODO 列表适配器 ============
// list 为包装层，item 独立 CRUD。支持多 list 每 scope。

function findListByItemId(lists: TodoList[], itemId: string): TodoList | null {
  return lists.find((l) => l.items.some((it) => it.id === itemId)) ?? null
}

export class DefaultTodoListAdapter implements ITodoListAdapter {
  async getTodoLists(scope: string): Promise<TodoList[]> {
    const data = scopeStore.getScopeData(scope)
    return [...(data.todoLists ?? [])]
  }

  async getTodoList(
    scope: string,
    listId?: string,
    options?: { itemId?: string }
  ): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    if (options?.itemId) {
      const list = findListByItemId(lists, options.itemId)
      if (!list) return null
      const item = list.items.find((it) => it.id === options.itemId)
      return item ? { ...list, items: [item] } : list
    }
    if (listId) {
      return lists.find((l) => l.id === listId) ?? null
    }
    return lists[0] ?? null
  }

  async createTodoList(scope: string, payload?: { title?: string }): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const list: TodoList = {
      id: genUniqueId(),
      title: payload?.title ?? '待办',
      items: [],
      createdAt: now,
      updatedAt: now
    }
    if (!data.todoLists) data.todoLists = []
    data.todoLists.push(list)
    scopeStore.saveScope(scope)
    log.info('TodoList created:', list.id, 'scope:', scope)
    return list
  }

  async updateTodoListTitle(scope: string, listId: string, title: string): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    const idx = lists.findIndex((l) => l.id === listId)
    if (idx < 0) throw new Error(`TodoList not found: ${listId}`)
    const updated: TodoList = { ...lists[idx], title, updatedAt: Date.now() }
    data.todoLists[idx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async deleteTodoList(scope: string, listId: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    data.todoLists = lists.filter((l) => l.id !== listId)
    scopeStore.saveScope(scope)
    log.info('TodoList deleted:', listId, 'scope:', scope)
  }

  async createTodoItem(
    scope: string,
    payload: CreateTodoItemPayloadExt
  ): Promise<{ list: TodoList; item: TodoItem }> {
    const data = scopeStore.getScopeData(scope)
    if (!data.todoLists) data.todoLists = []

    const hasListTarget =
      (typeof payload.listTitle === 'string' && payload.listTitle.trim()) ||
      (typeof payload.listId === 'string' && payload.listId)
    if (!hasListTarget) {
      throw new Error('必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）')
    }
    let list: TodoList
    if (typeof payload.listTitle === 'string' && payload.listTitle.trim()) {
      list = await this.createTodoList(scope, { title: payload.listTitle.trim() })
    } else {
      const found = data.todoLists.find((l) => l.id === payload.listId)
      if (!found) throw new Error(`TodoList not found: ${payload.listId}`)
      list = found
    }

    const now = Date.now()
    const item: TodoItem = {
      id: genUniqueId(),
      title: payload.title,
      description: payload.description,
      status: payload.status ?? 'todo',
      createdAt: now,
      updatedAt: now
    }
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    const items = [...list.items, item]
    const updated: TodoList = { ...list, items, updatedAt: now }
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return { list: updated, item }
  }

  async updateTodoItem(
    scope: string,
    itemId: string,
    payload: UpdateTodoItemPayload
  ): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const list = findListByItemId(data.todoLists ?? [], itemId)
    if (!list) return null
    const idx = list.items.findIndex((it) => it.id === itemId)
    if (idx < 0) return list
    const cur = list.items[idx]
    const items = [...list.items]
    items[idx] = {
      ...cur,
      ...(payload.status !== undefined && { status: payload.status as TodoItemStatus }),
      ...(payload.title !== undefined && { title: payload.title }),
      ...(payload.description !== undefined && { description: payload.description }),
      updatedAt: Date.now()
    }
    const updated: TodoList = { ...list, items, updatedAt: Date.now() }
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async deleteTodoItem(scope: string, itemId: string): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const list = findListByItemId(data.todoLists ?? [], itemId)
    if (!list) return null
    const items = list.items.filter((it) => it.id !== itemId)
    const updated: TodoList = { ...list, items, updatedAt: Date.now() }
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async replaceTodoItems(scope: string, listId: string, items: TodoItem[]): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const listIdx = (data.todoLists ?? []).findIndex((l) => l.id === listId)
    if (listIdx < 0) throw new Error(`TodoList not found: ${listId}`)
    const list = data.todoLists[listIdx]
    const usedIds = new Set<string>()
    const normalized = items.map((it) =>
      ensureTodoItem(it as Partial<TodoItem> & { title: string }, usedIds)
    )
    const updated: TodoList = { ...list, items: normalized, updatedAt: Date.now() }
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
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
      id: genUniqueId(),
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
      id: genUniqueId(),
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
      id: genUniqueId(),
      title: payload.title || '未命名文档',
      content: payload.content ?? '',
      createdAt: now,
      updatedAt: now
    }
    data.documents.push(doc)
    scopeStore.saveScope(scope)
    log.info('Document created:', doc.id, 'scope:', scope)
    scheduleDocumentSummary(scope, doc.id)
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
      ...(payload.llmSummary !== undefined && { llmSummary: payload.llmSummary }),
      updatedAt: Date.now()
    }
    data.documents[idx] = updated
    scopeStore.saveScope(scope)
    log.info('Document updated:', id, 'scope:', scope)
    scheduleDocumentSummary(scope, id)
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
      id: genUniqueId(),
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
    update: { title?: string; llmSummary?: string }
  ): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === id)
    if (!session) throw new Error(`Session not found: ${id}`)

    if (update.title !== undefined) {
      session.title = update.title
    }
    if (update.llmSummary !== undefined) {
      session.llmSummary = update.llmSummary
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
      id: genUniqueId(),
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
    options?: {
      model?: string
      signal?: AbortSignal
      mcpEnabled?: boolean
      includeScopeContext?: boolean
    }
  ): AsyncIterable<LLMStreamChunk> {
    const provider = getLLMProvider()
    const mcpEnabled = options?.mcpEnabled !== false
    const includeScopeContext = options?.includeScopeContext !== false

    registerBuiltinAtReferences()
    const systemContent = buildSystemPrompt({
      scope,
      sessionId,
      includeScopeContext
    })
    const baseMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemContent }
    ]

    if (messages.length > 0) {
      const last = messages[messages.length - 1]
      const rest = messages.slice(0, -1)
      if (last.role === 'user' && typeof last.content === 'string') {
        const { injectedPrefix, message } = await processMessageAtRefs(
          scope,
          sessionId,
          last.content
        )
        if (injectedPrefix) {
          baseMessages.push({ role: 'system', content: injectedPrefix })
        }
        baseMessages.push(...rest, { role: 'user', content: message })
      } else {
        baseMessages.push(...messages)
      }
    }

    let llmTools: LLMTool[] = getBuiltinTools()
    if (mcpEnabled) {
      const manager = getMcpClientManager()
      await manager.connectAll()
      const mcpTools = await manager.listAllTools()

      const tavilySettings = getTavilySettings()
      const tavilyEnabled =
        tavilySettings &&
        tavilySettings.enabled !== false &&
        (tavilySettings.apiKey?.trim() || process.env.TAVILY_API_KEY?.trim())

      const builtinTavilyTool: LLMTool = {
        type: 'function',
        function: {
          name: 'tavily_web_search',
          description:
            '在互联网上搜索实时信息。当用户询问最新新闻、事实、数据或需要联网查询时使用。',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词或问题' } },
            required: ['query']
          }
        }
      }

      llmTools = [
        ...llmTools,
        ...(tavilyEnabled ? [builtinTavilyTool] : []),
        ...mcpTools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.fullName,
            description: t.description,
            parameters: t.inputSchema
          }
        }))
      ]
    }

    let currentMessages: LLMChatMessage[] = [...baseMessages]
    let lastUsage: LLMStreamChunk['usage'] | undefined

    while (true) {
      if (options?.signal?.aborted) break

      const stream = provider.chat(currentMessages, {
        model: options?.model,
        temperature: 0.7,
        signal: options?.signal,
        tools: llmTools.length > 0 ? llmTools : undefined
      })

      let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined
      let assistantContent = ''

      for await (const chunk of stream) {
        if (chunk.text) {
          assistantContent += chunk.text
          yield { text: chunk.text }
        }
        if (chunk.reasoning) yield { reasoning: chunk.reasoning }
        if (chunk.usage) lastUsage = chunk.usage
        if (chunk.done && chunk.toolCalls?.length) {
          toolCalls = chunk.toolCalls
        }
        if (chunk.done && !chunk.toolCalls?.length) {
          yield { done: true, usage: chunk.usage ?? lastUsage }
          return
        }
      }

      if (!toolCalls?.length) {
        yield { done: true, usage: lastUsage }
        return
      }

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant' as const,
          content: assistantContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.arguments }
          }))
        }
      ]

      const manager = getMcpClientManager()
      for (const tc of toolCalls) {
        // 执行前 yield running，便于 UI 提前显示「正在执行」
        yield {
          toolCall: {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: '',
            status: 'running' as const
          }
        }
        try {
          const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
          let text: string
          let isError = false
          if (BUILTIN_TOOL_NAMES.has(tc.name)) {
            const result = await executeBuiltinTool(scope, tc.name, args, sessionId)
            text = result.text
            isError = result.isError ?? false
          } else if (tc.name === 'tavily_web_search') {
            const query = typeof args.query === 'string' ? args.query : ''
            const results = await searchTavily(query)
            text =
              results.length > 0
                ? results
                    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
                    .join('\n\n---\n\n')
                : '未找到相关结果'
          } else {
            const toolResult = await manager.callTool(tc.name, args)
            text =
              toolResult.content
                ?.map((c) => ('text' in c ? c.text : JSON.stringify(c)))
                .join('\n') ?? ''
            if (toolResult.isError) {
              isError = true
              text = `Error: ${text}`
            }
          }
          if (text.length >= TOOL_RESULT_STREAM_THRESHOLD) {
            for (let i = 0; i < text.length; i += TOOL_RESULT_CHUNK_SIZE) {
              yield {
                toolResultChunk: {
                  id: tc.id,
                  chunk: text.slice(i, i + TOOL_RESULT_CHUNK_SIZE)
                }
              }
            }
          }
          yield {
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: text,
              isError,
              status: 'done' as const
            }
          }
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: text
          })
        } catch (err) {
          const errText = err instanceof Error ? err.message : String(err)
          yield {
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: `Error: ${errText}`,
              isError: true,
              status: 'done' as const
            }
          }
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Error: ${errText}`
          })
        }
      }
    }
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
