/**
 * integration.test.ts — 多模块集成测试
 *
 * 覆盖：
 * - parser → runner → store 全链路（YAML 输入 → 执行 → 持久化）
 * - register → run by name（注册工作流 → 按名称运行）
 * - 完整 approve 流程（run → paused → register def → resume → completed）
 * - 多工作流并发运行（scope 隔离）
 * - transform 链路（agent → transform → agent 三步管线）
 * - 条件 + approve + linkedActions 组合场景
 * - run + cancel + re-query 状态一致性
 * - prune 旧数据
 * - 大工作流（10 步）
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

const _integTmpDir = path.join(
  os.tmpdir(),
  `wf-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`
)
fs.mkdirSync(_integTmpDir, { recursive: true })

afterAll(() => {
  try {
    fs.rmSync(_integTmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

vi.mock('../PathProviderCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../PathProviderCore')>()
  return {
    ...actual,
    getDataDir: () => _integTmpDir,
    ensureDataDir: () => fs.mkdirSync(_integTmpDir, { recursive: true })
  }
})

const _integScopeRoots = new Map<string, string>()

vi.mock('../ScopeStore', () => ({
  scopeStore: {
    getScopeRootPath: (scope: string) => {
      if (!_integScopeRoots.has(scope)) {
        const root = path.join(_integTmpDir, 'scopes', scope)
        fs.mkdirSync(root, { recursive: true })
        _integScopeRoots.set(scope, root)
      }
      return _integScopeRoots.get(scope)!
    },
    getAllScopes: () => [..._integScopeRoots.keys()],
    getScopeData: () => ({ agentSessions: [] })
  }
}))

vi.mock('./linkedActionExecutor', () => ({
  executeLinkedActions: vi.fn().mockResolvedValue(undefined)
}))

import { emit } from '../eventBus/eventBus'
import { parseWorkflowDef, serializeWorkflowDef } from './parser'
import { WorkflowRunner } from './runner'
import * as store from './resumeStore'
import * as defStore from './workflowDefStore'
import type { IStepExecutor, StepExecutionInput, StepExecutionOutput } from './types'

const mockEmit = emit as ReturnType<typeof vi.fn>

function clearAllData(): void {
  const runs = store.listRuns(undefined, undefined, 9999)
  for (const r of runs) store.deleteRun(r.id)
}

function okExecutor(): IStepExecutor {
  let counter = 0
  return {
    execute: vi.fn(
      async (_s: string, input: StepExecutionInput): Promise<StepExecutionOutput> => ({
        sessionId: `sess-${++counter}`,
        status: 'success',
        output: `result-${counter}: ${input.prompt?.slice(0, 30)}`,
        durationMs: 50 + counter * 10
      })
    )
  }
}

describe('Parser → Runner → Store 全链路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('YAML 定义解析 → 执行 → 持久化完整流程', async () => {
    const yaml = `
name: data-pipeline
description: 数据处理管线
steps:
  - id: collect
    type: agent
    prompt: "收集数据"
  - id: transform
    type: transform
    input: "$collect.output"
    transform: "data"
  - id: report
    type: agent
    prompt: "生成报告"
    input: "$transform.output"
`
    const def = parseWorkflowDef(yaml)
    expect(def.name).toBe('data-pipeline')
    expect(def.steps).toHaveLength(3)

    const runner = new WorkflowRunner(okExecutor())
    const result = await runner.runWorkflow('default', def)

    expect(result.status).toBe('completed')

    const run = store.getRunById(result.runId)
    expect(run!.workflowName).toBe('data-pipeline')
    expect(run!.status).toBe('completed')
    expect(Object.keys(run!.stepResults)).toHaveLength(3)
    expect(run!.stepResults.collect.status).toBe('completed')
    expect(run!.stepResults.transform.status).toBe('completed')
    expect(run!.stepResults.report.status).toBe('completed')
  })
})

describe('Register → Run by Name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('注册工作流后按名称运行', async () => {
    const yaml = `
name: registered-wf
steps:
  - id: s1
    type: agent
    prompt: "执行任务"
`
    const def = parseWorkflowDef(yaml)
    defStore.registerDef('registered-wf', 'default', yaml, def.description)

    const defRecord = defStore.getDefByName('registered-wf', 'default')
    expect(defRecord).not.toBeNull()
    expect(defRecord!.yamlContent).toBe(yaml)

    const loadedDef = parseWorkflowDef(defRecord!.yamlContent)
    const runner = new WorkflowRunner(okExecutor())
    const result = await runner.runWorkflow('default', loadedDef)

    expect(result.status).toBe('completed')
  })

  it('更新注册后运行应使用新版本', async () => {
    const yamlV1 = `name: updatable\nsteps:\n  - id: s1\n    type: agent\n    prompt: "v1"`
    const yamlV2 = `name: updatable\nsteps:\n  - id: s1\n    type: agent\n    prompt: "v2"\n  - id: s2\n    type: agent\n    prompt: "extra"`

    defStore.registerDef('updatable', 'default', yamlV1)
    defStore.registerDef('updatable', 'default', yamlV2)

    const defRecord = defStore.getDefByName('updatable', 'default')!
    const def = parseWorkflowDef(defRecord.yamlContent)
    expect(def.steps).toHaveLength(2)
  })
})

describe('完整 Approve 流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('run → paused → resume(approved) → completed', async () => {
    const yaml = `
name: approve-pipeline
steps:
  - id: draft
    type: agent
    prompt: "起草文章"
  - id: review
    type: approve
    approvePrompt: "是否发布?"
  - id: publish
    type: agent
    prompt: "发布"
`
    const def = parseWorkflowDef(yaml)
    defStore.registerDef('approve-pipeline', 'default', yaml)

    const runner = new WorkflowRunner(okExecutor())
    const r1 = await runner.runWorkflow('default', def)

    expect(r1.status).toBe('paused')
    expect(r1.approvePrompt).toBe('是否发布?')

    const runBefore = store.getRunById(r1.runId)!
    expect(runBefore.status).toBe('paused')
    expect(runBefore.stepResults.draft.status).toBe('completed')
    expect(runBefore.resumeToken).toBeTruthy()

    const r2 = await runner.resumeWorkflow(r1.resumeToken!, true)
    expect(r2.status).toBe('completed')

    const runAfter = store.getRunById(r1.runId)!
    expect(runAfter.status).toBe('completed')
    expect(runAfter.stepResults.review.approved).toBe(true)
    expect(runAfter.stepResults.review.status).toBe('completed')
    expect(runAfter.stepResults.publish.status).toBe('completed')

    const events = mockEmit.mock.calls.map((c) => c[0])
    expect(events).toContain('workflow:started')
    expect(events).toContain('workflow:paused')
    expect(events).toContain('workflow:completed')
  })

  it('run → paused → resume(rejected) → completed (approve step approved=false)', async () => {
    const yaml = `
name: reject-test
steps:
  - id: check
    type: approve
    approvePrompt: "OK?"
  - id: after
    type: agent
    prompt: "post"
`
    defStore.registerDef('reject-test', 'default', yaml)
    const def = parseWorkflowDef(yaml)

    const runner = new WorkflowRunner(okExecutor())
    const r1 = await runner.runWorkflow('default', def)
    expect(r1.status).toBe('paused')

    const r2 = await runner.resumeWorkflow(r1.resumeToken!, false)
    expect(r2.status).toBe('completed')

    const run = store.getRunById(r1.runId)!
    expect(run.stepResults.check.approved).toBe(false)
  })
})

describe('多工作流并发 + Scope 隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('不同 scope 的运行记录应隔离', async () => {
    const def = parseWorkflowDef(
      `name: multi-scope\nsteps:\n  - id: s1\n    type: agent\n    prompt: "go"`
    )
    const runner = new WorkflowRunner(okExecutor())

    await runner.runWorkflow('scope-a', def)
    await runner.runWorkflow('scope-a', def)
    await runner.runWorkflow('scope-b', def)

    expect(store.listRuns('scope-a')).toHaveLength(2)
    expect(store.listRuns('scope-b')).toHaveLength(1)
    expect(store.listRuns()).toHaveLength(3)
  })

  it('并发执行两个工作流应各自独立', async () => {
    const def = parseWorkflowDef(
      `name: concurrent\nsteps:\n  - id: s1\n    type: agent\n    prompt: "go"`
    )
    const runner = new WorkflowRunner(okExecutor())

    const [r1, r2] = await Promise.all([
      runner.runWorkflow('default', def),
      runner.runWorkflow('default', def)
    ])

    expect(r1.status).toBe('completed')
    expect(r2.status).toBe('completed')
    expect(r1.runId).not.toBe(r2.runId)
  })
})

describe('Cancel + 状态查询', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('cancel 后 store 状态应为 cancelled', async () => {
    const yaml = `name: cancel-test\nsteps:\n  - id: s1\n    type: approve\n    approvePrompt: "go?"`
    const def = parseWorkflowDef(yaml)
    const runner = new WorkflowRunner(okExecutor())

    const r = await runner.runWorkflow('default', def)
    expect(r.status).toBe('paused')

    runner.cancelWorkflow(r.runId)
    const run = store.getRunById(r.runId)
    expect(run!.status).toBe('cancelled')
  })
})

describe('大工作流（10 步）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('应成功执行 10 步 agent 管线', async () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      id: `step_${i}`,
      type: 'agent' as const,
      prompt: `执行步骤 ${i}`,
      ...(i > 0 ? { input: `$step_${i - 1}.output` } : {})
    }))

    const def = { name: 'big-pipeline', steps }
    const runner = new WorkflowRunner(okExecutor())
    const result = await runner.runWorkflow('default', def)

    expect(result.status).toBe('completed')

    const run = store.getRunById(result.runId)!
    expect(Object.keys(run.stepResults)).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(run.stepResults[`step_${i}`].status).toBe('completed')
    }
  })
})

describe('Prune 旧数据', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.initResumeStore()
    clearAllData()
  })
  afterEach(() => store.closeResumeStore())

  it('prune 应清理已完成的旧 run 而保留活跃的', async () => {
    const def = parseWorkflowDef(
      `name: prune-test\nsteps:\n  - id: s1\n    type: agent\n    prompt: "x"`
    )
    const runner = new WorkflowRunner(okExecutor())

    await runner.runWorkflow('default', def)

    const defApprove = parseWorkflowDef(
      `name: prune-active\nsteps:\n  - id: s1\n    type: approve\n    approvePrompt: "x"`
    )
    const paused = await runner.runWorkflow('default', defApprove)

    const pruned = store.pruneRuns(0)
    expect(pruned).toBe(1)

    expect(store.listRuns()).toHaveLength(1)
    expect(store.listRuns()[0].status).toBe('paused')
  })
})

describe('Serialize round-trip 集成', () => {
  it('parse → serialize → parse 应保持等价', () => {
    const yaml = `
name: roundtrip
description: "test"
steps:
  - id: a
    type: agent
    prompt: "hello"
    model: "gpt-4o"
    timeoutMs: 60000
  - id: b
    type: approve
    approvePrompt: "ok?"
  - id: c
    type: transform
    input: "$a.output"
    transform: "summary"
    condition: "$b.approved"
triggers:
  - type: cron
    filter:
      name: daily
`
    const def1 = parseWorkflowDef(yaml)
    const serialized = serializeWorkflowDef(def1)
    const def2 = parseWorkflowDef(serialized)

    expect(def2.name).toBe(def1.name)
    expect(def2.description).toBe(def1.description)
    expect(def2.steps).toHaveLength(def1.steps.length)
    expect(def2.steps[0].model).toBe('gpt-4o')
    expect(def2.steps[0].timeoutMs).toBe(60000)
    expect(def2.steps[2].condition).toBe('$b.approved')
    expect(def2.triggers).toHaveLength(1)
  })
})
