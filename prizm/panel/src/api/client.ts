/**
 * Prizm API 客户端
 * 开发时通过 Vite proxy 转发，生产时同源请求
 */

import type {
  StickyNote,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  ClipboardItem,
  ClipboardItemType,
  Document,
  AgentSession,
  AgentMessage,
  ClientInfo,
  ScopeDescription,
  TokenUsageRecord,
  TokenUsageCategory
} from '@prizm/shared'

export type {
  StickyNote,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  ClipboardItem,
  ClipboardItemType,
  Document,
  AgentSession,
  AgentMessage,
  ClientInfo,
  ScopeDescription,
  TokenUsageRecord,
  TokenUsageCategory
}

const getBaseUrl = (): string => {
  if (import.meta.env.DEV) {
    return '' // Vite proxy 会转发到 4127
  }
  return '' // 同源
}

export interface RequestOptions extends RequestInit {
  scope?: string
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { scope, ...rest } = options ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Prizm-Panel': 'true',
    ...(rest.headers as Record<string, string>)
  }
  let url = `${getBaseUrl()}${path}`
  let body = rest.body
  if (scope) {
    const method = (rest.method ?? 'GET').toUpperCase()
    if (method === 'GET' || method === 'DELETE') {
      url += (path.includes('?') ? '&' : '?') + `scope=${encodeURIComponent(scope)}`
    } else if (body && typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        parsed.scope = scope
        body = JSON.stringify(parsed)
      } catch {
        // ignore
      }
    } else {
      body = JSON.stringify({ scope })
    }
  }
  const res = await fetch(url, {
    ...rest,
    body,
    headers
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Health
export const getHealth = () => request<{ status: string }>('/health')

// Auth / Clients
export const getScopes = () =>
  request<{
    scopes: string[]
    descriptions?: Record<string, ScopeDescription>
  }>('/auth/scopes')
export const getClients = () => request<{ clients: ClientInfo[] }>('/auth/clients')
export const revokeClientById = (clientId: string) =>
  request<void>(`/auth/clients/${encodeURIComponent(clientId)}`, {
    method: 'DELETE'
  })
export const regenerateClientApiKey = (clientId: string) =>
  request<{ apiKey: string }>(`/auth/clients/${encodeURIComponent(clientId)}/regenerate-key`, {
    method: 'POST'
  })
export const registerClient = (name: string, requestedScopes?: string[]) =>
  request<{ clientId: string; apiKey: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name,
      requestedScopes: requestedScopes ?? ['default']
    })
  })

// Notes（支持 scope）
export const getNotes = (scope?: string) => request<{ notes: StickyNote[] }>('/notes', { scope })
export const getNote = (id: string, scope?: string) =>
  request<{ note: StickyNote }>(`/notes/${id}`, { scope })
export const createNote = (payload: CreateNotePayload, scope?: string) =>
  request<{ note: StickyNote }>('/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope
  })
export const updateNote = (id: string, payload: UpdateNotePayload, scope?: string) =>
  request<{ note: StickyNote }>(`/notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    scope
  })
export const deleteNote = (id: string, scope?: string) =>
  request<void>(`/notes/${id}`, { method: 'DELETE', scope })

// Notify
export const sendNotify = (title: string, body?: string) =>
  request<{ success: boolean }>('/notify', {
    method: 'POST',
    body: JSON.stringify({ title, body })
  })

// TODO 列表（支持 scope，多 list）
export const getTodoLists = (scope: string) =>
  request<{ todoLists: TodoList[] }>('/todo/lists', { scope }).then((r) => r.todoLists ?? [])

export const getTodoList = (scope: string, listId?: string, options?: { itemId?: string }) => {
  if (listId) {
    return request<{ todoList: TodoList }>(`/todo/lists/${encodeURIComponent(listId)}`, {
      scope
    }).then((r) => r.todoList ?? null)
  }
  let url = `/todo?scope=${encodeURIComponent(scope)}`
  if (options?.itemId) url += `&itemId=${encodeURIComponent(options.itemId)}`
  return request<{ todoList: TodoList | null }>(url).then((r) => r.todoList)
}

export const createTodoList = (scope: string, payload?: { title?: string }) =>
  request<{ todoList: TodoList }>('/todo/lists', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    scope
  }).then((r) => r.todoList)

export const updateTodoListTitle = (scope: string, listId: string, title: string) =>
  request<{ todoList: TodoList }>(`/todo/lists/${encodeURIComponent(listId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
    scope
  }).then((r) => r.todoList)

export const replaceTodoItems = (scope: string, listId: string, items: TodoItem[]) =>
  request<{ todoList: TodoList }>(`/todo/lists/${encodeURIComponent(listId)}/items`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
    scope
  }).then((r) => r.todoList)
