/**
 * taskRunner.test.ts — TaskRunner 单元测试
 *
 * 覆盖：
 * - trigger（异步）: 正常流程、事件 emit、executor 成功/失败/超时/取消/异常
 * - triggerSync（同步）: 正常流程、失败返回
 * - cancel: 运行中/已完成/不存在
 * - getStatus: 存在/不存在
 * - list: scope/status/parentSessionId 筛选
 * - 元数据: triggerType/parentSessionId/label 传递
 * - 边界: 空 prompt、超长 output、structuredData、artifacts 传递
 * - signal 传递: abort signal 透传到 executor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const _tmpDir = path.join(os.tmpdir(), `task-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
fs.mkdirSync(_tmpDir, { recursive: true })

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../PathProviderCore', () => {
  return {
    getDataDir: () => _tmpDir,
    ensureDataDir: () => fs.mkdirSync(_tmpDir, { recursive: true })
  }
})

import { TaskRunner } from './taskRunner'
import type { IStepExecutor, StepExecutionInput, StepExecutionOutput } from './types'
import * as store from './resumeStore'
import { emit } from '../eventBus/eventBus'

const mockedEmit = emit as ReturnType<typeof vi.fn>

function createMockExecutor(
  resolveWith?: Partial<StepExecutionOutput>,
  rejectWith?: Error
): IStepExecutor & { calls: Array<{ scope: string; input: StepExecutionInput; signal?: AbortSignal }> } {
  const calls: Array<{ scope: string; input: StepExecutionInput; signal?: AbortSignal }> = []
  return {
    calls,
    execute: vi.fn(async (scope: string, input: StepExecutionInput, signal?: AbortSignal) => {
      calls.push({ scope, input, signal })
      if (rejectWith) throw rejectWith
      return {
        sessionId: 'bg-sess-1',
        status: 'success' as const,
        output: '执行完成',
        durationMs: 100,
        ...resolveWith
      }
    })
  }
}

function clearAllTaskRuns(): void {
  const tasks = store.listTaskRuns(undefined, undefined)
  for (const t of tasks) store.deleteTaskRun(t.id)
}

describe('TaskRunner', () => {
  let runner: TaskRunner

  beforeEach(() => {
    store.initResumeStore()
    clearAllTaskRuns()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (runner) runner.shutdown()
    store.closeResumeStore()
  })

  // ─── trigger（异步）───

  describe('trigger', () => {
    it('正常触发：返回 taskId，task_runs 创建成功', async () => {
      let resolveExec!: (v: StepExecutionOutput) => void
      const slowExec: IStepExecutor = {
        execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
      }
      runner = new TaskRunner(slowExec)

      const { taskId } = await runner.trigger('default', { prompt: '分析数据' })

      expect(taskId).toBeTruthy()
      const task = store.getTaskRun(taskId)
      expect(task).not.toBeNull()
      expect(task!.status).toBe('running')

      resolveExec({ sessionId: 's', status: 'success', output: '', durationMs: 0 })
    })

    it('emit task:started 事件', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务', label: '测试标签' })

      expect(mockedEmit).toHaveBeenCalledWith('task:started', {
        scope: 'default',
        taskId,
        label: '测试标签'
      })
    })

    it('executor 成功 → task_runs 更新为 completed + sessionId + output + durationMs', async () => {
      const exec = createMockExecutor({
        sessionId: 'bg-abc',
        output: '分析结果',
        durationMs: 500
      })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '分析' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('completed')
      })

      const task = store.getTaskRun(taskId)!
      expect(task.sessionId).toBe('bg-abc')
      expect(task.output).toBe('分析结果')
      expect(task.durationMs).toBe(500)
    })

    it('executor 成功后 emit task:completed 事件', async () => {
      const exec = createMockExecutor({ durationMs: 200 })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务', label: '完成标签' })

      await vi.waitFor(() => {
        expect(mockedEmit).toHaveBeenCalledWith('task:completed', expect.objectContaining({
          scope: 'default',
          taskId,
          label: '完成标签'
        }))
      })
    })

    it('executor 失败 → task_runs 更新为 failed + error', async () => {
      const exec = createMockExecutor({ status: 'failed', output: '执行失败' })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '失败任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('failed')
      })
    })

    it('executor 失败后 emit task:failed 事件', async () => {
      const exec = createMockExecutor({ status: 'failed', output: '错误' })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务', label: '失败标签' })

      await vi.waitFor(() => {
        expect(mockedEmit).toHaveBeenCalledWith('task:failed', expect.objectContaining({
          scope: 'default',
          taskId,
          label: '失败标签'
        }))
      })
    })

    it('executor 抛异常 → task_runs 更新为 failed + errorMsg', async () => {
      const exec = createMockExecutor(undefined, new Error('连接超时'))
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '异常任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('failed')
      })

      const task = store.getTaskRun(taskId)!
      expect(task.error).toContain('连接超时')
    })

    it('executor 返回 timeout → task_runs 更新为 timeout', async () => {
      const exec = createMockExecutor({ status: 'timeout', output: '超时' })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '超时任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('timeout')
      })
    })

    it('executor 返回 cancelled → task_runs 更新为 cancelled', async () => {
      const exec = createMockExecutor({ status: 'cancelled', output: '已取消' })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '取消任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('cancelled')
      })
    })

    it('signal 应传递到 executor.execute', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务' })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].signal).toBeInstanceOf(AbortSignal)
    })
  })

  // ─── triggerSync（同步）───

  describe('triggerSync', () => {
    it('正常同步：返回完整 TaskRun', async () => {
      const exec = createMockExecutor({
        sessionId: 'bg-sync-1',
        output: '同步结果',
        durationMs: 300
      })
      runner = new TaskRunner(exec)

      const result = await runner.triggerSync('default', { prompt: '同步任务' })

      expect(result.id).toBeTruthy()
      expect(result.status).toBe('completed')
      expect(result.sessionId).toBe('bg-sync-1')
      expect(result.output).toBe('同步结果')
    })

    it('失败同步：返回 TaskRun.status = failed', async () => {
      const exec = createMockExecutor({ status: 'failed', output: '同步失败' })
      runner = new TaskRunner(exec)

      const result = await runner.triggerSync('default', { prompt: '失败同步' })

      expect(result.status).toBe('failed')
    })

    it('executor 抛异常时同步也正确处理', async () => {
      const exec = createMockExecutor(undefined, new Error('同步错误'))
      runner = new TaskRunner(exec)

      const result = await runner.triggerSync('default', { prompt: '异常同步' })

      expect(result.status).toBe('failed')
      expect(result.error).toContain('同步错误')
    })

    it('signal 应传递到 executor.execute（同步模式）', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.triggerSync('default', { prompt: '同步任务' })

      expect(exec.calls.length).toBe(1)
      expect(exec.calls[0].signal).toBeInstanceOf(AbortSignal)
    })
  })

  // ─── cancel ───

  describe('cancel', () => {
    it('取消运行中任务 → 返回 true，status 变为 cancelled', async () => {
      let resolveExec!: (v: StepExecutionOutput) => void
      const slowExec: IStepExecutor = {
        execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
      }
      runner = new TaskRunner(slowExec)

      const { taskId } = await runner.trigger('default', { prompt: '长任务' })

      const cancelled = await runner.cancel(taskId)
      expect(cancelled).toBe(true)

      const task = store.getTaskRun(taskId)!
      expect(task.status).toBe('cancelled')

      resolveExec({ sessionId: 's', status: 'success', output: '', durationMs: 0 })
    })

    it('取消已完成任务 → 返回 false', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '快任务' })

      await vi.waitFor(() => {
        expect(store.getTaskRun(taskId)!.status).toBe('completed')
      })

      const cancelled = await runner.cancel(taskId)
      expect(cancelled).toBe(false)
    })

    it('取消不存在任务 → 返回 false', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const cancelled = await runner.cancel('nonexistent-id')
      expect(cancelled).toBe(false)
    })
  })

  // ─── getStatus ───

  describe('getStatus', () => {
    it('存在 → 返回 TaskRun', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '查询任务' })
      const task = runner.getStatus(taskId)

      expect(task).not.toBeNull()
      expect(task!.id).toBe(taskId)
    })

    it('不存在 → 返回 null', () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      expect(runner.getStatus('nonexistent')).toBeNull()
    })
  })

  // ─── list ───

  describe('list', () => {
    it('按 scope 筛选', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('scope-a', { prompt: '任务A' })
      await runner.trigger('scope-b', { prompt: '任务B' })

      expect(runner.list('scope-a')).toHaveLength(1)
      expect(runner.list('scope-b')).toHaveLength(1)
    })

    it('按 status 筛选', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务1' })
      await runner.trigger('default', { prompt: '任务2' })

      await vi.waitFor(() => {
        const completed = runner.list('default', { status: 'completed' })
        expect(completed.length).toBeGreaterThanOrEqual(2)
      })
    })

    it('按 parentSessionId 筛选', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务A' }, { parentSessionId: 'parent-1' })
      await runner.trigger('default', { prompt: '任务B' }, { parentSessionId: 'parent-2' })

      const result = runner.list('default', { parentSessionId: 'parent-1' })
      expect(result).toHaveLength(1)
    })
  })

  // ─── 元数据 ───

  describe('元数据传递', () => {
    it('triggerType 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' }, { triggerType: 'llm' })
      const task = store.getTaskRun(taskId)!
      expect(task.triggerType).toBe('llm')
    })

    it('parentSessionId 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' }, { parentSessionId: 'parent-sess' })
      const task = store.getTaskRun(taskId)!
      expect(task.parentSessionId).toBe('parent-sess')
    })

    it('label 正确传递到 task_runs', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务', label: '数据分析' })
      const task = store.getTaskRun(taskId)!
      expect(task.label).toBe('数据分析')
    })

    it('label 正确传递到 executor input', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务', label: '自定义标签' })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.label).toBe('自定义标签')
    })

    it('无 label 时 executor 使用默认值 task', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务' })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.label).toBe('task')
    })

    it('triggerType 默认为 manual', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' })
      const task = store.getTaskRun(taskId)!
      expect(task.triggerType).toBe('manual')
    })
  })

  // ─── 边界 ───

  describe('边界情况', () => {
    it('空 prompt', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '' })
      expect(taskId).toBeTruthy()

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.prompt).toBe('')
    })

    it('超长 output', async () => {
      const longOutput = 'x'.repeat(100_000)
      const exec = createMockExecutor({ output: longOutput })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('completed')
      })

      const task = store.getTaskRun(taskId)!
      expect(task.output).toBe(longOutput)
    })

    it('structuredData 传递', async () => {
      const exec = createMockExecutor({
        structuredData: '{"sentiment":"positive","score":0.95}'
      })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('completed')
      })

      const task = store.getTaskRun(taskId)!
      expect(task.structuredData).toBe('{"sentiment":"positive","score":0.95}')
    })

    it('artifacts 传递（修复后验证）', async () => {
      const exec = createMockExecutor({
        artifacts: ['report.md', 'data.csv', 'chart.png']
      })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' })

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).toBe('completed')
      })

      const task = store.getTaskRun(taskId)!
      expect(task.artifacts).toEqual(['report.md', 'data.csv', 'chart.png'])
    })

    it('context 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      const ctx = { key: 'value', nested: { a: 1 } }
      await runner.trigger('default', { prompt: '任务', context: ctx })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.context).toEqual(ctx)
    })

    it('workspaceDir 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务', workspaceDir: '/tmp/workspace' })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.workspaceDir).toBe('/tmp/workspace')
    })

    it('model 和 timeoutMs 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务', model: 'gpt-4', timeoutMs: 60000 })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.model).toBe('gpt-4')
      expect(exec.calls[0].input.timeoutMs).toBe(60000)
    })

    it('systemInstructions 正确传递', async () => {
      const exec = createMockExecutor()
      runner = new TaskRunner(exec)

      await runner.trigger('default', { prompt: '任务', systemInstructions: '你是助手' })

      await vi.waitFor(() => {
        expect(exec.calls.length).toBe(1)
      })

      expect(exec.calls[0].input.systemInstructions).toBe('你是助手')
    })
  })

  // ─── cancel 事件 ───

  describe('cancel 事件', () => {
    it('cancel 应 emit task:cancelled 事件', async () => {
      let resolveExec!: (v: StepExecutionOutput) => void
      const slowExec: IStepExecutor = {
        execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
      }
      runner = new TaskRunner(slowExec)

      const { taskId } = await runner.trigger('default', { prompt: '长任务', label: '取消标签' })

      await runner.cancel(taskId)

      expect(mockedEmit).toHaveBeenCalledWith('task:cancelled', {
        scope: 'default',
        taskId,
        label: '取消标签'
      })

      resolveExec({ sessionId: 's', status: 'success', output: '', durationMs: 0 })
    })

    it('executor 返回 cancelled 状态 → emit task:cancelled', async () => {
      const exec = createMockExecutor({ status: 'cancelled', output: '已取消' })
      runner = new TaskRunner(exec)

      const { taskId } = await runner.trigger('default', { prompt: '取消任务', label: '标签' })

      await vi.waitFor(() => {
        expect(mockedEmit).toHaveBeenCalledWith('task:cancelled', expect.objectContaining({
          scope: 'default',
          taskId
        }))
      })
    })
  })

  // ─── abort 后状态保证 ───

  describe('abort 后状态保证', () => {
    it('signal abort 后 task 不应停留在 running 状态', async () => {
      let execSignal: AbortSignal | undefined
      const hangingExec: IStepExecutor = {
        execute: vi.fn(async (_scope, _input, signal) => {
          execSignal = signal
          return new Promise<StepExecutionOutput>((resolve) => {
            signal?.addEventListener('abort', () => {
              resolve({ sessionId: 's', status: 'cancelled', output: '', durationMs: 0 })
            })
          })
        })
      }
      runner = new TaskRunner(hangingExec)

      const { taskId } = await runner.trigger('default', { prompt: '任务' })

      await runner.cancel(taskId)

      await vi.waitFor(() => {
        const t = store.getTaskRun(taskId)
        expect(t!.status).not.toBe('running')
      })

      expect(execSignal?.aborted).toBe(true)
    })
  })

  // ─── shutdown ───

  describe('shutdown', () => {
    it('shutdown 应清理所有 pending 和 watchdog timer', async () => {
      let resolveExec!: (v: StepExecutionOutput) => void
      const slowExec: IStepExecutor = {
        execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
      }
      runner = new TaskRunner(slowExec)

      await runner.trigger('default', { prompt: '任务' })
      runner.shutdown()

      resolveExec({ sessionId: 's', status: 'success', output: '', durationMs: 0 })
    })
  })
})
