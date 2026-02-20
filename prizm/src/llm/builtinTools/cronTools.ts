/**
 * 内置工具：定时任务 (Cron) 管理
 *
 * Action: list / create / update / delete / pause / resume / trigger / logs
 */

import { cronManager } from '../../core/cronScheduler'
import type { CronJob } from '@prizm/shared'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

export function executeList(ctx: BuiltinToolContext): BuiltinToolResult {
  const status = typeof ctx.args.status === 'string' ? ctx.args.status : undefined
  const jobs = cronManager.listJobs(ctx.scope, status)

  if (jobs.length === 0) {
    return { text: '当前没有定时任务。' }
  }

  const lines = jobs.map((j) => {
    const lastRun = j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : '从未执行'
    return `- [${j.status}] ${j.name} | ${j.schedule} | 已执行${j.runCount}次 | 上次:${lastRun} | id:${j.id}`
  })
  return { text: `共 ${jobs.length} 个定时任务：\n${lines.join('\n')}` }
}

export async function executeCreate(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const name = typeof ctx.args.name === 'string' ? ctx.args.name.trim() : ''
  const schedule = typeof ctx.args.schedule === 'string' ? ctx.args.schedule.trim() : ''
  const taskPrompt = typeof ctx.args.taskPrompt === 'string' ? ctx.args.taskPrompt.trim() : ''

  if (!name) return { text: '需要 name', isError: true }
  if (!schedule) return { text: '需要 schedule (cron 表达式或 once:ISO时间)', isError: true }
  if (!taskPrompt) return { text: '需要 taskPrompt', isError: true }

  try {
    const job = cronManager.createJob({
      name,
      description: typeof ctx.args.description === 'string' ? ctx.args.description : undefined,
      scope: ctx.scope,
      schedule,
      timezone: typeof ctx.args.timezone === 'string' ? ctx.args.timezone : undefined,
      taskPrompt,
      taskContext: typeof ctx.args.context === 'string' ? ctx.args.context : undefined,
      executionMode: ctx.args.executionMode === 'main' ? 'main' : 'isolated',
      model: typeof ctx.args.model === 'string' ? ctx.args.model : undefined,
      timeoutMs: typeof ctx.args.timeout_seconds === 'number' ? ctx.args.timeout_seconds * 1000 : undefined
    })

    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'create',
      resourceType: 'cron_job',
      resourceId: job.id,
      resourceTitle: job.name,
      result: 'success'
    })

    return { text: `定时任务已创建: "${job.name}" | ${job.schedule} | id:${job.id}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `创建失败: ${msg}`, isError: true }
  }
}

export async function executeUpdate(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  try {
    const job = cronManager.updateJob(id, {
      name: typeof ctx.args.name === 'string' ? ctx.args.name : undefined,
      description: typeof ctx.args.description === 'string' ? ctx.args.description : undefined,
      schedule: typeof ctx.args.schedule === 'string' ? ctx.args.schedule : undefined,
      timezone: typeof ctx.args.timezone === 'string' ? ctx.args.timezone : undefined,
      taskPrompt: typeof ctx.args.taskPrompt === 'string' ? ctx.args.taskPrompt : undefined,
      model: typeof ctx.args.model === 'string' ? ctx.args.model : undefined
    })

    if (!job) return { text: `定时任务 ${id} 不存在`, isError: true }
    return { text: `定时任务已更新: "${job.name}"` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `更新失败: ${msg}`, isError: true }
  }
}

export async function executeDelete(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  const deleted = cronManager.deleteJob(id)
  if (!deleted) return { text: `定时任务 ${id} 不存在`, isError: true }
  return { text: '定时任务已删除' }
}

export async function executePause(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  const job = cronManager.pauseJob(id)
  if (!job) return { text: `定时任务 ${id} 不存在或非活跃状态`, isError: true }
  return { text: `定时任务已暂停: "${job.name}"` }
}

export async function executeResume(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  const job = cronManager.resumeJob(id)
  if (!job) return { text: `定时任务 ${id} 不存在或非暂停状态`, isError: true }
  return { text: `定时任务已恢复: "${job.name}"` }
}

export async function executeTrigger(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  try {
    const sessionId = await cronManager.triggerManually(id)
    if (sessionId == null) return { text: `定时任务 ${id} 不存在`, isError: true }
    return { text: `定时任务已手动触发, 后台会话: ${sessionId}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `触发失败: ${msg}`, isError: true }
  }
}

export function executeLogs(ctx: BuiltinToolContext): BuiltinToolResult {
  const id = typeof ctx.args.jobId === 'string' ? ctx.args.jobId : ''
  if (!id) return { text: '需要 jobId', isError: true }

  const logs = cronManager.getRunLogs({ jobId: id, limit: 20 })
  if (logs.length === 0) return { text: '暂无执行日志' }

  const lines = logs.map((l) => {
    const start = new Date(l.startedAt).toLocaleString()
    const duration = l.durationMs ? `${l.durationMs}ms` : '运行中'
    const err = l.error ? ` | 错误:${l.error}` : ''
    return `- [${l.status}] ${start} | ${duration}${err}`
  })
  return { text: `最近 ${logs.length} 条执行日志：\n${lines.join('\n')}` }
}
