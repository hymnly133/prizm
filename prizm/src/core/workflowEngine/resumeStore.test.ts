/**
 * resumeStore.test.ts — 工作流 SQLite 存储层
 *
 * 覆盖：
 * - init / close
 * - workflow_runs CRUD（create、getById、list、updateStatus、updateStep、getByResumeToken、delete、prune）
 * - task_runs CRUD
 * - scope 隔离
 * - 边界值（空字符串、大 JSON、不存在的 ID）
 * - stale recovery
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

let _resumeStoreTmpDir: string

vi.mock('../PathProviderCore', () => {
  _resumeStoreTmpDir = path.join(os.tmpdir(), `wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(_resumeStoreTmpDir, { recursive: true })
  return {
    getDataDir: () => _resumeStoreTmpDir,
    ensureDataDir: () => fs.mkdirSync(_resumeStoreTmpDir, { recursive: true })
  }
})

afterAll(() => {
  try {
    if (_resumeStoreTmpDir) fs.rmSync(_resumeStoreTmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

import * as store from './resumeStore'

function clearAllData(): void {
  const runs = store.listRuns(undefined, undefined, 9999)
  for (const r of runs) store.deleteRun(r.id)
}

describe('resumeStore — WorkflowRun', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllData()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('createRun 应创建并返回完整记录', () => {
    const run = store.createRun('wf-test', 'default')
    expect(run.id).toBeTruthy()
    expect(run.workflowName).toBe('wf-test')
    expect(run.scope).toBe('default')
    expect(run.status).toBe('pending')
    expect(run.currentStepIndex).toBe(0)
    expect(run.stepResults).toEqual({})
    expect(run.triggerType).toBe('manual')
    expect(run.createdAt).toBeGreaterThan(0)
    expect(run.updatedAt).toBeGreaterThan(0)
  })

  it('createRun 应保存 options（args, triggerType, linkedIds）', () => {
    const run = store.createRun('wf-test', 'scope1', {
      args: { key: 'value', num: 42 },
      triggerType: 'cron',
      linkedScheduleId: 'sched-1',
      linkedTodoId: 'todo-1'
    })
    expect(run.args).toEqual({ key: 'value', num: 42 })
    expect(run.triggerType).toBe('cron')
    expect(run.linkedScheduleId).toBe('sched-1')
    expect(run.linkedTodoId).toBe('todo-1')
  })

  it('getRunById 应返回已创建的记录', () => {
    const run = store.createRun('wf', 'default')
    const loaded = store.getRunById(run.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(run.id)
    expect(loaded!.workflowName).toBe('wf')
  })

  it('getRunById 不存在的 ID 应返回 null', () => {
    expect(store.getRunById('nonexistent')).toBeNull()
  })

  it('listRuns 应按 scope 和 status 过滤', () => {
    store.createRun('wf1', 'scope-a')
    store.createRun('wf2', 'scope-a')
    store.createRun('wf3', 'scope-b')

    expect(store.listRuns('scope-a')).toHaveLength(2)
    expect(store.listRuns('scope-b')).toHaveLength(1)
    expect(store.listRuns()).toHaveLength(3)

    store.updateRunStatus(store.listRuns('scope-a')[0].id, 'running')
    expect(store.listRuns('scope-a', 'running')).toHaveLength(1)
    expect(store.listRuns('scope-a', 'pending')).toHaveLength(1)
  })

  it('listRuns 应支持 limit 和 offset', () => {
    for (let i = 0; i < 10; i++) store.createRun(`wf-${i}`, 'default')
    expect(store.listRuns(undefined, undefined, 5)).toHaveLength(5)
    expect(store.listRuns(undefined, undefined, 5, 8)).toHaveLength(2)
  })

  it('updateRunStatus 应更新状态和错误信息', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'failed', '超时了')
    const loaded = store.getRunById(run.id)
    expect(loaded!.status).toBe('failed')
    expect(loaded!.error).toBe('超时了')
  })

  it('updateRunStep 应更新 stepResults 和 resumeToken', () => {
    const run = store.createRun('wf', 'default')
    const results = {
      step1: { stepId: 'step1', status: 'completed' as const, output: 'hello' }
    }
    store.updateRunStep(run.id, 1, results, 'token-abc')
    const loaded = store.getRunById(run.id)
    expect(loaded!.currentStepIndex).toBe(1)
    expect(loaded!.stepResults.step1.output).toBe('hello')
    expect(loaded!.resumeToken).toBe('token-abc')
  })

  it('getRunByResumeToken 应正确查找', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStep(run.id, 0, {}, 'unique-token')
    const found = store.getRunByResumeToken('unique-token')
    expect(found).not.toBeNull()
    expect(found!.id).toBe(run.id)
    expect(store.getRunByResumeToken('bad-token')).toBeNull()
  })

  it('deleteRun 应删除记录', () => {
    const run = store.createRun('wf', 'default')
    expect(store.deleteRun(run.id)).toBe(true)
    expect(store.getRunById(run.id)).toBeNull()
    expect(store.deleteRun('nonexistent')).toBe(false)
  })

  it('pruneRuns 应删除过期的终态记录', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'completed')
    expect(store.pruneRuns(0)).toBe(1)
    expect(store.getRunById(run.id)).toBeNull()
  })

  it('pruneRuns 不应删除活跃记录', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'running')
    expect(store.pruneRuns(0)).toBe(0)
    expect(store.getRunById(run.id)).not.toBeNull()
  })

  it('应正确序列化/反序列化复杂 args', () => {
    const complexArgs = {
      nested: { deep: { value: [1, 2, 3] } },
      unicode: '中文测试',
      empty: '',
      bool: true,
      nullVal: null
    }
    const run = store.createRun('wf', 'default', { args: complexArgs })
    const loaded = store.getRunById(run.id)
    expect(loaded!.args).toEqual(complexArgs)
  })

  it('应正确序列化/反序列化复杂 stepResults', () => {
    const run = store.createRun('wf', 'default')
    const results = {
      s1: { stepId: 's1', status: 'completed' as const, output: '{"key":"value"}', sessionId: 'sess-1', durationMs: 1500 },
      s2: { stepId: 's2', status: 'failed' as const, error: '错误信息' },
      s3: { stepId: 's3', status: 'skipped' as const }
    }
    store.updateRunStep(run.id, 2, results)
    const loaded = store.getRunById(run.id)
    expect(loaded!.stepResults.s1.output).toBe('{"key":"value"}')
    expect(loaded!.stepResults.s1.sessionId).toBe('sess-1')
    expect(loaded!.stepResults.s2.error).toBe('错误信息')
    expect(loaded!.stepResults.s3.status).toBe('skipped')
  })
})

// ─── TaskRun CRUD ───

function clearAllTaskRuns(): void {
  const tasks = store.listTaskRuns(undefined, undefined)
  for (const t of tasks) store.deleteTaskRun(t.id)
}

describe('resumeStore — TaskRun', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllTaskRuns()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('createTaskRun 应创建记录并返回完整 TaskRun', () => {
    const task = store.createTaskRun('default', { prompt: '测试任务' })
    expect(task.id).toBeTruthy()
    expect(task.scope).toBe('default')
    expect(task.status).toBe('pending')
    expect(task.input.prompt).toBe('测试任务')
    expect(task.triggerType).toBe('manual')
    expect(task.createdAt).toBeGreaterThan(0)
  })

  it('createTaskRun options（label, triggerType, parentSessionId）正确写入', () => {
    const task = store.createTaskRun('default', { prompt: '任务' }, {
      label: '数据分析',
      triggerType: 'llm',
      parentSessionId: 'parent-sess-1'
    })
    expect(task.label).toBe('数据分析')
    expect(task.triggerType).toBe('llm')
    expect(task.parentSessionId).toBe('parent-sess-1')
  })

  it('getTaskRun 存在 → 返回 TaskRun', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    const loaded = store.getTaskRun(task.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(task.id)
    expect(loaded!.input.prompt).toBe('任务')
  })

  it('getTaskRun 不存在 → 返回 null', () => {
    expect(store.getTaskRun('nonexistent-id')).toBeNull()
  })

  it('listTaskRuns 按 scope 筛选', () => {
    store.createTaskRun('scope-a', { prompt: '任务A1' })
    store.createTaskRun('scope-a', { prompt: '任务A2' })
    store.createTaskRun('scope-b', { prompt: '任务B1' })

    expect(store.listTaskRuns('scope-a')).toHaveLength(2)
    expect(store.listTaskRuns('scope-b')).toHaveLength(1)
    expect(store.listTaskRuns()).toHaveLength(3)
  })

  it('listTaskRuns 按 status 筛选', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    store.createTaskRun('default', { prompt: '任务2' })
    store.updateTaskRun(t1.id, { status: 'running' })

    expect(store.listTaskRuns('default', 'running')).toHaveLength(1)
    expect(store.listTaskRuns('default', 'pending')).toHaveLength(1)
  })

  it('listTaskRuns 按 parentSessionId 筛选', () => {
    store.createTaskRun('default', { prompt: '任务1' }, { parentSessionId: 'parent-1' })
    store.createTaskRun('default', { prompt: '任务2' }, { parentSessionId: 'parent-2' })
    store.createTaskRun('default', { prompt: '任务3' }, { parentSessionId: 'parent-1' })

    expect(store.listTaskRuns('default', undefined, { parentSessionId: 'parent-1' })).toHaveLength(2)
    expect(store.listTaskRuns('default', undefined, { parentSessionId: 'parent-2' })).toHaveLength(1)
  })

  it('listTaskRuns limit + offset 分页', () => {
    for (let i = 0; i < 10; i++) store.createTaskRun('default', { prompt: `任务${i}` })
    expect(store.listTaskRuns('default', undefined, { limit: 5 })).toHaveLength(5)
    expect(store.listTaskRuns('default', undefined, { limit: 5, offset: 8 })).toHaveLength(2)
  })

  it('updateTaskRun 更新单个字段（status）', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, { status: 'running' })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.status).toBe('running')
  })

  it('updateTaskRun 更新多个字段', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, {
      status: 'completed',
      output: '执行结果',
      sessionId: 'bg-sess-1',
      durationMs: 1500,
      finishedAt: Date.now()
    })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.status).toBe('completed')
    expect(loaded.output).toBe('执行结果')
    expect(loaded.sessionId).toBe('bg-sess-1')
    expect(loaded.durationMs).toBe(1500)
    expect(loaded.finishedAt).toBeGreaterThan(0)
  })

  it('updateTaskRun 更新 artifacts_json 序列化/反序列化', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, {
      artifacts: ['report.md', 'data.csv', 'chart.png']
    })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.artifacts).toEqual(['report.md', 'data.csv', 'chart.png'])
  })

  it('updateTaskRun 更新 structuredData', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, {
      structuredData: '{"sentiment":"positive","score":0.95}'
    })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.structuredData).toBe('{"sentiment":"positive","score":0.95}')
  })

  it('updateTaskRun 空 update → 无操作', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, {})
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.status).toBe('pending')
  })

  it('deleteTaskRun 存在 → 返回 true', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    expect(store.deleteTaskRun(task.id)).toBe(true)
    expect(store.getTaskRun(task.id)).toBeNull()
  })

  it('deleteTaskRun 不存在 → 返回 false', () => {
    expect(store.deleteTaskRun('nonexistent')).toBe(false)
  })

  it('pruneTaskRuns 删除过期终态记录', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, { status: 'completed' })
    expect(store.pruneTaskRuns(0)).toBe(1)
    expect(store.getTaskRun(task.id)).toBeNull()
  })

  it('pruneTaskRuns 不删除 running/pending 记录', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    const t2 = store.createTaskRun('default', { prompt: '任务2' })
    store.updateTaskRun(t1.id, { status: 'running' })
    expect(store.pruneTaskRuns(0)).toBe(0)
    expect(store.getTaskRun(t1.id)).not.toBeNull()
    expect(store.getTaskRun(t2.id)).not.toBeNull()
  })

  it('复杂 input：嵌套 JSON context、中文 prompt', () => {
    const task = store.createTaskRun('default', {
      prompt: '分析中文数据报告',
      context: { nested: { deep: { value: [1, 2, 3] } }, unicode: '中文' }
    })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.input.prompt).toBe('分析中文数据报告')
    expect(loaded.input.context).toEqual({ nested: { deep: { value: [1, 2, 3] } }, unicode: '中文' })
  })

  it('scope 隔离：不同 scope 的 task 互不可见', () => {
    store.createTaskRun('scope-x', { prompt: '任务X' })
    store.createTaskRun('scope-y', { prompt: '任务Y' })

    const xTasks = store.listTaskRuns('scope-x')
    const yTasks = store.listTaskRuns('scope-y')

    expect(xTasks).toHaveLength(1)
    expect(xTasks[0].input.prompt).toBe('任务X')
    expect(yTasks).toHaveLength(1)
    expect(yTasks[0].input.prompt).toBe('任务Y')
  })

  it('updateTaskRun error 字段正确写入', () => {
    const task = store.createTaskRun('default', { prompt: '任务' })
    store.updateTaskRun(task.id, { status: 'failed', error: '连接超时错误' })
    const loaded = store.getTaskRun(task.id)!
    expect(loaded.error).toBe('连接超时错误')
  })

  it('pruneTaskRuns 删除 failed/cancelled/timeout 记录', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    const t2 = store.createTaskRun('default', { prompt: '任务2' })
    const t3 = store.createTaskRun('default', { prompt: '任务3' })
    store.updateTaskRun(t1.id, { status: 'failed' })
    store.updateTaskRun(t2.id, { status: 'cancelled' })
    store.updateTaskRun(t3.id, { status: 'timeout' })
    // retentionDays=-1 确保 cutoff 在未来，所有记录都过期
    expect(store.pruneTaskRuns(-1)).toBe(3)
  })

  it('listTaskRuns 返回结果数量正确', () => {
    store.createTaskRun('default', { prompt: '任务A' })
    store.createTaskRun('default', { prompt: '任务B' })
    const list = store.listTaskRuns('default')
    expect(list).toHaveLength(2)
    const prompts = list.map(t => t.input.prompt)
    expect(prompts).toContain('任务A')
    expect(prompts).toContain('任务B')
  })
})

// ─── Stale Recovery ───

describe('resumeStore — recoverStaleTaskRuns', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllTaskRuns()
    clearAllData()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('应将 running 状态的 TaskRun 标记为 failed', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    store.updateTaskRun(t1.id, { status: 'running' })

    const count = store.recoverStaleTaskRuns()
    expect(count).toBe(1)

    const loaded = store.getTaskRun(t1.id)!
    expect(loaded.status).toBe('failed')
    expect(loaded.error).toContain('server restart')
    expect(loaded.finishedAt).toBeGreaterThan(0)
  })

  it('应将 pending 状态的 TaskRun 标记为 failed', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })

    const count = store.recoverStaleTaskRuns()
    expect(count).toBe(1)

    const loaded = store.getTaskRun(t1.id)!
    expect(loaded.status).toBe('failed')
  })

  it('不影响已完成/已失败的记录', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    const t2 = store.createTaskRun('default', { prompt: '任务2' })
    store.updateTaskRun(t1.id, { status: 'completed' })
    store.updateTaskRun(t2.id, { status: 'failed', error: 'original error' })

    const count = store.recoverStaleTaskRuns()
    expect(count).toBe(0)

    expect(store.getTaskRun(t1.id)!.status).toBe('completed')
    expect(store.getTaskRun(t2.id)!.error).toBe('original error')
  })

  it('混合状态：仅处理 running/pending', () => {
    const t1 = store.createTaskRun('default', { prompt: '运行中' })
    const t2 = store.createTaskRun('default', { prompt: '已完成' })
    const t3 = store.createTaskRun('default', { prompt: '待处理' })
    store.updateTaskRun(t1.id, { status: 'running' })
    store.updateTaskRun(t2.id, { status: 'completed' })

    const count = store.recoverStaleTaskRuns()
    expect(count).toBe(2)

    expect(store.getTaskRun(t1.id)!.status).toBe('failed')
    expect(store.getTaskRun(t2.id)!.status).toBe('completed')
    expect(store.getTaskRun(t3.id)!.status).toBe('failed')
  })
})

describe('resumeStore — recoverStaleWorkflowRuns', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllData()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('应将 running 状态的 WorkflowRun 标记为 failed', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'running')

    const count = store.recoverStaleWorkflowRuns()
    expect(count).toBe(1)

    const loaded = store.getRunById(run.id)!
    expect(loaded.status).toBe('failed')
    expect(loaded.error).toContain('server restart')
  })

  it('不影响 paused 状态（可手动恢复）', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'paused')

    const count = store.recoverStaleWorkflowRuns()
    expect(count).toBe(0)

    expect(store.getRunById(run.id)!.status).toBe('paused')
  })

  it('不影响 completed/failed/cancelled 状态', () => {
    const r1 = store.createRun('wf1', 'default')
    const r2 = store.createRun('wf2', 'default')
    store.updateRunStatus(r1.id, 'completed')
    store.updateRunStatus(r2.id, 'cancelled')

    const count = store.recoverStaleWorkflowRuns()
    expect(count).toBe(0)
  })
})

describe('resumeStore — recoverStaleTaskRunsByAge', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllTaskRuns()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('maxAgeDays=-1 应恢复所有 running/pending 记录（cutoff 在未来）', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    store.updateTaskRun(t1.id, { status: 'running' })

    const count = store.recoverStaleTaskRunsByAge(-1)
    expect(count).toBe(1)
    expect(store.getTaskRun(t1.id)!.status).toBe('failed')
    expect(store.getTaskRun(t1.id)!.error).toContain('max age')
  })

  it('maxAgeDays 很大时不恢复新建的记录', () => {
    const t1 = store.createTaskRun('default', { prompt: '任务1' })
    store.updateTaskRun(t1.id, { status: 'running' })

    const count = store.recoverStaleTaskRunsByAge(999)
    expect(count).toBe(0)
    expect(store.getTaskRun(t1.id)!.status).toBe('running')
  })
})

describe('resumeStore — recoverStaleWorkflowRunsByAge', () => {
  beforeEach(() => {
    store.initResumeStore()
    clearAllData()
  })

  afterEach(() => {
    store.closeResumeStore()
  })

  it('maxAgeDays=-1 应恢复所有 running/pending 记录（cutoff 在未来）', () => {
    const run = store.createRun('wf', 'default')
    store.updateRunStatus(run.id, 'running')

    const count = store.recoverStaleWorkflowRunsByAge(-1)
    expect(count).toBe(1)
    expect(store.getRunById(run.id)!.status).toBe('failed')
    expect(store.getRunById(run.id)!.error).toContain('max age')
  })
})
