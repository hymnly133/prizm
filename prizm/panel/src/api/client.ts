/**
 * Prizm API 客户端
 * 开发时通过 Vite proxy 转发，生产时同源请求
 */

import type {
  StickyNote,
  StickyNoteGroup,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  PomodoroSession,
  ClipboardItem,
  ClipboardItemType,
  Document,
  AgentSession,
  AgentMessage,
  ClientInfo,
  ScopeDescription
} from '@prizm/shared'

export type {
  StickyNote,
  StickyNoteGroup,
  StickyNoteFileRef,
  CreateNotePayload,
  UpdateNotePayload,
  TodoList,
  TodoItem,
  PomodoroSession,
  ClipboardItem,
  ClipboardItemType,
  Document,
  AgentSession,
  AgentMessage,
  ClientInfo,
  ScopeDescription
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

// Notes Groups（支持 scope）
export const getGroups = (scope?: string) =>
  request<{ groups: StickyNoteGroup[] }>('/notes/groups', { scope })
export const createGroup = (name: string, scope?: string) =>
  request<{ group: StickyNoteGroup }>('/notes/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
    scope
  })
export const updateGroup = (id: string, name: string, scope?: string) =>
  request<{ group: StickyNoteGroup }>(`/notes/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
    scope
  })
export const deleteGroup = (id: string, scope?: string) =>
  request<void>(`/notes/groups/${id}`, { method: 'DELETE', scope })

// Notify
export const sendNotify = (title: string, body?: string) =>
  request<{ success: boolean }>('/notify', {
    method: 'POST',
    body: JSON.stringify({ title, body })
  })

// TODO 列表（支持 scope）
export const getTodoList = (scope: string, options?: { itemId?: string }) => {
  let url = `/todo?scope=${encodeURIComponent(scope)}`
  if (options?.itemId) url += `&itemId=${encodeURIComponent(options.itemId)}`
  return request<{ todoList: TodoList | null }>(url)
}
export const createTodoList = (scope: string, payload?: { title?: string }) =>
  request<{ todoList: TodoList }>('/todo', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    scope
  })
export const updateTodoListTitle = (scope: string, title: string) =>
  request<{ todoList: TodoList }>('/todo', {
    method: 'PATCH',
    body: JSON.stringify({ title }),
    scope
  })
export const replaceTodoItems = (scope: string, items: TodoItem[]) =>
  request<{ todoList: TodoList }>('/todo/items', {
    method: 'PUT',
    body: JSON.stringify({ items }),
    scope
  })
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
export const deleteTodoList = (scope: string) =>
  request<void>('/todo', {
    method: 'DELETE',
    scope
  })

// Pomodoro（支持 scope）
export const getPomodoroSessions = (
  scope: string,
  filters?: { taskId?: string; from?: number; to?: number }
) => {
  let url = `/pomodoro/sessions?scope=${encodeURIComponent(scope)}`
  if (filters?.taskId) url += `&taskId=${encodeURIComponent(filters.taskId)}`
  if (filters?.from != null) url += `&from=${filters.from}`
  if (filters?.to != null) url += `&to=${filters.to}`
  return request<{ sessions: PomodoroSession[] }>(url)
}
export const startPomodoro = (payload?: { taskId?: string; tag?: string }, scope?: string) =>
  request<{ session: PomodoroSession }>('/pomodoro/start', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    scope
  })
export const stopPomodoro = (id: string, scope?: string) =>
  request<{ session: PomodoroSession }>('/pomodoro/stop', {
    method: 'POST',
    body: JSON.stringify({ id }),
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
export const createAgentSession = (scope?: string) =>
  request<{ session: AgentSession }>('/agent/sessions', {
    method: 'POST',
    scope
  })
export const getAgentSession = (id: string, scope?: string) =>
  request<{ session: AgentSession }>(`/agent/sessions/${id}`, { scope })
export const deleteAgentSession = (id: string, scope?: string) =>
  request<void>(`/agent/sessions/${id}`, { method: 'DELETE', scope })

/** 流式对话，返回 ReadableStream，解析 SSE 事件 */
export async function sendAgentChat(
  id: string,
  content: string,
  scope?: string,
  model?: string
): Promise<ReadableStream<{ type: string; value?: string }>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Prizm-Panel': 'true'
  }
  let url = `${getBaseUrl()}/agent/sessions/${id}/chat`
  if (scope) url += `?scope=${encodeURIComponent(scope)}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, model })
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
