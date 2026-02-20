/**
 * toolLLMStore — 前端 Zustand store 管理 Tool LLM 会话状态和 SSE 流
 */

import { create } from 'zustand'
import type { PrizmClient, ToolLLMResultPayload } from '@prizm/client-core'
import type { WorkflowDef } from '@prizm/shared'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('ToolLLMStore')

export type ToolLLMSessionStatus =
  | 'idle'
  | 'generating'
  | 'preview'
  | 'refining'
  | 'confirmed'
  | 'cancelled'
  | 'error'

export interface ToolLLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolLLMSessionState {
  sessionId: string
  domain: 'workflow'
  workflowName?: string
  currentDef?: WorkflowDef
  currentYaml?: string
  versions: Array<{ def: WorkflowDef; yaml: string }>
  status: ToolLLMSessionStatus
  messages: ToolLLMMessage[]
  streamingText: string
  error?: string
}

export interface ToolLLMStoreState {
  sessions: Record<string, ToolLLMSessionState>

  start(intent: string, workflowName?: string, existingYaml?: string, context?: string): Promise<string | null>
  refine(sessionId: string, message: string): Promise<void>
  confirm(sessionId: string, workflowName?: string): Promise<boolean>
  cancel(sessionId: string): void

  getSession(sessionId: string): ToolLLMSessionState | undefined
  clearSession(sessionId: string): void

  bind(http: PrizmClient, scope: string): void
  reset(): void
}

let _http: PrizmClient | null = null
let _scope: string | null = null

