/**
 * task-integration.test.ts — TaskRunner + resumeStore 集成测试
 *
 * 使用真实 SQLite DB（临时目录），mock IStepExecutor。
 * 验证完整数据链路：创建 → 执行 → 持久化 → 查询。
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const _tmpDir = path.join(os.tmpdir(), `task-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`)
fs.mkdirSync(_tmpDir, { recursive: true })

afterAll(() => {
  try {
    fs.rmSync(_tmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

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

function clearAllTaskRuns(): void {
  const tasks = store.listTaskRuns(undefined, undefined)
  for (const t of tasks) store.deleteTaskRun(t.id)
}

describe('Task Integration Tests', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllTaskRuns()
    vi.clearAllMocks()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('完整链路：trigger → executor 成功 → task_runs 记录完整', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-integ-1',
        status: 'success' as const,
        output: '集成测试结果',
        structuredData: '{"type":"analysis"}',
        artifacts: ['report.md'],
        durationMs: 250
      }))
    }
    const runner = new TaskRunner(exec)

    const { taskId } = await runner.trigger('test-scope', {
      prompt: '集成测试任务',
      label: '集成标签',
      context: { env: 'test' }
    }, {
      triggerType: 'llm',
      parentSessionId: 'parent-integ'
    })

    await vi.waitFor(() => {
      const t = store.getTaskRun(taskId)
      expect(t!.status).toBe('completed')
    })

    const task = store.getTaskRun(taskId)!
    expect(task.scope).toBe('test-scope')
    expect(task.sessionId).toBe('bg-integ-1')
    expect(task.output).toBe('集成测试结果')
    expect(task.structuredData).toBe('{"type":"analysis"}')
    expect(task.artifacts).toEqual(['report.md'])
    expect(task.durationMs).toBe(250)
    expect(task.label).toBe('集成标签')
    expect(task.triggerType).toBe('llm')
    expect(task.parentSessionId).toBe('parent-integ')
    expect(task.input.prompt).toBe('集成测试任务')
  })

  it('完整链路：trigger → executor 失败 → task_runs.error 正确', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-fail',
        status: 'failed' as const,
        output: '执行出错',
        durationMs: 50
      }))
    }
    const runner = new TaskRunner(exec)

    const { taskId } = await runner.trigger('default', { prompt: '失败任务' })

    await vi.waitFor(() => {
      const t = store.getTaskRun(taskId)
      expect(t!.status).toBe('failed')
    })
  })

  it('完整链路：trigger → executor timeout → status = timeout', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-timeout',
        status: 'timeout' as const,
        output: '',
        durationMs: 30000
      }))
    }
    const runner = new TaskRunner(exec)

    const { taskId } = await runner.trigger('default', { prompt: '超时任务' })

    await vi.waitFor(() => {
      const t = store.getTaskRun(taskId)
      expect(t!.status).toBe('timeout')
    })
  })

  it('异步 trigger → 立即查 status = running → 完成后查 status = completed', async () => {
    let resolveExec!: (v: StepExecutionOutput) => void
    const exec: IStepExecutor = {
      execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
    }
    const runner = new TaskRunner(exec)

    const { taskId } = await runner.trigger('default', { prompt: '延迟任务' })

    const runningTask = store.getTaskRun(taskId)!
    expect(runningTask.status).toBe('running')

    resolveExec({ sessionId: 'bg-delayed', status: 'success', output: '完成', durationMs: 100 })

    await vi.waitFor(() => {
      const t = store.getTaskRun(taskId)
      expect(t!.status).toBe('completed')
    })

    const completedTask = store.getTaskRun(taskId)!
    expect(completedTask.output).toBe('完成')
    expect(completedTask.sessionId).toBe('bg-delayed')
  })

  it('同步 triggerSync → 返回的 TaskRun 有 sessionId 和 output', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-sync-integ',
        status: 'success' as const,
        output: '同步集成结果',
        durationMs: 150
      }))
    }
    const runner = new TaskRunner(exec)

    const result = await runner.triggerSync('default', { prompt: '同步集成' })

    expect(result.status).toBe('completed')
    expect(result.sessionId).toBe('bg-sync-integ')
    expect(result.output).toBe('同步集成结果')

    const dbTask = store.getTaskRun(result.id)!
    expect(dbTask.output).toBe('同步集成结果')
  })

  it('cancel 正在 running 的 task → task_runs.status = cancelled', async () => {
    let resolveExec!: (v: StepExecutionOutput) => void
    const exec: IStepExecutor = {
      execute: vi.fn(() => new Promise<StepExecutionOutput>((resolve) => { resolveExec = resolve }))
    }
    const runner = new TaskRunner(exec)

    const { taskId } = await runner.trigger('default', { prompt: '待取消' })

    expect(store.getTaskRun(taskId)!.status).toBe('running')

    const cancelled = await runner.cancel(taskId)
    expect(cancelled).toBe(true)
    expect(store.getTaskRun(taskId)!.status).toBe('cancelled')

    resolveExec({ sessionId: 's', status: 'success', output: '', durationMs: 0 })
  })

  it('list 按 parentSessionId 正确关联', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-child',
        status: 'success' as const,
        output: '子任务结果',
        durationMs: 100
      }))
    }
    const runner = new TaskRunner(exec)

    await runner.trigger('default', { prompt: '子任务1' }, { parentSessionId: 'parent-A' })
    await runner.trigger('default', { prompt: '子任务2' }, { parentSessionId: 'parent-A' })
    await runner.trigger('default', { prompt: '子任务3' }, { parentSessionId: 'parent-B' })

    await vi.waitFor(() => {
      const all = runner.list('default')
      expect(all.filter(t => t.status === 'completed')).toHaveLength(3)
    })

    const parentAList = runner.list('default', { parentSessionId: 'parent-A' })
    expect(parentAList).toHaveLength(2)

    const parentBList = runner.list('default', { parentSessionId: 'parent-B' })
    expect(parentBList).toHaveLength(1)
  })

  it('pruneTaskRuns 配合 TaskRunner 流程', async () => {
    const exec: IStepExecutor = {
      execute: vi.fn(async () => ({
        sessionId: 'bg-prune',
        status: 'success' as const,
        output: '完成',
        durationMs: 50
      }))
    }
    const runner = new TaskRunner(exec)

    await runner.trigger('default', { prompt: '旧任务1' })
    await runner.trigger('default', { prompt: '旧任务2' })

    await vi.waitFor(() => {
      expect(runner.list('default', { status: 'completed' })).toHaveLength(2)
    })

    // retentionDays=-1 确保所有记录都过期
    const pruned = store.pruneTaskRuns(-1)
    expect(pruned).toBe(2)
    expect(runner.list('default')).toHaveLength(0)
  })
})
