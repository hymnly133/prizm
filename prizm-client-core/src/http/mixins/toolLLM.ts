/**
 * 工作流管理会话 HTTP 客户端 mixin（遗留）
 *
 * @deprecated 工作流管理会话已改为走通用 Agent 聊天（POST /agent/sessions/:id/chat），
 * 服务端不再提供 /agent/tool-llm/* 路由。以下方法保留仅为类型兼容，调用将失败。
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
  defId?: string
  status: string
  workflowDef?: Record<string, unknown>
  yamlContent?: string
  version: number
}

declare module '../client' {
  interface PrizmClient {
    /** @deprecated 已废弃，工作流管理改用 POST /agent/sessions/:id/chat */
    getToolLLMStartUrl(scope?: string): string
    /** @deprecated 已废弃，工作流管理改用 POST /agent/sessions/:id/chat */
    getToolLLMRefineUrl(sessionId: string, scope?: string): string
    /** @deprecated 已废弃，工作流管理改用 create-workflow 工具提交 */
    confirmToolLLM(sessionId: string, workflowName?: string, scope?: string): Promise<ToolLLMConfirmResult>
    /** @deprecated 已废弃 */
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