function getHeaders(): Record<string, string> {
  if (!_http) return {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if ((_http as unknown as Record<string, unknown>).apiKey) {
    headers['Authorization'] = `Bearer ${(_http as unknown as Record<string, string>).apiKey}`
  }
  return headers
}

async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  onText: (text: string) => void,
  onResult: (result: ToolLLMResultPayload) => void,
  onError: (err: string) => void,
  onDone: () => void
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body)
    })

    if (!res.ok || !res.body) {
      onError(`HTTP ${res.status}: ${res.statusText}`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue

        try {
          const event = JSON.parse(jsonStr) as { type: string; value?: unknown }
          if (event.type === 'text' && typeof event.value === 'string') {
            onText(event.value)
          } else if (event.type === 'tool_llm_result') {
            onResult(event.value as ToolLLMResultPayload)
          } else if (event.type === 'error') {
            onError(typeof event.value === 'string' ? event.value : 'Unknown error')
          } else if (event.type === 'done') {
            onDone()
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
}

export const useToolLLMStore = create<ToolLLMStoreState>()((set, get) => ({
  sessions: {},

  async start(intent, workflowName, existingYaml, context) {
    if (!_http || !_scope) return null

    const tempId = `pending-${Date.now()}`
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tempId]: {
          sessionId: tempId,
          domain: 'workflow',
          workflowName,
          status: 'generating',
          messages: [{ role: 'user', content: intent }],
          versions: [],
          streamingText: ''
        }
      }
    }))

    let realSessionId: string | null = null
    const url = _http.getToolLLMStartUrl(_scope)

    await fetchSSE(
      url,
      { intent, workflowName, existingYaml, context },
      (text) => {
        set((state) => {
          const s = state.sessions[realSessionId ?? tempId]
          if (!s) return state
          return {
            sessions: {
              ...state.sessions,
              [realSessionId ?? tempId]: {
                ...s,
                streamingText: s.streamingText + text
              }
            }
          }
        })
      },
      (result) => {
        realSessionId = result.sessionId
        set((state) => {
          const old = state.sessions[tempId]
          const sessions = { ...state.sessions }
          if (tempId !== result.sessionId) {
            delete sessions[tempId]
          }
          const def = result.workflowDef as unknown as WorkflowDef | undefined
          const existing = old ?? {
            sessionId: result.sessionId,
            domain: 'workflow' as const,
            workflowName,
            status: 'generating' as const,
            messages: [{ role: 'user' as const, content: intent }],
            versions: [],
            streamingText: ''
          }

          const versions = [...existing.versions]
          if (def && result.yamlContent) {
            versions.push({ def, yaml: result.yamlContent })
          }

          sessions[result.sessionId] = {
            ...existing,
            sessionId: result.sessionId,
            currentDef: def,
            currentYaml: result.yamlContent,
            versions,
            status: result.status === 'preview' ? 'preview' : result.status === 'error' ? 'error' : existing.status,
            error: result.validationError,
            messages: [
              ...existing.messages,
              ...(existing.streamingText ? [{ role: 'assistant' as const, content: existing.streamingText }] : [])
            ],
            streamingText: ''
          }
          return { sessions }
        })
      },
      (err) => {
        set((state) => {
          const id = realSessionId ?? tempId
          const s = state.sessions[id]
          if (!s) return state
          return {
            sessions: {
              ...state.sessions,
              [id]: { ...s, status: 'error', error: err }
            }
          }
        })
      },
      () => {
        set((state) => {
          const id = realSessionId ?? tempId
          const s = state.sessions[id]
          if (!s) return state
          if (s.status === 'generating') {
            return {
              sessions: {
                ...state.sessions,
                [id]: { ...s, status: 'preview' }
              }
            }
          }
          return state
        })
      }
    )

    return realSessionId
  },

  async refine(sessionId, message) {
    if (!_http || !_scope) return

    set((state) => {
      const s = state.sessions[sessionId]
      if (!s) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            status: 'refining',
            messages: [...s.messages, { role: 'user', content: message }],
            streamingText: ''
          }
        }
      }
    })

    const url = _http.getToolLLMRefineUrl(sessionId, _scope)

    await fetchSSE(
      url,
      { message },
      (text) => {
        set((state) => {
          const s = state.sessions[sessionId]
          if (!s) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...s, streamingText: s.streamingText + text }
            }
          }
        })
      },
      (result) => {
        set((state) => {
          const s = state.sessions[sessionId]
          if (!s) return state
          const def = result.workflowDef as unknown as WorkflowDef | undefined
          const versions = [...s.versions]
          if (def && result.yamlContent) {
            versions.push({ def, yaml: result.yamlContent })
          }
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...s,
                currentDef: def ?? s.currentDef,
                currentYaml: result.yamlContent ?? s.currentYaml,
                versions,
                status: result.status === 'preview' ? 'preview' : result.status === 'error' ? 'error' : s.status,
                error: result.validationError,
                messages: [
                  ...s.messages,
                  ...(s.streamingText ? [{ role: 'assistant' as const, content: s.streamingText }] : [])
                ],
                streamingText: ''
              }
            }
          }
        })
      },
      (err) => {
        set((state) => {
          const s = state.sessions[sessionId]
          if (!s) return state
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { ...s, status: 'error', error: err }
            }
          }
        })
      },
      () => {
        set((state) => {
          const s = state.sessions[sessionId]
          if (!s) return state
          if (s.status === 'refining') {
            return {
              sessions: {
                ...state.sessions,
                [sessionId]: { ...s, status: 'preview' }
              }
            }
          }
          return state
        })
      }
    )
  },

  async confirm(sessionId, workflowName) {
    if (!_http || !_scope) return false
    try {
      const result = await _http.confirmToolLLM(sessionId, workflowName, _scope)
      set((state) => {
        const s = state.sessions[sessionId]
        if (!s) return state
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...s,
              status: 'confirmed',
              workflowName: workflowName ?? s.workflowName
            }
          }
        }
      })
      return true
    } catch (err) {
      log.error('confirm failed:', err)
      return false
    }
  },

  cancel(sessionId) {
    if (_http) {
      _http.cancelToolLLM(sessionId).catch(() => {})
    }
    set((state) => {
      const s = state.sessions[sessionId]
      if (!s) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, status: 'cancelled' }
        }
      }
    })
  },

  getSession(sessionId) {
    return get().sessions[sessionId]
  },

  clearSession(sessionId) {
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return { sessions }
    })
  },

  bind(http, scope) {
    _http = http
    _scope = scope
  },

  reset() {
    _http = null
    _scope = null
    set({ sessions: {} })
  }
}))
