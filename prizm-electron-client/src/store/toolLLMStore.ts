/**
 * toolLLMStore — 工作流管理会话本地状态（遗留）
 *
 * 工作流管理会话已改为走通用 Agent 聊天（POST /agent/sessions/:id/chat），
 * start/refine/confirm/cancel 不再请求已移除的 /agent/tool-llm/* 接口，仅保留 getSession/clearSession/bind 等本地状态。
 */

import { create } from 'zustand'
import type { PrizmClient } from '@prizm/client-core'
import type { WorkflowDef } from '@prizm/shared'
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

  start(
    intent: string,
    workflowName?: string,
    existingYaml?: string,
    context?: string,
    existingSessionId?: string
  ): Promise<string | null>
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

export const useToolLLMStore = create<ToolLLMStoreState>()((set, get) => ({
  sessions: {},

  /** @deprecated 已废弃，工作流管理请使用会话内输入框发送消息（POST /agent/sessions/:id/chat） */
  async start(intent, workflowName, existingYaml, context, existingSessionId?) {
    if (existingSessionId) return existingSessionId
    return null
  },

  /** @deprecated 已废弃，工作流管理请使用会话内输入框发送消息 */
  async refine(_sessionId, _message) {
    return
  },

  /** @deprecated 已废弃，提交请使用会话内 workflow-management-create-workflow 工具 */
  async confirm(sessionId, workflowName) {
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
  },

  /** @deprecated 已废弃，仅更新本地状态 */
  cancel(sessionId) {
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