export const updateTodoItem = (
  itemId: string,
  payload: { status?: string; title?: string; description?: string },
  scope?: string
) =>
  request<{ todoList: TodoList }>(`/todo/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    scope
  })
export const deleteTodoItem = (itemId: string, scope: string) =>
  request<{ todoList: TodoList }>(`/todo/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    scope
  })
export const deleteTodoList = (scope: string, listId: string) =>
  request<void>(`/todo/lists/${encodeURIComponent(listId)}`, {
    method: 'DELETE',
    scope
  })

// Clipboard（支持 scope）
export const getClipboardHistory = (scope: string, limit?: number) => {
  let url = `/clipboard/history?scope=${encodeURIComponent(scope)}`
  if (limit != null) url += `&limit=${limit}`
  return request<{ items: ClipboardItem[] }>(url)
}
export const addClipboardItem = (
  payload: { type: ClipboardItemType; content: string; sourceApp?: string },
  scope?: string
) =>
  request<{ item: ClipboardItem }>('/clipboard', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope
  })
export const deleteClipboardItem = (id: string, scope?: string) =>
  request<void>(`/clipboard/${id}`, { method: 'DELETE', scope })

// Documents（支持 scope）
export const getDocuments = (scope?: string) =>
  request<{ documents: Document[] }>('/documents', { scope })
export const getDocument = (id: string, scope?: string) =>
  request<{ document: Document }>(`/documents/${id}`, { scope })
export const createDocument = (payload: { title: string; content?: string }, scope?: string) =>
  request<{ document: Document }>('/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope
  })
