/**
 * Tool LLM — 类型定义
 *
 * Tool LLM 是独立于交互 LLM 的领域专用 LLM 会话，
 * 当前支持 workflow 领域，未来可扩展到其他领域。
 */

import type { WorkflowDef } from '@prizm/shared'

/** 支持的 Tool LLM 领域 */
export type ToolLLMDomain = 'workflow'

/** 启动新 Tool LLM 会话的请求 */
export interface ToolLLMStartRequest {
  domain: ToolLLMDomain
  /** 用户的需求描述（可选：待创建会话首条消息时可由会话内已有消息提供） */
  intent?: string
  /** 已有工作流管理会话 ID（传入则复用该会话发起首轮，不创建新会话） */
  sessionId?: string
  /** 已有工作流名称（编辑模式） */
  workflowName?: string
  /** 已有工作流 YAML 内容（编辑模式自动注入） */
  existingYaml?: string
  /** 来自主对话的上下文补充 */
  context?: string
}

/** 追加消息到已有 Tool LLM 会话的请求 */
export interface ToolLLMRefineRequest {
  sessionId: string
  /** 用户的修改指令 */
  message: string
}

/** 确认 Tool LLM 产出的请求 */
export interface ToolLLMConfirmRequest {
  sessionId: string
  /** 确认保存的工作流名称（首次创建时可指定） */
  workflowName?: string
}

/** Tool LLM 单轮产出（流式 + 最终结果） */
export interface ToolLLMResult {
  sessionId: string
  /** 最新生成的工作流定义 */
  workflowDef?: WorkflowDef
  /** 原始 YAML 内容 */
  yamlContent?: string
  /** 版本号（从 1 开始递增） */
  version: number
  /** 会话状态 */
  status: ToolLLMStatus
  /** 校验错误信息 */
  validationError?: string
}

export type ToolLLMStatus =
  | 'generating'
  | 'preview'
  | 'confirmed'
  | 'cancelled'
  | 'error'

/** Tool LLM 提交工具调用的参数格式 */
export interface SubmitWorkflowArgs {
  /** 工作流定义 JSON */
  workflow_json: string
}
