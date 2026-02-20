/**
 * CronManager
 *
 * 管理定时任务的生命周期：注册/注销 cron 任务，触发 BG Session 执行。
 * 使用 node-cron 库进行定时调度，SQLite 持久化任务配置和执行日志。
 */

import cron from 'node-cron'
import { createLogger } from '../../logger'
import { emit } from '../eventBus/eventBus'
import * as cronStore from './cronStore'
import type { CronJob, CronRunLog } from '@prizm/shared'
import type { CreateCronJobInput, UpdateCronJobInput, CronRunLogFilter } from './types'
import type { BackgroundSessionManager } from '../backgroundSession/manager'

const log = createLogger('CronManager')

/** Grace period for recovering missed one-time jobs after restart (10 min) */
const ONCE_RECOVERY_GRACE_MS = 10 * 60_000

interface ActiveCronTask {
  jobId: string
  task: cron.ScheduledTask
}

export class CronManager {
  private bgManager: BackgroundSessionManager | undefined
  private activeTasks = new Map<string, ActiveCronTask>()
  private oneTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  async init(bgManager: BackgroundSessionManager): Promise<void> {
    this.bgManager = bgManager
    cronStore.initCronStore()

    const activeJobs = cronStore.listActiveJobs()
    for (const job of activeJobs) {
      if (job.schedule.startsWith('once:')) {
        this.recoverOneTimeJob(job)
      } else {
        this.registerTask(job)
      }
    }

    this.pruneTimer = setInterval(() => {
      try { cronStore.pruneRunLogs(90) } catch (e) { log.warn('Prune run logs failed:', e) }
    }, 24 * 60 * 60_000)

    log.info(`CronManager initialized with ${activeJobs.length} active jobs`)
  }

  /**
   * Recover a once: job after server restart.
   * If the target time is still in the future → re-register the setTimeout.
   * If the target time passed within the grace period → execute now (recovery).
   * If the target time passed beyond the grace period → mark as completed (stale).
   */
  private recoverOneTimeJob(job: CronJob): void {
    const timeStr = job.schedule.replace('once:', '')
    const targetMs = new Date(timeStr).getTime()
    if (isNaN(targetMs)) {
      log.warn('Invalid once: time on recovery, marking completed:', job.id, job.schedule)
      cronStore.setJobStatus(job.id, 'completed')
      return
    }

    const now = Date.now()
    if (targetMs > now) {
      this.registerTask(job)
      return
    }

    const overdueMs = now - targetMs
    if (overdueMs <= ONCE_RECOVERY_GRACE_MS) {
      log.info(`Recovering missed once: job (overdue ${Math.round(overdueMs / 1000)}s):`, job.id, job.name)
      this.executeJob(job)
        .then(() => { cronStore.setJobStatus(job.id, 'completed') })
        .catch((err) => {
          log.error('Recovery execution failed:', job.id, err)
          cronStore.setJobStatus(job.id, 'failed')
        })
    } else {
      log.info(`Marking stale once: job as completed (overdue ${Math.round(overdueMs / 60_000)}min):`, job.id, job.name)
      cronStore.setJobStatus(job.id, 'completed')
    }
  }

  async shutdown(): Promise<void> {
    for (const [, entry] of this.activeTasks) {
      entry.task.stop()
    }
    this.activeTasks.clear()

    for (const [, timer] of this.oneTimers) {
      clearTimeout(timer)
    }
    this.oneTimers.clear()

    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }

    cronStore.closeCronStore()
    log.info('CronManager shut down')
  }

  createJob(input: CreateCronJobInput): CronJob {
    if (!input.schedule.startsWith('once:') && !cron.validate(input.schedule)) {
      throw new Error(`Invalid cron expression: ${input.schedule}`)
    }

    const job = cronStore.createJob(input)
    this.registerTask(job)

    void emit('cron:job.created', {
      scope: job.scope,
      jobId: job.id,
      name: job.name,
      schedule: job.schedule
    })

    log.info('Cron job created:', job.id, job.name, job.schedule)
    return job
  }

  updateJob(id: string, input: UpdateCronJobInput): CronJob | null {
    if (input.schedule && !input.schedule.startsWith('once:') && !cron.validate(input.schedule)) {
      throw new Error(`Invalid cron expression: ${input.schedule}`)
    }

    const updated = cronStore.updateJob(id, input)
    if (!updated) return null

    this.unregisterTask(id)
    if (updated.status === 'active') {
      this.registerTask(updated)
    }

    log.info('Cron job updated:', id)
    return updated
  }

  deleteJob(id: string): boolean {
    this.unregisterTask(id)
    const result = cronStore.deleteJob(id)
    if (result) log.info('Cron job deleted:', id)
    return result
  }

  pauseJob(id: string): CronJob | null {
    const job = cronStore.getJobById(id)
    if (!job || job.status !== 'active') return null

    this.unregisterTask(id)
    cronStore.setJobStatus(id, 'paused')
    log.info('Cron job paused:', id)
    return cronStore.getJobById(id)
  }

  resumeJob(id: string): CronJob | null {
    const job = cronStore.getJobById(id)
    if (!job || job.status !== 'paused') return null

    cronStore.setJobStatus(id, 'active')
    const updated = cronStore.getJobById(id)!
    this.registerTask(updated)
    log.info('Cron job resumed:', id)
    return updated
  }

  async triggerManually(id: string): Promise<string | null> {
    const job = cronStore.getJobById(id)
    if (!job) return null
    return this.executeJob(job)
  }

  getJob(id: string): CronJob | null {
    return cronStore.getJobById(id)
  }

  listJobs(scope?: string, status?: string): CronJob[] {
    return cronStore.listJobs(scope, status)
  }

  getRunLogs(filter: CronRunLogFilter): CronRunLog[] {
    return cronStore.getRunLogs(filter)
  }

  // ─── 内部方法 ───

  private registerTask(job: CronJob): void {
    if (job.schedule.startsWith('once:')) {
      this.registerOneTimeTask(job)
      return
    }

    if (!cron.validate(job.schedule)) {
      log.warn('Invalid cron schedule, skipping:', job.id, job.schedule)
      return
    }

    const options: cron.ScheduleOptions = {
      timezone: job.timezone || undefined
    }

    const task = cron.schedule(job.schedule, () => {
      this.executeJob(job).catch((err) => {
        log.error('Cron job execution error:', job.id, err)
      })
    }, options)

    this.activeTasks.set(job.id, { jobId: job.id, task })
  }

  private registerOneTimeTask(job: CronJob): void {
    const timeStr = job.schedule.replace('once:', '')
    const targetTime = new Date(timeStr).getTime()
    if (isNaN(targetTime)) {
      log.warn('Invalid once: time, skipping:', job.id, job.schedule)
      return
    }

    const delayMs = targetTime - Date.now()
    if (delayMs <= 0) {
      this.executeJob(job).catch((err) => {
        log.error('One-time job execution error:', job.id, err)
      })
      cronStore.setJobStatus(job.id, 'completed')
      return
    }

    const timer = setTimeout(() => {
      this.oneTimers.delete(job.id)
      this.executeJob(job)
        .then(() => {
          cronStore.setJobStatus(job.id, 'completed')
        })
        .catch((err) => {
          log.error('One-time job execution error:', job.id, err)
          cronStore.setJobStatus(job.id, 'failed')
        })
    }, delayMs)

    this.oneTimers.set(job.id, timer)
  }

  private unregisterTask(jobId: string): void {
    const entry = this.activeTasks.get(jobId)
    if (entry) {
      entry.task.stop()
      this.activeTasks.delete(jobId)
    }

    const timer = this.oneTimers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.oneTimers.delete(jobId)
    }
  }

  private async executeJob(job: CronJob): Promise<string> {
    if (!this.bgManager) {
      throw new Error('BackgroundSessionManager not available')
    }

    const runLogId = cronStore.insertRunLog(job.id)

    try {
      const { sessionId } = await this.bgManager.trigger(
        job.scope,
        {
          prompt: job.taskPrompt,
          ...(job.taskContext && { context: JSON.parse(job.taskContext) }),
          systemInstructions: `你正在执行定时任务「${job.name}」。请完成任务后调用 prizm_set_result 提交结果。`
        },
        {
          triggerType: 'cron',
          label: `cron:${job.name}`,
          model: job.model,
          timeoutMs: job.timeoutMs,
          autoCleanup: true
        }
      )

      cronStore.recordJobRun(job.id, sessionId, 'running')
      cronStore.completeRunLog(runLogId, 'success')

      void emit('cron:job.executed', {
        scope: job.scope,
        jobId: job.id,
        sessionId,
        status: 'success'
      })

      log.info('Cron job executed:', job.id, 'session:', sessionId)
      return sessionId
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      cronStore.completeRunLog(runLogId, 'failed', errMsg)
      cronStore.recordJobRun(job.id, undefined, 'failed')

      void emit('cron:job.failed', {
        scope: job.scope,
        jobId: job.id,
        error: errMsg
      })

      log.error('Cron job failed:', job.id, errMsg)
      throw err
    }
  }
}

export const cronManager = new CronManager()
