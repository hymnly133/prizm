/**
 * TaskRunner — Workflow 子模块级复用组件
 *
 * 将 IStepExecutor 封装为单步任务执行器，提供：
 * - 异步触发（立即返回 taskId）
 * - 同步执行（等待完成）
 * - 任务状态查询与取消
 * - task_runs 表持久化
 * - watchdog 定时巡检，强制超时卡死任务
 *
 * 与 WorkflowRunner 共享同一个 IStepExecutor 实例。
 */

import type { TaskRun, TaskRunStatus } from '@prizm/shared'
import type { IStepExecutor, StepExecutionInput } from './types'
import * as store from './resumeStore'
import { emit } from '../eventBus/eventBus'
import { createLogger } from '../../logger'

const log = createLogger('TaskRunner')

const DEFAULT_TIMEOUT_MS = 600_000
const WATCHDOG_INTERVAL_MS = 60_000
const TIMEOUT_SAFETY_FACTOR = 1.5

export interface TaskTriggerInput {
  prompt: string
  context?: Record<string, unknown>
  systemInstructions?: string
  expectedOutputFormat?: string
  model?: string
  timeoutMs?: number
  label?: string
  workspaceDir?: string
}

export interface TaskMeta {
  triggerType?: TaskRun['triggerType']
  parentSessionId?: string
}

interface PendingEntry {
  abort: () => void
  scope: string
  label?: string
  startedAt: number
  timeoutMs: number
}

export class TaskRunner {
  private pendingPromises = new Map<string, PendingEntry>()
  private watchdogTimer: ReturnType<typeof setInterval> | null = null

  constructor(private executor: IStepExecutor) {
    this.startWatchdog()
  }

  async trigger(
    scope: string,
    input: TaskTriggerInput,
    meta?: TaskMeta
  ): Promise<{ taskId: string }> {
    const taskRun = store.createTaskRun(scope, {
      prompt: input.prompt,
      context: input.context,
      expectedOutputFormat: input.expectedOutputFormat,
      model: input.model,
      timeoutMs: input.timeoutMs
    }, {
      label: input.label,
      triggerType: meta?.triggerType ?? 'manual',
      parentSessionId: meta?.parentSessionId
    })

    store.updateTaskRun(taskRun.id, { status: 'running' as TaskRunStatus })

    void emit('task:started', { scope, taskId: taskRun.id, label: input.label })

    const abortController = new AbortController()
    this.pendingPromises.set(taskRun.id, {
      abort: () => abortController.abort(),
      scope,
      label: input.label,
      startedAt: Date.now(),
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })

    this.executeInBackground(scope, taskRun.id, input, abortController.signal).catch((err) => {
      log.error('Background task execution error:', taskRun.id, err)
    })

    return { taskId: taskRun.id }
  }

  async triggerSync(
    scope: string,
    input: TaskTriggerInput,
    meta?: TaskMeta
  ): Promise<TaskRun> {
    const taskRun = store.createTaskRun(scope, {
      prompt: input.prompt,
      context: input.context,
      expectedOutputFormat: input.expectedOutputFormat,
      model: input.model,
      timeoutMs: input.timeoutMs
    }, {
      label: input.label,
      triggerType: meta?.triggerType ?? 'manual',
      parentSessionId: meta?.parentSessionId
    })

    store.updateTaskRun(taskRun.id, { status: 'running' as TaskRunStatus })

    void emit('task:started', { scope, taskId: taskRun.id, label: input.label })

    const abortController = new AbortController()
    this.pendingPromises.set(taskRun.id, {
      abort: () => abortController.abort(),
      scope,
      label: input.label,
      startedAt: Date.now(),
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })

    await this.executeInBackground(scope, taskRun.id, input, abortController.signal)

    return store.getTaskRun(taskRun.id)!
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = store.getTaskRun(taskId)
    if (!task) return false
    if (task.status !== 'pending' && task.status !== 'running') return false

    const pending = this.pendingPromises.get(taskId)
    if (pending) {
      pending.abort()
      this.pendingPromises.delete(taskId)
    }

    store.updateTaskRun(taskId, {
      status: 'cancelled',
      finishedAt: Date.now()
    })

    void emit('task:cancelled', {
      scope: task.scope,
      taskId,
      label: task.label
    })

    log.info('Task cancelled:', taskId)
    return true
  }

  getStatus(taskId: string): TaskRun | null {
    return store.getTaskRun(taskId)
  }

  list(scope: string, options?: { status?: TaskRunStatus; parentSessionId?: string; limit?: number }): TaskRun[] {
    return store.listTaskRuns(scope, options?.status, {
      parentSessionId: options?.parentSessionId,
      limit: options?.limit
    })
  }