export const updateDocument = (
  id: string,
  payload: { title?: string; content?: string },
  scope?: string
) =>
  request<{ document: Document }>(`/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    scope
  })
export const deleteDocument = (id: string, scope?: string) =>
  request<void>(`/documents/${id}`, { method: 'DELETE', scope })

// Agent（支持 scope）
export const listAgentSessions = (scope: string) =>
  request<{ sessions: AgentSession[] }>('/agent/sessions', { scope })
/** 调试用：获取 scope 上下文摘要预览 */
export const getAgentScopeContext = (scope: string) =>
  request<{ summary: string; scope: string }>('/agent/debug/scope-context', {
    scope
  })

/** 可引用项（用于 @ 自动补全） */
export interface ScopeRefItem {
  id: string
  kind: 'note' | 'todo' | 'document'
  title: string
  charCount: number
  isShort: boolean
  updatedAt: number
  groupOrStatus?: string
}

export const getAgentScopeItems = (scope: string) =>
  request<{ refTypes: { key: string; label: string; aliases: string[] }[]; items: ScopeRefItem[] }>(
    '/agent/scope-items',
    { scope }
  )

/** slash 命令列表（用于 / 下拉菜单） */
export interface SlashCommandItem {
  name: string
  aliases: string[]
  description: string
}

export const getAgentSlashCommands = (scope: string) =>
  request<{ commands: SlashCommandItem[] }>('/agent/slash-commands', { scope })

/** 会话上下文追踪状态 */
export interface SessionContextState {
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
  modifications: { itemId: string; type: string; action: string; timestamp: number }[]
}

export const getAgentSessionContext = (sessionId: string, scope: string) =>
  request<SessionContextState>(`/agent/sessions/${sessionId}/context`, { scope })
export const createAgentSession = (scope?: string) =>
  request<{ session: AgentSession }>('/agent/sessions', {
    method: 'POST',
    scope
  })
export const getAgentSession = (id: string, scope?: string) =>
  request<{ session: AgentSession }>(`/agent/sessions/${id}`, { scope })
export const deleteAgentSession = (id: string, scope?: string) =>
  request<void>(`/agent/sessions/${id}`, { method: 'DELETE', scope })

// Agent 工具设置（内置 + MCP 统一）
export interface TavilySettings {
  apiKey?: string
  enabled?: boolean
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  configured?: boolean
}

export interface DocumentSummarySettings {
  enabled?: boolean
  minLen?: number
}

export interface ConversationSummarySettings {
  enabled?: boolean
  interval?: number
  model?: string
}

export interface AgentLLMSettings {
  documentSummary?: DocumentSummarySettings
  conversationSummary?: ConversationSummarySettings
  defaultModel?: string
}

export interface AgentToolsSettings {
  builtin?: { tavily?: TavilySettings }
  agent?: AgentLLMSettings
  mcpServers?: Array<{
    id: string
    name: string
    transport: string
    stdio?: { command: string; args?: string[]; env?: Record<string, string> }
    url?: string
    headers?: Record<string, string>
    enabled: boolean
  }>
  updatedAt?: number
}

export const getAgentTools = () => request<AgentToolsSettings>('/settings/agent-tools')

export interface ModelEntry {
  configId: string
  configName: string
  modelId: string
  label: string
}

export interface AgentModelsResponse {
  defaultModel?: string
  configs: Array<{ id: string; name?: string; type: string; baseUrl?: string; configured?: boolean }>
  entries: ModelEntry[]
}

export const getAgentModels = () =>
  request<AgentModelsResponse>('/settings/agent-models')

export const updateAgentTools = (patch: Partial<AgentToolsSettings>) =>
  request<AgentToolsSettings>('/settings/agent-tools', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })

export const updateTavilySettings = (update: Partial<TavilySettings>) =>
  request<{ tavily: TavilySettings | null }>('/settings/agent-tools/builtin/tavily', {
    method: 'PUT',
    body: JSON.stringify(update)
  })

// MCP 服务器（与 settings 统一存储）
export const listMcpServers = () =>
  request<{ mcpServers: AgentToolsSettings['mcpServers'] }>('/mcp/servers').then(
    (r) => r.mcpServers ?? []
  )
export const addMcpServer = (config: NonNullable<AgentToolsSettings['mcpServers']>[0]) =>
  request<NonNullable<AgentToolsSettings['mcpServers']>[0]>('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(config)
  })
export const updateMcpServer = (
  id: string,
  update: Partial<Omit<NonNullable<AgentToolsSettings['mcpServers']>[0], 'id'>>
) =>
  request<NonNullable<AgentToolsSettings['mcpServers']>[0]>(
    `/mcp/servers/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(update)
    }
  )
