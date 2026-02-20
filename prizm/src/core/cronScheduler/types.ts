/**
 * Cron Scheduler — 类型定义
 */

export type { CronJob, CronJobStatus, CronExecutionMode, CronRunLog } from '@prizm/shared'

/** 创建 CronJob 的输入 */
export interface CreateCronJobInput {
  name: string
  description?: string
  scope: string
  schedule: string
  timezone?: string
  taskPrompt: string
  taskContext?: string
  executionMode?: 'isolated' | 'main'
  model?: string
  timeoutMs?: number
  maxRetries?: number
  linkedScheduleId?: string
}

/** 更新 CronJob 的输入 */
export interface UpdateCronJobInput {
  name?: string
  description?: string
  schedule?: string
  timezone?: string
  taskPrompt?: string
  taskContext?: string
  executionMode?: 'isolated' | 'main'
  model?: string
  timeoutMs?: number
  maxRetries?: number
  linkedScheduleId?: string
}

/** Cron 运行日志查询过滤器 */
export interface CronRunLogFilter {
  jobId?: string
  status?: string
  limit?: number
  offset?: number
}
