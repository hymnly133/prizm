/**
 * Tool LLM HTTP 客户端 mixin
 *
 * 提供 Tool LLM 会话管理的 HTTP API 方法。
 * SSE 流式接口返回 EventSource URL，具体消费在前端 store 处理。
 */

import { PrizmClient } from '../client'

export interface ToolLLMStartPayload {
  intent: string
  workflowName?: string
  existingYaml?: string
  context?: string
}

export interface ToolLLMResultPayload {
  sessionId: string
  status: string
  version: number
  workflowDef?: Record<string, unknown>
  yamlContent?: string
  validationError?: string
}

export interface ToolLLMConfirmResult {
  sessionId: string
  status: string
  workflowDef?: Record<string, unknown>
  yamlContent?: string
  version: number
}

declare module '../client' {
  interface PrizmClient {
    /** 获取 Tool LLM start 的 SSE URL（前端直接 fetch） */
    getToolLLMStartUrl(scope?: string): string
    /** 获取 Tool LLM refine 的 SSE URL */
    getToolLLMRefineUrl(sessionId: string, scope?: string): string
    /** 确认 Tool LLM 产出 */
    confirmToolLLM(sessionId: string, workflowName?: string, scope?: string): Promise<ToolLLMConfirmResult>
    /** 取消 Tool LLM 会话 */
    cancelToolLLM(sessionId: string): Promise<void>
  }
}

PrizmClient.prototype.getToolLLMStartUrl = function (
  this: PrizmClient,
  scope?: string
): string {
  const s = scope ?? this.defaultScope
  return `${this.baseUrl}/agent/tool-llm/start?scope=${encodeURIComponent(s)}`
}

PrizmClient.prototype.getToolLLMRefineUrl = function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
): string {
  const s = scope ?? this.defaultScope
  return `${this.baseUrl}/agent/tool-llm/${encodeURIComponent(sessionId)}/refine?scope=${encodeURIComponent(s)}`
}

PrizmClient.prototype.confirmToolLLM = async function (
  this: PrizmClient,
  sessionId: string,
  workflowName?: string,
  scope?: string
) {
  return this.request<ToolLLMConfirmResult>(
    `/agent/tool-llm/${encodeURIComponent(sessionId)}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ workflowName }),
      scope
    }
  )
}

PrizmClient.prototype.cancelToolLLM = async function (
  this: PrizmClient,
  sessionId: string
) {
  await this.request(`/agent/tool-llm/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST'
  })
}
