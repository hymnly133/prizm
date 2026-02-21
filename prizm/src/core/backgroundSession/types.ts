/**
 * Background Session — 类型定义
 */

import type { BgSessionMeta, BgStatus, BgTriggerType } from '@prizm/shared'

/** 触发 BG Session 的输入结构 */
export interface BgTriggerPayload {
  /** 系统级指令（注入 system message，定义 BG 的行为框架） */
  systemInstructions?: string
  /** 用户级提示（注入 user message，描述本次具体任务） */
  prompt: string
  /** 额外上下文参数（注入到 system 消息的上下文区） */
  context?: Record<string, unknown>
  /** 期望的输出格式描述（注入 system 消息，指导 LLM 格式化输出） */
  expectedOutputFormat?: string
  /** JSON Schema 描述期望的输出结构（启用结构化输出验证） */
  outputSchema?: Record<string, unknown>
  /** Schema 验证失败时的最大重试次数，默认 2 */
  maxSchemaRetries?: number
  /** 函数化输入参数（schema + 实际值，注入 preamble 的 <input_params> 区块） */
  inputParams?: {
    schema: Record<string, { type?: string; description?: string; optional?: boolean }>
    values: Record<string, unknown>
  }
}

/** BG Session 运行结果 */
export interface BgRunResult {
  sessionId: string
  status: 'success' | 'partial' | 'failed' | 'timeout' | 'cancelled'
  /** 主输出（由 prizm_set_result 写入或守卫降级兜底） */
  output: string
  /** 可选的结构化数据 */
  structuredData?: string
  /** 可选的产出文件列表 */
  artifacts?: string[]
  durationMs: number
  /** 失败时的堆栈或完整错误详情（便于工作流步骤展示） */
  errorDetail?: string
}

/** 活跃运行追踪条目 */
export interface ActiveRunEntry {
  sessionId: string
  scope: string
  abortController: AbortController
  startedAt: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
  resolve: (result: BgRunResult) => void
}

/** BG Session 并发限制配置 */
export interface BgConcurrencyLimits {
  /** 单个父会话最大活跃子任务数，默认 5 */
  maxPerParent: number
  /** 系统级最大活跃 BG Session 数，默认 10 */
  maxGlobal: number
  /** 最大嵌套深度，默认 2 */
  maxDepth: number
}

export type { BgSessionMeta, BgStatus, BgTriggerType }
