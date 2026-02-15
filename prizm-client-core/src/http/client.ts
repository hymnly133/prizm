import type { PrizmConfig, NotificationPayload } from '../types'
import { PrizmWebSocketClient } from '../websocket/connection'
import type { WebSocketConfig, WebSocketEventHandler, WebSocketEventType } from '../types'
import type {
  StickyNote,
  TodoList,
  TodoItem,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
  PomodoroSession,
  ClipboardItem,
  Document,
  AgentSession,
  AgentMessage,
  StreamChatOptions,
  StreamChatChunk,
  SearchResult,
  TokenUsageRecord,
  SessionStats
} from '../types'
import type { MemoryItem, DedupLogEntry } from '@prizm/shared'

export interface PrizmClientOptions {
  /**
   * 服务器基础地址，例如 http://127.0.0.1:4127
   */
  baseUrl: string
  /**
   * API Key，用于访问受保护接口
   */
  apiKey?: string
  /**
   * 默认 scope，不传则为 default
   */
  defaultScope?: string
}

interface HttpRequestOptions extends RequestInit {
  scope?: string
}

export class PrizmClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly defaultScope: string

  constructor(options: PrizmClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.defaultScope = options.defaultScope ?? 'default'
  }

  // ============ WebSocket ============

  /**
   * 基于 PrizmConfig 创建 WebSocket 客户端（快捷方式）
   */
  createWebSocketClientFromConfig(config: PrizmConfig): PrizmWebSocketClient {
    const wsConfig: WebSocketConfig = {
      host: config.server.host,
      port: parseInt(config.server.port, 10),
      apiKey: config.api_key
    }
    return new PrizmWebSocketClient(wsConfig)
  }

  /**
   * 创建 WebSocket 客户端
   */
  createWebSocketClient(config: WebSocketConfig): PrizmWebSocketClient {
    return new PrizmWebSocketClient(config)
  }

  // ============ HTTP 基础封装 ============

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }
    return url.toString()
  }

  private buildHeaders(): Headers {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`)
    }
    return headers
  }

  private async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const { scope, ...init } = options
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const method = (init.method ?? 'GET').toUpperCase()

    let url: string
    let body = init.body
    if (scope !== undefined) {
      if (method === 'GET' || method === 'DELETE') {
        url = this.buildUrl(normalizedPath, { scope })
      } else {
        url = this.buildUrl(normalizedPath)
        if (body && typeof body === 'string') {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>
            parsed.scope = scope
            body = JSON.stringify(parsed)
          } catch {
            // 非 JSON body 不添加 scope
          }
        } else if (body === undefined || body === null) {
          body = JSON.stringify({ scope })
        }
      }
    } else {
      url = this.buildUrl(normalizedPath)
    }

    const headers = this.buildHeaders()
    if (init.headers) {
      const extra = new Headers(init.headers as HeadersInit)
      extra.forEach((value, key) => {
        headers.set(key, value)
      })
    }

    const response = await fetch(url, {
      ...init,
      body,
      headers
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }

    // 某些 204 响应用不到 body
    if (response.status === 204) {
      return undefined as unknown as T
    }

    return (await response.json()) as T
  }

  // ============ Auth / Scopes ============

  async listScopes(): Promise<string[]> {
    const data = await this.request<{ scopes: string[] }>('/auth/scopes')
    return data.scopes ?? []
  }

  /** 获取 scope 列表及说明（用于 UI 展示） */
  async listScopesWithInfo(): Promise<{
    scopes: string[]
    descriptions: Record<string, { label: string; description: string }>
    scopeDetails?: Record<string, { path: string | null; label: string; builtin: boolean }>
  }> {
    const data = await this.request<{
      scopes: string[]
      descriptions?: Record<string, { label: string; description: string }>
      scopeDetails?: Record<string, { path: string | null; label: string; builtin: boolean }>
    }>('/auth/scopes')
    return {
      scopes: data.scopes ?? [],
      descriptions: data.descriptions ?? {},
      scopeDetails: data.scopeDetails
    }
  }

  /** 注册新 scope（绑定到文件夹） */
  async registerScope(payload: {
    id: string
    path: string
    label?: string
  }): Promise<{ scope: { id: string; path: string; label: string } }> {
    return this.request('/auth/scopes', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  /** 更新 scope 标签 */
  async updateScope(
    id: string,
    payload: { label?: string }
  ): Promise<{ scope: { id: string; path: string; label: string } }> {
    return this.request(`/auth/scopes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  }

  /** 注销 scope（不删除文件夹） */
  async unregisterScope(id: string): Promise<void> {
    await this.request(`/auth/scopes/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  // ============ Notes / Sticky Notes ============

  async listNotes(options?: { q?: string; tag?: string; scope?: string }): Promise<StickyNote[]> {
    const scope = options?.scope ?? this.defaultScope
    const query: Record<string, string | undefined> = {
      q: options?.q,
      tag: options?.tag,
      scope
    }
    const url = this.buildUrl('/notes', query)
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { notes: StickyNote[] }
    return data.notes
  }

  async getNote(id: string, scope?: string): Promise<StickyNote> {
    const data = await this.request<{ note: StickyNote }>(`/notes/${encodeURIComponent(id)}`, {
      method: 'GET',
      scope
    })
    return data.note
  }

  async createNote(
    payload: Partial<Pick<StickyNote, 'content' | 'imageUrls' | 'tags' | 'fileRefs'>>,
    scope?: string
  ): Promise<StickyNote> {
    const data = await this.request<{ note: StickyNote }>('/notes', {
      method: 'POST',
      scope,
      body: JSON.stringify(payload ?? {})
    })
    return data.note
  }

  async updateNote(
    id: string,
    payload: Partial<Pick<StickyNote, 'content' | 'imageUrls' | 'tags' | 'fileRefs'>>,
    scope?: string
  ): Promise<StickyNote> {
    const data = await this.request<{ note: StickyNote }>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope,
      body: JSON.stringify(payload ?? {})
    })
    return data.note
  }

  async deleteNote(id: string, scope?: string): Promise<void> {
    await this.request<void>(`/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope
    })
  }

  // ============ TODO 列表 ============
  // list 为包装，item 为顶层元素。支持多 list 每 scope。

  /** 列出 scope 下所有 TodoList */
  async getTodoLists(scope?: string): Promise<TodoList[]> {
    const data = await this.request<{ todoLists: TodoList[] }>('/todo/lists', { scope })
    return data.todoLists ?? []
  }

  /** 获取指定 list 或首个 list；itemId 时查找包含该 item 的 list */
  async getTodoList(
    scope?: string,
    listId?: string,
    options?: { itemId?: string }
  ): Promise<TodoList | null> {
    const s = scope ?? this.defaultScope
    if (listId) {
      const data = await this.request<{ todoList: TodoList }>(
        `/todo/lists/${encodeURIComponent(listId)}`,
        { scope: s }
      )
      return data.todoList ?? null
    }
    const query: Record<string, string | undefined> = { scope: s }
    if (options?.itemId) query.itemId = options.itemId
    const url = this.buildUrl('/todo', query)
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { todoList: TodoList | null }
    return data.todoList
  }

  async createTodoList(scope?: string, payload?: { title?: string }): Promise<TodoList> {
    const data = await this.request<{ todoList: TodoList }>('/todo/lists', {
      method: 'POST',
      scope,
      body: JSON.stringify(payload ?? {})
    })
    return data.todoList
  }

  async updateTodoListTitle(
    scope: string | undefined,
    listId: string,
    title: string
  ): Promise<TodoList> {
    const data = await this.request<{ todoList: TodoList }>(
      `/todo/lists/${encodeURIComponent(listId)}`,
      {
        method: 'PATCH',
        scope,
        body: JSON.stringify({ title })
      }
    )
    return data.todoList
  }

  async replaceTodoItems(
    scope: string | undefined,
    listId: string,
    items: TodoItem[]
  ): Promise<TodoList> {
    const data = await this.request<{ todoList: TodoList }>(
      `/todo/lists/${encodeURIComponent(listId)}/items`,
      {
        method: 'PUT',
        scope,
        body: JSON.stringify({ items })
      }
    )
    return data.todoList
  }

  async createTodoItem(
    scope: string | undefined,
    payload: CreateTodoItemPayload & { listId?: string; listTitle?: string }
  ): Promise<TodoList> {
    const data = await this.request<{ todoList: TodoList }>('/todo/items', {
      method: 'POST',
      scope,
      body: JSON.stringify(payload)
    })
    return data.todoList
  }

  async updateTodoItem(
    itemId: string,
    payload: UpdateTodoItemPayload,
    scope?: string
  ): Promise<TodoList> {
    const data = await this.request<{ todoList: TodoList }>(
      `/todo/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        scope,
        body: JSON.stringify(payload)
      }
    )
    return data.todoList
  }

  async deleteTodoItem(itemId: string, scope?: string): Promise<TodoList | null> {
    const data = await this.request<{ todoList: TodoList | null }>(
      `/todo/items/${encodeURIComponent(itemId)}`,
      {
        method: 'DELETE',
        scope
      }
    )
    return data.todoList ?? null
  }

  async deleteTodoList(scope: string | undefined, listId: string): Promise<void> {
    await this.request<void>(`/todo/lists/${encodeURIComponent(listId)}`, {
      method: 'DELETE',
      scope
    })
  }

  // ============ Pomodoro ============

  async startPomodoro(options?: {
    taskId?: string
    tag?: string
    scope?: string
  }): Promise<PomodoroSession> {
    const data = await this.request<{ session: PomodoroSession }>('/pomodoro/start', {
      method: 'POST',
      scope: options?.scope,
      body: JSON.stringify({
        taskId: options?.taskId,
        tag: options?.tag
      })
    })
    return data.session
  }

  async stopPomodoro(id: string, scope?: string): Promise<PomodoroSession> {
    const data = await this.request<{ session: PomodoroSession }>('/pomodoro/stop', {
      method: 'POST',
      scope,
      body: JSON.stringify({ id })
    })
    return data.session
  }

  async listPomodoroSessions(options?: {
    taskId?: string
    from?: number
    to?: number
    scope?: string
  }): Promise<PomodoroSession[]> {
    const query: Record<string, string | undefined> = {}
    if (options?.taskId) query.taskId = options.taskId
    if (typeof options?.from === 'number') query.from = String(options.from)
    if (typeof options?.to === 'number') query.to = String(options.to)

    const url = this.buildUrl('/pomodoro/sessions', query)
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { sessions: PomodoroSession[] }
    return data.sessions
  }

  // ============ Notify ============

  async sendNotify(title: string, body?: string, scope?: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/notify', {
      method: 'POST',
      scope,
      body: JSON.stringify({ title, body })
    })
  }

  // ============ Clipboard ============

  async getClipboardHistory(options?: {
    limit?: number
    scope?: string
  }): Promise<ClipboardItem[]> {
    const query: Record<string, string | undefined> = {}
    if (typeof options?.limit === 'number') {
      query.limit = String(options.limit)
    }
    const url = this.buildUrl('/clipboard/history', query)
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { items: ClipboardItem[] }
    return data.items
  }

  async addClipboardItem(item: Omit<ClipboardItem, 'id'>, scope?: string): Promise<ClipboardItem> {
    const data = await this.request<{ item: ClipboardItem }>('/clipboard', {
      method: 'POST',
      scope,
      body: JSON.stringify(item)
    })
    return data.item
  }

  async deleteClipboardItem(id: string, scope?: string): Promise<void> {
    await this.request<void>(`/clipboard/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope
    })
  }

  // ============ Documents ============

  async listDocuments(options?: { scope?: string }): Promise<Document[]> {
    const scope = options?.scope ?? this.defaultScope
    const url = this.buildUrl('/documents', { scope })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { documents: Document[] }
    return data.documents
  }

  async getDocument(id: string, scope?: string): Promise<Document> {
    const data = await this.request<{ document: Document }>(
      `/documents/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        scope
      }
    )
    return data.document
  }

  async createDocument(
    payload: { title: string; content?: string },
    scope?: string
  ): Promise<Document> {
    const data = await this.request<{ document: Document }>('/documents', {
      method: 'POST',
      scope,
      body: JSON.stringify(payload)
    })
    return data.document
  }

  async updateDocument(
    id: string,
    payload: Partial<Pick<Document, 'title' | 'content'>>,
    scope?: string
  ): Promise<Document> {
    const data = await this.request<{ document: Document }>(
      `/documents/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        scope,
        body: JSON.stringify(payload)
      }
    )
    return data.document
  }

  async deleteDocument(id: string, scope?: string): Promise<void> {
    await this.request<void>(`/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope
    })
  }

  // ============ 统一搜索（关键词列表匹配，面向 LLM） ============

  /**
   * 统一关键词搜索 - 输入关键词列表，返回按相关性排序的文档
   * 支持自然语言分词（空格、逗号等分隔），高宽容度子串匹配
   */
  async search(options: {
    keywords: string | string[]
    scope?: string
    types?: Array<'note' | 'document' | 'clipboard' | 'todoList'>
    limit?: number
    mode?: 'any' | 'all'
    /** 模糊程度 0~1，默认 0.2；0 关闭模糊 */
    fuzzy?: number
  }): Promise<SearchResult[]> {
    const scope = options.scope ?? this.defaultScope
    const url = this.buildUrl('/search', { scope })
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        keywords: options.keywords,
        scope,
        types: options.types,
        limit: options.limit ?? 50,
        mode: options.mode ?? 'any',
        fuzzy: options.fuzzy
      })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { results: SearchResult[] }
    return data.results
  }

  /**
   * 便捷搜索 - GET 方式，适用于简单关键词
   */
  async searchQuery(q: string, scope?: string, limit?: number): Promise<SearchResult[]> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/search', {
      q,
      scope: s,
      limit: limit != null ? String(limit) : undefined
    })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { results: SearchResult[] }
    return data.results
  }

  // ============ Agent 会话 ============

  /** 调试用：获取 scope 上下文摘要预览（便签/待办/文档） */
  async getAgentScopeContext(scope?: string): Promise<{ summary: string; scope: string }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/agent/debug/scope-context', { scope: s })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as { summary: string; scope: string }
  }

  /** 获取发送消息前注入的完整系统提示词（含工作区上下文、能力说明、上下文状态、工作原则） */
  async getAgentSystemPrompt(
    scope?: string,
    sessionId?: string
  ): Promise<{ systemPrompt: string; scope: string; sessionId: string | null }> {
    const s = scope ?? this.defaultScope
    const params: Record<string, string> = { scope: s }
    if (sessionId?.trim()) params.sessionId = sessionId.trim()
    const url = this.buildUrl('/agent/system-prompt', params)
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as {
      systemPrompt: string
      scope: string
      sessionId: string | null
    }
  }

  /** 可引用项列表（用于 @ 自动补全） */
  async getAgentScopeItems(scope?: string): Promise<{
    refTypes: { key: string; label: string; aliases: string[] }[]
    items: {
      id: string
      kind: string
      title: string
      charCount: number
      isShort: boolean
      updatedAt: number
      groupOrStatus?: string
    }[]
  }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/agent/scope-items', { scope: s })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as {
      refTypes: { key: string; label: string; aliases: string[] }[]
      items: {
        id: string
        kind: string
        title: string
        charCount: number
        isShort: boolean
        updatedAt: number
        groupOrStatus?: string
      }[]
    }
  }

  /** slash 命令列表（用于 / 下拉菜单） */
  async getAgentSlashCommands(scope?: string): Promise<{
    commands: { name: string; aliases: string[]; description: string }[]
  }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/agent/slash-commands', { scope: s })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as {
      commands: { name: string; aliases: string[]; description: string }[]
    }
  }

  /** 工具元数据（显示名、文档链接等），供 ToolCallCard 使用 */
  async getAgentToolsMetadata(): Promise<{
    tools: Array<{
      name: string
      displayName: string
      description?: string
      docUrl?: string
      category?: string
      scopeActivity?: string
    }>
  }> {
    const response = await fetch(this.buildUrl('/agent/tools/metadata'), {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as {
      tools: Array<{
        name: string
        displayName: string
        description?: string
        docUrl?: string
        category?: string
        scopeActivity?: string
      }>
    }
  }

  /** 会话上下文追踪状态（提供状态、统一活动时间线） */
  async getAgentSessionContext(
    sessionId: string,
    scope?: string
  ): Promise<{
    sessionId: string
    scope: string
    provisions: {
      itemId: string
      kind: string
      mode: string
      providedAt: number
      charCount: number
      version: number
      stale: boolean
    }[]
    totalProvidedChars: number
    /** 统一活动时间线 */
    activities: {
      toolName: string
      action: string
      itemKind?: string
      itemId?: string
      title?: string
      timestamp: number
    }[]
  }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/context`, {
      scope: s
    })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const json = (await response.json()) as {
      sessionId: string
      scope: string
      provisions: {
        itemId: string
        kind: string
        mode: string
        providedAt: number
        charCount: number
        version: number
        stale: boolean
      }[]
      totalProvidedChars: number
      activities?: {
        toolName: string
        action: string
        itemKind?: string
        itemId?: string
        title?: string
        timestamp: number
      }[]
    }
    return {
      ...json,
      activities: json.activities ?? []
    }
  }

  /** 会话级统计：token 总用量 + 该会话创建的记忆汇总 */
  async getAgentSessionStats(sessionId: string, scope?: string): Promise<SessionStats> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/stats`, {
      scope: s
    })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as SessionStats
  }

  async listAgentSessions(scope?: string): Promise<AgentSession[]> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/agent/sessions', { scope: s })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { sessions: AgentSession[] }
    return data.sessions ?? []
  }

  async createAgentSession(scope?: string): Promise<AgentSession> {
    const data = await this.request<{ session: AgentSession }>('/agent/sessions', {
      method: 'POST',
      scope: scope ?? this.defaultScope,
      body: JSON.stringify({})
    })
    return data.session
  }

  async getAgentSession(id: string, scope?: string): Promise<AgentSession> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { session: AgentSession }
    return data.session
  }

  async deleteAgentSession(id: string, scope?: string): Promise<void> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.buildHeaders()
    })
    if (!response.ok && response.status !== 204) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
  }

  async updateAgentSession(
    id: string,
    update: { title?: string },
    scope?: string
  ): Promise<AgentSession> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(id)}`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.buildHeaders(),
      body: JSON.stringify(update)
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { session: AgentSession }
    return data.session
  }

  /**
   * 流式对话，消费 SSE 并逐块回调
   * 支持 signal 取消和 onError 错误回调
   */
  async streamChat(
    sessionId: string,
    content: string,
    options?: StreamChatOptions & { scope?: string }
  ): Promise<string> {
    const scope = options?.scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/chat`, {
      scope
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        content,
        model: options?.model,
        includeScopeContext: options?.includeScopeContext,
        fullContextTurns: options?.fullContextTurns,
        cachedContextTurns: options?.cachedContextTurns
      }),
      signal: options?.signal
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''

    try {
      while (true) {
        if (options?.signal?.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data) as StreamChatChunk
              if (parsed.type === 'error') {
                options?.onError?.(
                  typeof parsed.value === 'string' ? parsed.value : 'Unknown error'
                )
              }
              options?.onChunk?.(parsed)
              if (parsed.type === 'text' && typeof parsed.value === 'string') {
                fullContent += parsed.value
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return fullContent
  }

  async stopAgentChat(sessionId: string, scope?: string): Promise<{ stopped: boolean }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as { stopped: boolean }
  }

  // ============ 记忆模块 ============

  /** 获取所有记忆 */
  async getMemories(scope?: string): Promise<{ enabled: boolean; memories: MemoryItem[] }> {
    return this.request<{ enabled: boolean; memories: MemoryItem[] }>(`/agent/memories`, {
      method: 'GET',
      scope
    })
  }

  /** 搜索记忆（可选 method/use_rerank/limit/memory_types，与内置工具、MCP 对齐） */
  async searchMemories(
    query: string,
    scope?: string,
    options?: {
      method?: 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'
      use_rerank?: boolean
      limit?: number
      memory_types?: string[]
    }
  ): Promise<{ enabled: boolean; memories: MemoryItem[] }> {
    const body: {
      query: string
      method?: string
      use_rerank?: boolean
      limit?: number
      memory_types?: string[]
    } = {
      query
    }
    if (options?.method) body.method = options.method
    if (options?.use_rerank != null) body.use_rerank = options.use_rerank
    if (options?.limit != null) body.limit = options.limit
    if (options?.memory_types?.length) body.memory_types = options.memory_types
    return this.request<{ enabled: boolean; memories: MemoryItem[] }>(`/agent/memories/search`, {
      method: 'POST',
      scope,
      body: JSON.stringify(body)
    })
  }

  /** 删除记忆 */
  async deleteMemory(id: string, scope?: string): Promise<void> {
    await this.request<void>(`/agent/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      scope
    })
  }

  /** 三层记忆状态（User/Scope/Session），供可视化 */
  async getThreeLevelMemories(
    scope?: string,
    sessionId?: string
  ): Promise<{
    enabled: boolean
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  }> {
    const s = scope ?? this.defaultScope
    const path =
      sessionId != null && sessionId !== ''
        ? `/agent/memories/three-level?sessionId=${encodeURIComponent(sessionId)}`
        : '/agent/memories/three-level'
    return this.request<{
      enabled: boolean
      user: MemoryItem[]
      scope: MemoryItem[]
      session: MemoryItem[]
    }>(path, { method: 'GET', scope: s })
  }

  /** 获取某轮对话的记忆增长（按 assistant 消息 ID，用于历史消息懒加载） */
  async getRoundMemories(
    messageId: string,
    scope?: string
  ): Promise<import('@prizm/shared').RoundMemoryGrowth | null> {
    return this.request<import('@prizm/shared').RoundMemoryGrowth | null>(
      `/agent/memories/round/${encodeURIComponent(messageId)}`,
      { method: 'GET', scope }
    )
  }

  /** 获取去重日志列表 */
  async getDedupLog(scope?: string, limit?: number): Promise<{ entries: DedupLogEntry[] }> {
    const s = scope ?? this.defaultScope
    const path =
      limit != null ? `/agent/memories/dedup-log?limit=${limit}` : '/agent/memories/dedup-log'
    return this.request<{ entries: DedupLogEntry[] }>(path, { method: 'GET', scope: s })
  }

  /** 回退一次去重，恢复被抑制的记忆 */
  async undoDedup(
    dedupLogId: string,
    scope?: string
  ): Promise<{ restored: boolean; restoredMemoryId?: string }> {
    return this.request<{ restored: boolean; restoredMemoryId?: string }>(
      `/agent/memories/dedup-log/${encodeURIComponent(dedupLogId)}/undo`,
      { method: 'POST', scope }
    )
  }

  /** 当前用户的 token 使用记录（按功能 scope） */
  async getTokenUsage(): Promise<{ records: TokenUsageRecord[] }> {
    return this.request<{ records: TokenUsageRecord[] }>('/agent/token-usage', { method: 'GET' })
  }

  // ============ MCP 工具配置 ============

  /** MCP 服务器配置（供 Agent 调用的外部 MCP 服务器） */
  async listMcpServers(): Promise<McpServerConfig[]> {
    const data = await this.request<{ mcpServers: McpServerConfig[] }>('/mcp/servers')
    return data.mcpServers ?? []
  }

  async addMcpServer(config: McpServerConfig): Promise<McpServerConfig> {
    return this.request<McpServerConfig>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(config)
    })
  }

  async updateMcpServer(
    id: string,
    update: Partial<Omit<McpServerConfig, 'id'>>
  ): Promise<McpServerConfig> {
    return this.request<McpServerConfig>(`/mcp/servers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update)
    })
  }

  async deleteMcpServer(id: string): Promise<void> {
    await this.request<void>(`/mcp/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  async getMcpServerTools(id: string): Promise<{ tools: McpTool[] }> {
    return this.request<{ tools: McpTool[] }>(`/mcp/servers/${encodeURIComponent(id)}/tools`)
  }

  // ============ Agent 工具设置（内置 + MCP 统一） ============

  async getAgentModels(): Promise<{ provider: string; models: AvailableModel[] }> {
    return this.request<{ provider: string; models: AvailableModel[] }>('/settings/agent-models')
  }

  async getAgentTools(): Promise<AgentToolsSettings> {
    return this.request<AgentToolsSettings>('/settings/agent-tools')
  }

  async updateAgentTools(patch: Partial<AgentToolsSettings>): Promise<AgentToolsSettings> {
    return this.request<AgentToolsSettings>('/settings/agent-tools', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    })
  }

  async updateTavilySettings(
    update: Partial<TavilySettings>
  ): Promise<{ tavily: TavilySettings | null }> {
    return this.request<{ tavily: TavilySettings | null }>('/settings/agent-tools/builtin/tavily', {
      method: 'PUT',
      body: JSON.stringify(update)
    })
  }
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'streamable-http' | 'sse'
  stdio?: { command: string; args?: string[]; env?: Record<string, string> }
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

export interface McpTool {
  serverId: string
  name: string
  fullName: string
  description?: string
  inputSchema?: object
}

/** 内置工具：Tavily 联网搜索 */
export interface TavilySettings {
  apiKey?: string
  enabled?: boolean
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  configured?: boolean
}

/** 文档摘要设置 */
export interface DocumentSummarySettings {
  enabled?: boolean
  minLen?: number
  model?: string
}

/** 对话摘要设置 */
export interface ConversationSummarySettings {
  enabled?: boolean
  interval?: number
  model?: string
}

/** 上下文窗口 A/B 压缩配置 */
export interface ContextWindowSettings {
  fullContextTurns?: number
  cachedContextTurns?: number
}

/** Agent LLM 设置 */
export interface AgentLLMSettings {
  documentSummary?: DocumentSummarySettings
  conversationSummary?: ConversationSummarySettings
  defaultModel?: string
  memory?: MemorySettings
  contextWindow?: ContextWindowSettings
}

/** 记忆模块设置 */
export interface MemorySettings {
  enabled?: boolean
  model?: string
}

/** Agent 工具统一设置 */
export interface AgentToolsSettings {
  builtin?: { tavily?: TavilySettings }
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  updatedAt?: number
}

/** 可用模型项 */
export interface AvailableModel {
  id: string
  label: string
  provider: string
}