export const deleteMcpServer = (id: string) =>
  request<void>(`/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const getMcpServerTools = (id: string) =>
  request<{
    tools: Array<{ serverId: string; name: string; fullName: string; description?: string }>
  }>(`/mcp/servers/${encodeURIComponent(id)}/tools`)

// 审计日志（支持 scope）
export interface AuditEntry {
  id: string
  scope: string
  actorType: 'agent' | 'user' | 'system'
  sessionId?: string
  clientId?: string
  toolName: string
  action: string
  resourceType: string
  resourceId?: string
  resourceTitle?: string
  detail?: string
  result: string
  errorMessage?: string
  timestamp: number
}

export interface AuditFilter {
  scope?: string
  sessionId?: string
  resourceType?: string
  resourceId?: string
  action?: string
  result?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

export function getAudit(filter?: AuditFilter) {
  const params = new URLSearchParams()
  if (filter?.scope) params.set('scope', filter.scope)
  if (filter?.sessionId) params.set('sessionId', filter.sessionId)
  if (filter?.resourceType) params.set('resourceType', filter.resourceType)
  if (filter?.resourceId) params.set('resourceId', filter.resourceId)
  if (filter?.action) params.set('action', filter.action)
  if (filter?.result) params.set('result', filter.result)
  if (filter?.since != null) params.set('since', String(filter.since))
  if (filter?.until != null) params.set('until', String(filter.until))
  if (filter?.limit != null) params.set('limit', String(filter.limit))
  if (filter?.offset != null) params.set('offset', String(filter.offset))
  const qs = params.toString()
  return request<{ entries: AuditEntry[]; total: number }>(
    `/agent/audit${qs ? '?' + qs : ''}`
  )
}

export function getAuditResourceHistory(
  resourceType: string,
  resourceId: string,
  scope?: string,
  limit?: number
) {
  let url = `/agent/audit/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`
  if (scope) url += `?scope=${encodeURIComponent(scope)}`
  if (limit != null) url += (url.includes('?') ? '&' : '?') + `limit=${limit}`
  return request<{ entries: AuditEntry[] }>(url)
}

// 资源锁（支持 scope）
export interface ResourceLock {
  id: string
  resourceType: 'document' | 'todo_list'
  resourceId: string
  scope: string
  sessionId: string
  fenceToken: number
  reason?: string
  acquiredAt: number
  lastHeartbeat: number
  ttlMs: number
}

export function getLocks(scope?: string) {
  return request<{ data: ResourceLock[] }>('/agent/locks', { scope }).then((r) => r.data ?? [])
}

export function forceReleaseLock(
  resourceType: 'document' | 'todo_list',
  resourceId: string,
  scope?: string,
  body?: { reason?: string }
) {
  return request<{
    released: boolean
    previousHolder?: { sessionId: string; acquiredAt: number; reason?: string }
  }>(`/agent/locks/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/force-release`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    scope
  })
}

// Embedding 状态
export interface EmbeddingStatus {
  state: string
  modelName: string
  dimension: number
  enabled: boolean
  stats: {
    totalCalls: number
    totalErrors: number
    totalCharsProcessed: number
    lastError: string | null
    p95LatencyMs: number
    minLatencyMs: number
    maxLatencyMs: number
    modelLoadTimeMs: number
  }
  cacheDir: string
  processMemoryMb: number
  upSinceMs: number | null
}

export const getEmbeddingStatus = () => request<EmbeddingStatus>('/embedding/status')

export const postEmbeddingReload = () =>
  request<{ message: string }>('/embedding/reload', { method: 'POST' })

// Skills 列表（只读 + 启用/禁用）
export interface SkillMeta {
  name: string
  description?: string
  enabled?: boolean
  [key: string]: unknown
}

export const getSkills = () =>
  request<{ skills: SkillMeta[] }>('/skills').then((r) => r.skills ?? [])

export function patchSkill(name: string, patch: { enabled?: boolean }) {
  return request<SkillMeta>(`/skills/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
}

// Agent 规则（user / scope）
export interface AgentRule {
  id: string
  title: string
  enabled: boolean
  alwaysApply?: boolean
  level: 'user' | 'scope'
  scope?: string
  [key: string]: unknown
}

export function getAgentRules(level: 'user' | 'scope', scope?: string) {
  const params = new URLSearchParams()
  params.set('level', level)
  if (scope) params.set('scope', scope)
  return request<{ rules: AgentRule[] }>(`/agent-rules?${params}`).then((r) => r.rules ?? [])
}

