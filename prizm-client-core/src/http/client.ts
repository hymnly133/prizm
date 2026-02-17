import type { PrizmConfig, NotificationPayload } from '../types'
import { PrizmWebSocketClient } from '../websocket/connection'
import type { WebSocketConfig, WebSocketEventHandler, WebSocketEventType } from '../types'
import type {
  FileEntry,
  FileReadResult,
  TodoList,
  TodoItem,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
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

  // ============ Files (Layer 0) ============

  async fileList(options?: {
    path?: string
    recursive?: boolean
    scope?: string
    sessionWorkspace?: string
  }): Promise<FileEntry[]> {
    const scope = options?.scope ?? this.defaultScope
    const query: Record<string, string | undefined> = {
      path: options?.path,
      recursive: options?.recursive ? 'true' : undefined,
      scope,
      sessionWorkspace: options?.sessionWorkspace
    }
    const url = this.buildUrl('/files/list', query)
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { files: FileEntry[] }
    return data.files
  }

  async fileRead(filePath: string, scope?: string): Promise<FileReadResult> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/files/read', { path: filePath, scope: s })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { file: FileReadResult }
    return data.file
  }

  async fileWrite(filePath: string, content: string, scope?: string): Promise<void> {
    await this.request<{ ok: boolean }>('/files/write', {
      method: 'POST',
      scope,
      body: JSON.stringify({ path: filePath, content })
    })
  }

  async fileMkdir(dirPath: string, scope?: string): Promise<void> {
    await this.request<{ ok: boolean }>('/files/mkdir', {
      method: 'POST',
      scope,
      body: JSON.stringify({ path: dirPath })
    })
  }

  async fileMove(from: string, to: string, scope?: string): Promise<void> {
    await this.request<{ ok: boolean }>('/files/move', {
      method: 'POST',
      scope,
      body: JSON.stringify({ from, to })
    })
  }

  async fileDelete(filePath: string, scope?: string): Promise<void> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/files/delete', { path: filePath, scope: s })
    const response = await fetch(url, { method: 'DELETE', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
  }

  async fileStat(
    filePath: string,
    scope?: string
  ): Promise<{ size: number; lastModified: number; isDir: boolean; isFile: boolean }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl('/files/stat', { path: filePath, scope: s })
    const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as {
      stat: { size: number; lastModified: number; isDir: boolean; isFile: boolean }
    }
    return data.stat
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
    types?: Array<'document' | 'clipboard' | 'todoList' | 'file'>
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
    update: { llmSummary?: string },
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
   * 为指定会话授权外部文件路径
   */
  async grantSessionPaths(
    sessionId: string,
    paths: string[],
    scope?: string
  ): Promise<{ grantedPaths: string[] }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/grant-paths`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ paths })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    const data = (await response.json()) as { grantedPaths: string[] }
    return data
  }

  /**
   * 响应工具交互请求（approve/deny）
   * 用于 human-in-the-loop 场景：工具执行需要用户确认时，SSE 流暂停等待此响应
   */
  async respondToInteract(
    sessionId: string,
    requestId: string,
    approved: boolean,
    options?: { paths?: string[]; scope?: string }
  ): Promise<{ requestId: string; approved: boolean; grantedPaths: string[] }> {
    const s = options?.scope ?? this.defaultScope
    const url = this.buildUrl(
      `/agent/sessions/${encodeURIComponent(sessionId)}/interact-response`,
      { scope: s }
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        requestId,
        approved,
        ...(options?.paths && { paths: options.paths })
      })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
    }
    return (await response.json()) as {
      requestId: string
      approved: boolean
      grantedPaths: string[]
    }
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
        cachedContextTurns: options?.cachedContextTurns,
        fileRefs: options?.fileRefs
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
          // SSE 心跳注释行：服务端在 LLM 长时间生成工具参数时每 3 秒发送
          if (line.startsWith(': heartbeat')) {
            try {
              options?.onChunk?.({ type: 'heartbeat' })
            } catch {
              // 忽略心跳处理错误
            }
            continue
          }
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data) as StreamChatChunk
              if (parsed.type === 'error') {
                options?.onError?.(
                  typeof parsed.value === 'string' ? parsed.value : 'Unknown error'
                )
              }
              try {
                options?.onChunk?.(parsed)
              } catch (chunkErr) {
                console.error('[streamChat] onChunk handler error:', chunkErr, 'chunk:', parsed)
              }
              if (parsed.type === 'text' && typeof parsed.value === 'string') {
                fullContent += parsed.value
              }
              // tool_call 事件后让出事件循环，确保 React 能在 preparing / running / done
              // 状态之间独立渲染。否则同一 TCP 读取块中的多个 tool_call 事件会被 React 18
              // 批处理合并，用户永远看不到中间的 preparing 卡片。
              if (parsed.type === 'tool_call') {
                await new Promise<void>((r) => setTimeout(r, 0))
              }
            } catch {
              // JSON 解析错误可以忽略
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

  /** 各层记忆总数（直接 COUNT，不依赖语义搜索） */
  async getMemoryCounts(
    scope?: string
  ): Promise<{ enabled: boolean; userCount: number; scopeCount: number }> {
    return this.request<{ enabled: boolean; userCount: number; scopeCount: number }>(
      '/agent/memories/counts',
      { method: 'GET', scope: scope ?? this.defaultScope }
    )
  }

  /** 按层精确解析记忆 ID → MemoryItem（用于懒加载记忆详情） */
  async resolveMemoryIds(
    byLayer: import('@prizm/shared').MemoryIdsByLayer,
    scope?: string
  ): Promise<Record<string, import('@prizm/shared').MemoryItem | null>> {
    const res = await this.request<{
      memories: Record<string, import('@prizm/shared').MemoryItem | null>
    }>('/agent/memories/resolve', {
      method: 'POST',
      scope,
      body: JSON.stringify({ byLayer })
    })
    return res.memories
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

  async getAvailableShells(): Promise<{ shells: ShellInfo[] }> {
    return this.request<{ shells: ShellInfo[] }>('/settings/available-shells')
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

  // ============ 自定义命令 ============

  async listCustomCommands(): Promise<{ commands: unknown[] }> {
    return this.request<{ commands: unknown[] }>('/commands')
  }

  async createCustomCommand(cmd: {
    id: string
    name?: string
    description?: string
    mode?: 'prompt' | 'action'
    content: string
    aliases?: string[]
  }): Promise<unknown> {
    return this.request('/commands', {
      method: 'POST',
      body: JSON.stringify(cmd)
    })
  }

  async updateCustomCommand(id: string, update: Record<string, unknown>): Promise<unknown> {
    return this.request(`/commands/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update)
    })
  }

  async deleteCustomCommand(id: string): Promise<void> {
    await this.request<void>(`/commands/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  async importCommands(
    source: 'cursor' | 'claude-code',
    path?: string
  ): Promise<{
    imported: number
    commands: unknown[]
  }> {
    return this.request('/commands/import', {
      method: 'POST',
      body: JSON.stringify({ source, path })
    })
  }

  // ============ Skills ============

  async listSkills(): Promise<{ skills: unknown[] }> {
    return this.request<{ skills: unknown[] }>('/skills')
  }

  async getSkill(name: string): Promise<unknown> {
    return this.request(`/skills/${encodeURIComponent(name)}`)
  }

  async createSkill(skill: {
    name: string
    description: string
    body: string
    license?: string
    metadata?: Record<string, string>
  }): Promise<unknown> {
    return this.request('/skills', {
      method: 'POST',
      body: JSON.stringify(skill)
    })
  }

  async deleteSkill(name: string): Promise<void> {
    await this.request<void>(`/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    })
  }

  async importSkills(
    source: 'claude-code' | 'github',
    path?: string
  ): Promise<{
    imported: number
    skills: unknown[]
  }> {
    return this.request('/skills/import', {
      method: 'POST',
      body: JSON.stringify({ source, path })
    })
  }

  async importMcpConfig(
    source: 'cursor' | 'claude-code' | 'vscode',
    path?: string
  ): Promise<{
    imported: number
    skipped: string[]
    servers: unknown[]
  }> {
    return this.request('/mcp/import', {
      method: 'POST',
      body: JSON.stringify({ source, path })
    })
  }

  async discoverMcpConfigs(): Promise<{
    sources: Array<{ source: string; path: string; serverCount: number }>
  }> {
    return this.request('/mcp/discover')
  }

  async getAgentCapabilities(): Promise<{
    builtinTools: unknown[]
    slashCommands: unknown[]
    customCommands: unknown[]
    skills: unknown[]
    rules: unknown[]
  }> {
    return this.request('/agent/capabilities')
  }

  // ============ 终端管理 ============

  /** 创建终端 */
  async createTerminal(
    sessionId: string,
    opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; title?: string },
    scope?: string
  ): Promise<TerminalSessionInfo> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(opts ?? {})
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to create terminal'}`)
    }
    const data = (await response.json()) as { terminal: TerminalSessionInfo }
    return data.terminal
  }

  /** 列出 Session 下所有终端 + exec worker 状态 */
  async listTerminals(sessionId: string, scope?: string): Promise<TerminalSessionInfo[]> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to list terminals'}`)
    }
    const data = (await response.json()) as {
      terminals: TerminalSessionInfo[]
      execWorker?: ExecWorkerInfo | null
    }
    return data.terminals
  }

  /** 列出终端 + exec workers（完整返回） */
  async listTerminalsWithExec(
    sessionId: string,
    scope?: string
  ): Promise<{ terminals: TerminalSessionInfo[]; execWorkers: ExecWorkerInfo[] }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(`/agent/sessions/${encodeURIComponent(sessionId)}/terminals`, {
      scope: s
    })
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to list terminals'}`)
    }
    const data = (await response.json()) as {
      terminals: TerminalSessionInfo[]
      execWorkers?: ExecWorkerInfo[]
    }
    return { terminals: data.terminals, execWorkers: data.execWorkers ?? [] }
  }

  /** 获取 exec 命令历史 */
  async getExecHistory(
    sessionId: string,
    limit?: number,
    scope?: string
  ): Promise<{ records: ExecRecordInfo[]; execWorkers: ExecWorkerInfo[] }> {
    const s = scope ?? this.defaultScope
    const params: Record<string, string> = { scope: s }
    if (limit) params.limit = String(limit)
    const url = this.buildUrl(
      `/agent/sessions/${encodeURIComponent(sessionId)}/exec-history`,
      params
    )
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to get exec history'}`)
    }
    const data = (await response.json()) as {
      records: ExecRecordInfo[]
      execWorkers?: ExecWorkerInfo[]
    }
    return { records: data.records, execWorkers: data.execWorkers ?? [] }
  }

  /** 获取终端详情 + 最近输出 */
  async getTerminalDetail(
    sessionId: string,
    terminalId: string,
    scope?: string
  ): Promise<{ terminal: TerminalSessionInfo; recentOutput: string }> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(
      `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(
        terminalId
      )}`,
      { scope: s }
    )
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to get terminal detail'}`)
    }
    return response.json() as Promise<{ terminal: TerminalSessionInfo; recentOutput: string }>
  }

  /** 调整终端尺寸 */
  async resizeTerminal(
    sessionId: string,
    terminalId: string,
    cols: number,
    rows: number,
    scope?: string
  ): Promise<void> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(
      `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(
        terminalId
      )}/resize`,
      { scope: s }
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ cols, rows })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to resize terminal'}`)
    }
  }

  /** 杀死终端 */
  async killTerminal(sessionId: string, terminalId: string, scope?: string): Promise<void> {
    const s = scope ?? this.defaultScope
    const url = this.buildUrl(
      `/agent/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(
        terminalId
      )}`,
      { scope: s }
    )
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.buildHeaders()
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${text || 'Failed to kill terminal'}`)
    }
  }

  /** 获取终端 WebSocket URL（供 TerminalConnection 使用） */
  getTerminalWsUrl(): string {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws')
    const apiKeyParam = this.apiKey ? `?apiKey=${encodeURIComponent(this.apiKey)}` : ''
    return `${wsUrl}/ws/terminal${apiKeyParam}`
  }

  // ==================== Embedding ====================

  /** 获取本地 embedding 模型的完整状态和统计信息 */
  async getEmbeddingStatus(): Promise<EmbeddingStatus> {
    return this.request<EmbeddingStatus>('/embedding/status')
  }

  /** 测试文本嵌入，可选比较两段文本的相似度 */
  async testEmbedding(text: string, compareWith?: string): Promise<EmbeddingTestResult> {
    return this.request<EmbeddingTestResult>('/embedding/test', {
      method: 'POST',
      body: JSON.stringify({ text, compareWith })
    })
  }

  /** 热重载 embedding 模型，可选切换量化级别 */
  async reloadEmbedding(dtype?: string): Promise<EmbeddingReloadResult> {
    return this.request<EmbeddingReloadResult>('/embedding/reload', {
      method: 'POST',
      body: dtype ? JSON.stringify({ dtype }) : undefined
    })
  }

  /** 清空所有记忆（需要 confirm token 确认） */
  async clearAllMemories(
    confirmToken: string,
    scope?: string
  ): Promise<{ deleted: number; vectorsCleared: boolean }> {
    return this.request('/agent/memories/clear-all', {
      method: 'POST',
      scope,
      body: JSON.stringify({ confirm: confirmToken })
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

/** 文档记忆设置（原 DocumentSummarySettings） */
export interface DocumentSummarySettings {
  enabled?: boolean
  minLen?: number
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

/** 终端会话信息（客户端视图） */
export interface TerminalSessionInfo {
  id: string
  agentSessionId: string
  scope: string
  sessionType: 'exec' | 'interactive'
  shell: string
  cwd: string
  cols: number
  rows: number
  pid: number
  title?: string
  status: 'running' | 'exited'
  exitCode?: number
  signal?: number
  createdAt: number
  lastActivityAt: number
}

/** 终端设置 */
export interface TerminalSettings {
  defaultShell?: string
}

/** Agent 工具统一设置 */
export interface AgentToolsSettings {
  builtin?: { tavily?: TavilySettings }
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  terminal?: TerminalSettings
  updatedAt?: number
}

/** 可用 Shell 信息 */
export interface ShellInfo {
  path: string
  label: string
  isDefault: boolean
}

/** 工作区类型 */
export type ExecWorkspaceType = 'main' | 'session'

/** Exec Worker 状态信息 */
export interface ExecWorkerInfo {
  agentSessionId: string
  workspaceType: ExecWorkspaceType
  shell: string
  cwd: string
  pid: number
  busy: boolean
  exited: boolean
  createdAt: number
  lastActivityAt: number
  commandCount: number
}

/** Exec 命令执行记录 */
export interface ExecRecordInfo {
  id: string
  agentSessionId: string
  workspaceType: ExecWorkspaceType
  command: string
  output: string
  exitCode: number
  timedOut: boolean
  startedAt: number
  finishedAt: number
}

/** 可用模型项 */
export interface AvailableModel {
  id: string
  label: string
  provider: string
}

// ==================== Embedding 类型 ====================

/** Embedding 推理统计 */
export interface EmbeddingStats {
  totalCalls: number
  totalErrors: number
  totalCharsProcessed: number
  avgLatencyMs: number
  p95LatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  lastError: { message: string; timestamp: number } | null
  modelLoadTimeMs: number
}

/** Embedding 模型完整状态 */
export interface EmbeddingStatus {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'disposing'
  modelName: string
  dimension: number
  enabled: boolean
  dtype: string
  /** 模型加载来源：'bundled' | 'cache' | 'download' */
  source: string
  stats: EmbeddingStats
  cacheDir: string
  /** 模型专属内存估算（加载前后堆差值），单位 MB */
  modelMemoryMb: number
  /** Node.js 进程 RSS，单位 MB */
  processMemoryMb: number
  upSinceMs: number | null
}

/** Embedding 测试结果 */
export interface EmbeddingTestResult {
  dimension: number
  latencyMs: number
  vectorPreview: number[]
  vectorFull?: number[]
  similarity?: number
  compareLatencyMs?: number
}

/** Embedding 重载结果 */
export interface EmbeddingReloadResult {
  message: string
  previousState: string
  currentState: string
  modelName: string
  dimension: number
  dtype: string
  loadTimeMs: number
}