  shutdown(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    for (const [, entry] of this.pendingPromises) {
      entry.abort()
    }
    this.pendingPromises.clear()
  }

  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => this.runWatchdog(), WATCHDOG_INTERVAL_MS)
    if (this.watchdogTimer.unref) this.watchdogTimer.unref()
  }

  /**
   * Watchdog 巡检：强制超时处理运行时间超过 timeoutMs * TIMEOUT_SAFETY_FACTOR 的任务。
   * 防止 BG Session promise 永远不 resolve 导致的无限等待。
   */
  private runWatchdog(): void {
    const now = Date.now()
    for (const [taskId, entry] of this.pendingPromises) {
      const maxDuration = entry.timeoutMs * TIMEOUT_SAFETY_FACTOR
      const elapsed = now - entry.startedAt
      if (elapsed <= maxDuration) continue

      log.warn('Watchdog: force-timing out task %s (elapsed %dms > max %dms)', taskId, elapsed, maxDuration)

      entry.abort()
      this.pendingPromises.delete(taskId)

      store.updateTaskRun(taskId, {
        status: 'timeout',
        error: `Watchdog timeout: task exceeded ${Math.round(maxDuration / 1000)}s`,
        finishedAt: now,
        durationMs: elapsed
      })

      void emit('task:failed', {
        scope: entry.scope,
        taskId,
        label: entry.label,
        error: `Watchdog timeout after ${Math.round(elapsed / 1000)}s`
      })
    }
  }

  private async executeInBackground(
    scope: string,
    taskId: string,
    input: TaskTriggerInput,
    signal: AbortSignal
  ): Promise<void> {
    const startedAt = Date.now()
    try {
      const execInput: StepExecutionInput = {
        prompt: input.prompt,
        context: input.context,
        systemInstructions: input.systemInstructions,
        expectedOutputFormat: input.expectedOutputFormat,
        model: input.model,
        timeoutMs: input.timeoutMs,
        label: input.label ?? 'task',
        workspaceDir: input.workspaceDir,
        source: 'task',
        sourceId: taskId
      }

      const result = await this.executor.execute(scope, execInput, signal)

      if (signal.aborted) {
        this.handleAbortedTask(taskId, scope, input.label, startedAt)
        return
      }

      const finishedAt = Date.now()
      const status: TaskRunStatus =
        result.status === 'success' ? 'completed'
        : result.status === 'timeout' ? 'timeout'
        : result.status === 'cancelled' ? 'cancelled'
        : result.status === 'failed' ? 'failed'
        : 'completed'

      store.updateTaskRun(taskId, {
        status,
        sessionId: result.sessionId,
        output: result.output,
        structuredData: result.structuredData,
        artifacts: result.artifacts,
        finishedAt,
        durationMs: result.durationMs || (finishedAt - startedAt)
      })

      if (status === 'completed') {
        void emit('task:completed', {
          scope,
          taskId,
          label: input.label,
          durationMs: result.durationMs
        })
      } else if (status === 'cancelled') {
        void emit('task:cancelled', { scope, taskId, label: input.label })
      } else {
        void emit('task:failed', {
          scope,
          taskId,
          label: input.label,
          error: `Task ended with status: ${result.status}`
        })
      }

      log.info('Task completed:', taskId, 'status:', status, 'duration:', result.durationMs, 'ms')
    } catch (err) {
      if (signal.aborted) {
        this.handleAbortedTask(taskId, scope, input.label, startedAt)
        return
      }

      const finishedAt = Date.now()
      const errorMsg = err instanceof Error ? err.message : String(err)

      store.updateTaskRun(taskId, {
        status: 'failed',
        error: errorMsg,
        finishedAt,
        durationMs: finishedAt - startedAt
      })

      void emit('task:failed', {
        scope,
        taskId,
        label: input.label,
        error: errorMsg
      })

      log.error('Task failed:', taskId, errorMsg)
    } finally {
      this.pendingPromises.delete(taskId)
    }
  }

  /**
   * 当 abort signal 触发后，确保 TaskRun 不会停留在 running 状态。
   * 仅在当前记录仍为 running 时更新（避免覆盖 cancel 已设置的状态）。
   */
  private handleAbortedTask(taskId: string, scope: string, label: string | undefined, startedAt: number): void {
    const current = store.getTaskRun(taskId)
    if (current && current.status === 'running') {
      const now = Date.now()
      store.updateTaskRun(taskId, {
        status: 'cancelled',
        finishedAt: now,
        durationMs: now - startedAt
      })
      void emit('task:cancelled', { scope, taskId, label })
    }
  }
}

// ─── 单例 ───

let _taskRunner: TaskRunner | null = null

export function initTaskRunner(executor: IStepExecutor): TaskRunner {
  if (_taskRunner) _taskRunner.shutdown()
  _taskRunner = new TaskRunner(executor)
  log.info('TaskRunner initialized')
  return _taskRunner
}

export function getTaskRunner(): TaskRunner {
  if (!_taskRunner) throw new Error('TaskRunner not initialized')
  return _taskRunner
}

export function shutdownTaskRunner(): void {
  if (_taskRunner) {
    _taskRunner.shutdown()
    _taskRunner = null
  }
}