export function patchAgentRule(
  id: string,
  patch: { enabled?: boolean; title?: string; alwaysApply?: boolean },
  level: 'user' | 'scope' = 'user',
  scope?: string
) {
  const params = new URLSearchParams()
  params.set('level', level)
  if (scope) params.set('scope', scope)
  return request<AgentRule>(`/agent-rules/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
}

export function deleteAgentRule(
  id: string,
  level: 'user' | 'scope' = 'user',
  scope?: string
) {
  const params = new URLSearchParams()
  params.set('level', level)
  if (scope) params.set('scope', scope)
  return request<void>(`/agent-rules/${encodeURIComponent(id)}?${params}`, {
    method: 'DELETE'
  })
}

// 服务端配置（可视化，脱敏）
export interface ServerConfigResponse {
  dataDir: string
  server?: {
    port?: number
    host?: string
    authDisabled?: boolean
    logLevel?: string
    mcpScope?: string
  }
  embedding?: {
    enabled?: boolean
    model?: string
    cacheDir?: string
    dtype?: string
    maxConcurrency?: number
  }
  agent?: { scopeContextMaxChars?: number }
  llm?: {
    defaultModel?: string
    browserModel?: string
    configs?: Array<{
      id: string
      name?: string
      type: 'openai_compatible' | 'anthropic' | 'google'
      baseUrl?: string
      configured?: boolean
    }>
  }
  skills?: { skillKitApiUrl?: string; configured?: boolean }
}

export const getServerConfig = () => request<ServerConfigResponse>('/settings/server-config')

export const updateServerConfig = (patch: Partial<ServerConfigResponse>) =>
  request<ServerConfigResponse>('/settings/server-config', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })

/** 流式对话，返回 ReadableStream，解析 SSE 事件 */
export async function sendAgentChat(
  id: string,
  content: string,
  scope?: string,
  options?: { model?: string; includeScopeContext?: boolean }
): Promise<ReadableStream<{ type: string; value?: string }>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Prizm-Panel': 'true'
  }
  let url = `${getBaseUrl()}/agent/sessions/${id}/chat`
  if (scope) url += `?scope=${encodeURIComponent(scope)}`
  const body: Record<string, unknown> = { content }
  if (options?.model) body.model = options.model
  if (options?.includeScopeContext === false) body.includeScopeContext = false
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('No response body')
  return new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as {
                  type?: string
                  value?: string
                }
                controller.enqueue({
                  type: data.type ?? 'unknown',
                  value: data.value
                })
              } catch {
                // ignore parse error
              }
            }
          }
        }
      } finally {
        controller.close()
      }
    }
  })
}

// Token Usage

export interface TokenUsageBucketStat {
  input: number
  output: number
  total: number
  cached: number
  count: number
}

export interface TokenUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCachedInputTokens: number
  count: number
  byCategory: Record<string, TokenUsageBucketStat>
  byDataScope: Record<string, TokenUsageBucketStat>
  byModel: Record<string, TokenUsageBucketStat>
}

export interface TokenUsageFilter {
  scope?: string
  category?: string
  sessionId?: string
  from?: number
  to?: number
  limit?: number
  offset?: number
}

export function getTokenUsage(filter?: TokenUsageFilter) {
  const params = new URLSearchParams()
  if (filter?.scope) params.set('scope', filter.scope)
  if (filter?.category) params.set('category', filter.category)
  if (filter?.sessionId) params.set('sessionId', filter.sessionId)
  if (filter?.from != null) params.set('from', String(filter.from))
  if (filter?.to != null) params.set('to', String(filter.to))
  if (filter?.limit != null) params.set('limit', String(filter.limit))
  if (filter?.offset != null) params.set('offset', String(filter.offset))
  const qs = params.toString()
  return request<{ records: TokenUsageRecord[]; summary: TokenUsageSummary }>(
    `/agent/token-usage${qs ? '?' + qs : ''}`
  )
}
