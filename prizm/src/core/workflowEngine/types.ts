/**
 * Workflow Engine — 内部类型定义
 *
 * 包含 IStepExecutor 抽象接口及引擎内部运行时类型。
 * 领域类型（WorkflowDef, WorkflowRun 等）从 @prizm/shared 导入。
 */

import type { BgSessionSource, WorkflowStepSessionConfig } from '@prizm/shared'

// ─── 抽象执行层 ───

/** 传递给 IStepExecutor 的输入 */
export interface StepExecutionInput {
  prompt: string
  context?: Record<string, unknown>
  systemInstructions?: string
  expectedOutputFormat?: string
  model?: string
  timeoutMs?: number
  label?: string
  /** Workflow 工作区绝对路径，BG Session 将以此为默认文件操作根目录 */
  workspaceDir?: string
  /** Workflow 级持久工作空间路径（跨 run 共享） */
  persistentWorkspaceDir?: string
  /** Run 级独立工作空间路径（本次 run 独占） */
  runWorkspaceDir?: string
  /** 上层来源标识（direct / task / workflow） */
  source?: BgSessionSource
  /** 关联的上层记录 ID（TaskRun.id 或 WorkflowRun.id） */
  sourceId?: string
  /** Agent 步骤的 Session 高级配置 */
  sessionConfig?: WorkflowStepSessionConfig
  /** 函数化输入参数（schema + values），注入 BG Session 系统提示词 */
  inputParams?: {
    schema: Record<string, { type?: string; description?: string }>
    values: Record<string, unknown>
  }
  /** 函数化输出参数 schema，动态构建 prizm_set_result 工具 */
  outputParams?: {
    schema: Record<string, { type?: string; description?: string }>
    required?: string[]
  }
}

/** IStepExecutor 返回的执行结果 */
export interface StepExecutionOutput {
  sessionId: string
  status: 'success' | 'partial' | 'failed' | 'timeout' | 'cancelled'
  output: string
  structuredData?: string
  artifacts?: string[]
  durationMs: number
}

/**
 * 步骤执行器抽象接口。
 *
 * BG Session 为默认实现，未来可替换为 MCP、HTTP 等执行后端。
 * 当 BG Session 的触发入口变更时，只需修改对应实现类。
 */
export interface IStepExecutor {
  execute(scope: string, input: StepExecutionInput, signal?: AbortSignal): Promise<StepExecutionOutput>
}

// ─── 引擎运行时类型 ───

/** 工作流运行的结果（runner 返回给调用者） */
export interface WorkflowRunResult {
  runId: string
  status: 'completed' | 'paused' | 'failed' | 'cancelled'
  /** 最终输出（最后一个 step 的 output） */
  finalOutput?: string
  /** 当 status='paused' 时，供后续 resume 使用 */
  resumeToken?: string
  /** 需要审批时的提示信息 */
  approvePrompt?: string
  error?: string
}

/** runner.runWorkflow() 的选项 */
export interface RunWorkflowOptions {
  /** 工作流参数 */
  args?: Record<string, unknown>
  /** 触发方式 */
  triggerType?: 'manual' | 'cron' | 'schedule' | 'event'
  /** 关联的日程 ID */
  linkedScheduleId?: string
  /** 关联的 Todo ID */
  linkedTodoId?: string
  /** 是否保留上次 run 的文件（默认 true — 复用工作区） */
  reuseWorkspace?: boolean
  /** 运行前是否清空工作区自由区域（不删 .meta/），默认 false */
  cleanBefore?: boolean
}
