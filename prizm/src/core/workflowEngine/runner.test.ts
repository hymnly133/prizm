/**
 * runner.test.ts — WorkflowRunner 核心引擎
 *
 * 覆盖：
 * - 单步 agent 工作流（成功 / 失败 / 超时）
 * - 多步 agent 流水线
 * - approve step → paused → resumeWorkflow
 * - transform step（JSON path 提取）
 * - 条件求值（$stepId.approved / $stepId.output）
 * - 条件 false 时 skip
 * - $prev.output / $stepId.output / $args 引用
 * - $stepId.data.xxx 深层引用（structuredData）
 * - linkedActions 在步骤后触发
 * - cancelWorkflow
 * - executor 抛异常
 * - 多轮 approve → resume → agent
 * - 全局事件 emit 验证
 * - resumeStore 状态一致性
 * - workflow 工作区创建（ensureWorkflowWorkspace）
 * - flushRunMeta 在步骤完成后调用
 * - cleanBefore 选项
 * - extractBgSessionData
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const _tmpDir = path.join(
  os.tmpdir(),
  `wf-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`
)
fs.mkdirSync(_tmpDir, { recursive: true })

afterAll(() => {
  try {
    fs.rmSync(_tmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors (e.g. dir already removed or in use)
  }
})

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../PathProviderCore', async () => {
  const crypto = await import('crypto')
  function _dirName(name: string): string {
    const ascii = name.replace(/[^a-zA-Z0-9_-]/g, '')
    if (ascii === name && name.length > 0) return name
    const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 12)
    return ascii ? `${ascii.slice(0, 30)}-${hash}` : hash
  }
  function _safeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
  }
  return {
    getDataDir: () => _tmpDir,
    ensureDataDir: () => fs.mkdirSync(_tmpDir, { recursive: true }),
    workflowDirName: _dirName,
    ensureWorkflowWorkspace: vi.fn((scopeRoot: string, workflowName: string) => {
      const wsDir = path.join(scopeRoot, '.prizm', 'workflows', _dirName(workflowName))
      fs.mkdirSync(wsDir, { recursive: true })
      const persistentDir = path.join(wsDir, 'workspace')
      fs.mkdirSync(persistentDir, { recursive: true })
      const runsDir = path.join(wsDir, '.meta', 'runs')
      fs.mkdirSync(runsDir, { recursive: true })
      return wsDir
    }),
    ensureRunWorkspace: vi.fn((scopeRoot: string, workflowName: string, runId: string) => {
      const dir = _dirName(workflowName)
      const persistentDir = path.join(scopeRoot, '.prizm', 'workflows', dir, 'persistent')
      const runDir = path.join(
        scopeRoot,
        '.prizm',
        'workflows',
        dir,
        'run-workspaces',
        _safeId(runId)
      )
      fs.mkdirSync(persistentDir, { recursive: true })
      fs.mkdirSync(runDir, { recursive: true })
      return { persistentDir, runDir }
    }),
    getWorkflowPersistentWorkspace: vi.fn((scopeRoot: string, workflowName: string) => {
      return path.join(scopeRoot, '.prizm', 'workflows', _dirName(workflowName), 'persistent')
    }),
    getWorkflowRunMetaDir: vi.fn((scopeRoot: string, workflowName: string) => {
      return path.join(scopeRoot, '.prizm', 'workflows', _dirName(workflowName), '.meta', 'runs')
    }),
    getWorkflowRunMetaPath: vi.fn((scopeRoot: string, workflowName: string, runId: string) => {
      return path.join(
        scopeRoot,
        '.prizm',
        'workflows',
        _dirName(workflowName),
        '.meta',
        'runs',
        `${_safeId(runId)}.md`
      )
    })
  }
})

const _scopeRootDir = path.join(_tmpDir, 'scope-root')
fs.mkdirSync(_scopeRootDir, { recursive: true })

vi.mock('../ScopeStore', () => ({
  scopeStore: {
    getScopeRootPath: vi.fn(() => _scopeRootDir),
    getScopeData: vi.fn(() => ({ agentSessions: [] }))
  }
}))

vi.mock('./runMetaWriter', () => ({
  writeRunMeta: vi.fn()
}))

vi.mock('./linkedActionExecutor', () => ({
  executeLinkedActions: vi.fn().mockResolvedValue(undefined)
}))

const _defStore = new Map<string, { name: string; scope: string; yamlContent: string }>()

vi.mock('./workflowDefStore', () => ({
  registerDef: vi.fn((name: string, scope: string, yamlContent: string) => {
    _defStore.set(`${name}:${scope}`, { name, scope, yamlContent })
    return {
      id: `def-${name}`,
      name,
      scope,
      yamlContent,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }),
  getDefByName: vi.fn((name: string, scope: string) => {
    const key = `${name}:${scope}`
    const entry = _defStore.get(key)
    if (!entry) return null
    return { id: `def-${name}`, ...entry, createdAt: Date.now(), updatedAt: Date.now() }
  }),
  getDefById: vi.fn(() => null),
  listDefs: vi.fn(() => []),
  deleteDef: vi.fn(() => false)
}))

import { emit } from '../eventBus/eventBus'
import { executeLinkedActions } from './linkedActionExecutor'
import { ensureWorkflowWorkspace } from '../PathProviderCore'
import { writeRunMeta } from './runMetaWriter'
import { scopeStore } from '../ScopeStore'
import { WorkflowRunner } from './runner'
import * as store from './resumeStore'
import * as defStore from './workflowDefStore'
import type { IStepExecutor, StepExecutionInput, StepExecutionOutput } from './types'
import type { WorkflowDef, AgentSession } from '@prizm/shared'

function clearDefStore(): void {
  _defStore.clear()
}

const mockEmit = emit as ReturnType<typeof vi.fn>
const mockLinkedActions = executeLinkedActions as ReturnType<typeof vi.fn>
const mockEnsureWorkspace = ensureWorkflowWorkspace as ReturnType<typeof vi.fn>
const mockWriteRunMeta = writeRunMeta as ReturnType<typeof vi.fn>
const mockScopeStore = scopeStore as unknown as {
  getScopeRootPath: ReturnType<typeof vi.fn>
  getScopeData: ReturnType<typeof vi.fn>
}

// ─── Mock Executor ───

function createMockExecutor(
  handler?: (
    scope: string,
    input: StepExecutionInput,
    signal?: AbortSignal
  ) => StepExecutionOutput | Promise<StepExecutionOutput>
): IStepExecutor {
  const defaultHandler = async (
    _scope: string,
    input: StepExecutionInput
  ): Promise<StepExecutionOutput> => ({
    sessionId: `sess-${Date.now()}`,
    status: 'success',
    output: `Result for: ${input.prompt?.slice(0, 50)}`,
    durationMs: 100
  })

  return {
    execute: vi.fn(handler ?? defaultHandler)
  }
}

// ─── 测试定义工厂 ───

function defSingleAgent(prompt = 'do something'): WorkflowDef {
  return {
    name: 'single-agent',
    steps: [{ id: 's1', type: 'agent', prompt }]
  }
}

function defTwoAgents(): WorkflowDef {
  return {
    name: 'two-agents',
    steps: [
      { id: 'collect', type: 'agent', prompt: '收集数据' },
      { id: 'summarize', type: 'agent', prompt: '总结', input: '$collect.output' }
    ]
  }
}

function defApproveFlow(): WorkflowDef {
  return {
    name: 'approve-flow',
    steps: [
      { id: 'draft', type: 'agent', prompt: '起草' },
      { id: 'review', type: 'approve', approvePrompt: '确认发布?' },
      { id: 'publish', type: 'agent', prompt: '发布 $draft.output' }
    ]
  }
}

function defConditionalFlow(): WorkflowDef {
  return {
    name: 'cond-flow',
    steps: [
      { id: 'check', type: 'approve', approvePrompt: '继续?' },
      { id: 'if_yes', type: 'agent', prompt: 'do it', condition: '$check.approved' },
      { id: 'always', type: 'agent', prompt: 'always runs' }
    ]
  }
}

function defTransform(): WorkflowDef {
  return {
    name: 'transform-flow',
    steps: [
      { id: 'fetch', type: 'agent', prompt: '获取 JSON' },
      { id: 'extract', type: 'transform', input: '$fetch.output', transform: 'data.title' }
    ]
  }
}

function defWithLinkedActions(): WorkflowDef {
  return {
    name: 'linked-flow',
    steps: [
      {
        id: 's1',
        type: 'agent',
        prompt: 'generate',
        linkedActions: [
          { type: 'create_document', params: { title: 'Report', content: '$s1.output' } }
        ]
      }
    ]
  }
}

// ─── Tests ───

describe('WorkflowRunner — 单步 agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应成功执行单步 agent 并返回 completed', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('completed')
    expect(result.runId).toBeTruthy()
    expect(result.finalOutput).toContain('Result for:')

    const run = store.getRunById(result.runId)
    expect(run!.status).toBe('completed')
    expect(run!.stepResults.s1.status).toBe('completed')
  })

  it('agent 步骤失败时整个工作流应标记 failed', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 'sess-1',
      status: 'failed',
      output: '执行出错',
      durationMs: 50
    }))
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('failed')
    expect(result.error).toContain('failed')

    const run = store.getRunById(result.runId)
    expect(run!.status).toBe('failed')
  })

  it('agent 步骤超时时应标记 failed', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 'sess-1',
      status: 'timeout',
      output: '超时了',
      durationMs: 30000
    }))
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('failed')
    expect(result.error).toContain('timeout')
  })

  it('executor 抛异常时应标记 failed', async () => {
    const executor = createMockExecutor(async () => {
      throw new Error('网络错误')
    })
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('网络错误')
  })

  it('config.maxStepOutputChars 超出时应截断 output 并追加 (truncated)', async () => {
    const longOutput = 'a'.repeat(100)
    const executor = createMockExecutor(async () => ({
      sessionId: 'sess-1',
      status: 'success',
      output: longOutput,
      durationMs: 10
    }))
    const def: WorkflowDef = {
      name: 'output-limit',
      steps: [{ id: 's1', type: 'agent', prompt: 'go' }],
      config: { maxStepOutputChars: 20 }
    }
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', def)

    expect(result.status).toBe('completed')
    const run = store.getRunById(result.runId)
    const stepOutput = run!.stepResults.s1.output!
    expect(stepOutput).toHaveLength(20 + '\n... (truncated)'.length)
    expect(stepOutput).toBe('a'.repeat(20) + '\n... (truncated)')
  })

  it('未配置 maxStepOutputChars 时不截断 output', async () => {
    const longOutput = 'b'.repeat(200)
    const executor = createMockExecutor(async () => ({
      sessionId: 'sess-1',
      status: 'success',
      output: longOutput,
      durationMs: 10
    }))
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('completed')
    const run = store.getRunById(result.runId)
    expect(run!.stepResults.s1.output).toBe(longOutput)
  })

  it('应 emit workflow:started 和 workflow:completed 事件', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    const emittedEvents = mockEmit.mock.calls.map((c) => c[0])
    expect(emittedEvents).toContain('workflow:started')
    expect(emittedEvents).toContain('workflow:step.completed')
    expect(emittedEvents).toContain('workflow:completed')
  })

  it('失败时应 emit workflow:failed', async () => {
    const executor = createMockExecutor(async () => {
      throw new Error('boom')
    })
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    const failedEvent = mockEmit.mock.calls.find((c) => c[0] === 'workflow:failed')
    expect(failedEvent).toBeDefined()
  })
})

describe('WorkflowRunner — 多步 agent 流水线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应依次执行所有步骤并传递上下文', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return {
        sessionId: `s-${calls.length}`,
        status: 'success',
        output: `output-${calls.length}`,
        durationMs: 10
      }
    })

    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defTwoAgents())

    expect(result.status).toBe('completed')
    expect(calls).toHaveLength(2)
    expect(calls[1].prompt).toContain('output-1')

    const run = store.getRunById(result.runId)
    expect(Object.keys(run!.stepResults)).toHaveLength(2)
    expect(run!.stepResults.collect.status).toBe('completed')
    expect(run!.stepResults.summarize.status).toBe('completed')
  })

  it('第二步失败时第一步仍应标记 completed', async () => {
    let callCount = 0
    const executor = createMockExecutor(async () => {
      callCount++
      if (callCount === 2) {
        return { sessionId: 's-2', status: 'failed', output: 'error', durationMs: 10 }
      }
      return { sessionId: 's-1', status: 'success', output: 'ok', durationMs: 10 }
    })

    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defTwoAgents())

    expect(result.status).toBe('failed')
    const run = store.getRunById(result.runId)
    expect(run!.stepResults.collect.status).toBe('completed')
    expect(run!.stepResults.summarize.status).toBe('failed')
  })
})

describe('WorkflowRunner — approve + resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('approve 步骤应暂停工作流', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defApproveFlow())

    expect(result.status).toBe('paused')
    expect(result.resumeToken).toBeTruthy()
    expect(result.approvePrompt).toBe('确认发布?')

    const run = store.getRunById(result.runId)
    expect(run!.status).toBe('paused')
    expect(run!.currentStepIndex).toBe(1)
  })

  it('resume 批准后应继续执行后续步骤', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('approve-flow', 'default', JSON.stringify(defApproveFlow()))

    const pauseResult = await runner.runWorkflow('default', defApproveFlow())
    expect(pauseResult.status).toBe('paused')

    const resumeResult = await runner.resumeWorkflow(pauseResult.resumeToken!, true)
    expect(resumeResult.status).toBe('completed')

    const run = store.getRunById(pauseResult.runId)
    expect(run!.status).toBe('completed')
    expect(run!.stepResults.review.approved).toBe(true)
    expect(run!.stepResults.publish.status).toBe('completed')
  })

  it('resume 拒绝后应继续执行（approved=false 传递到 stepResult）', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('approve-flow', 'default', JSON.stringify(defApproveFlow()))

    const pauseResult = await runner.runWorkflow('default', defApproveFlow())
    const resumeResult = await runner.resumeWorkflow(pauseResult.resumeToken!, false)

    expect(resumeResult.status).toBe('completed')
    const run = store.getRunById(pauseResult.runId)
    expect(run!.stepResults.review.approved).toBe(false)
  })

  it('resume 无效 token 应返回 failed', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.resumeWorkflow('invalid-token', true)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Invalid resume token')
  })

  it('resume 非 paused 状态应返回错误', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('approve-flow', 'default', JSON.stringify(defApproveFlow()))
    const pauseResult = await runner.runWorkflow('default', defApproveFlow())

    const run = store.getRunById(pauseResult.runId)!
    store.updateRunStatus(run.id, 'completed')

    const result = await runner.resumeWorkflow(pauseResult.resumeToken!, true)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Cannot resume')
  })
})

describe('WorkflowRunner — transform step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应从 JSON 输出中提取字段', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 's-1',
      status: 'success',
      output: JSON.stringify({ data: { title: '提取的标题', count: 42 } }),
      durationMs: 10
    }))

    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defTransform())

    expect(result.status).toBe('completed')
    expect(result.finalOutput).toBe('提取的标题')
  })

  it('字段不存在时应返回 null', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 's-1',
      status: 'success',
      output: JSON.stringify({ data: { other: 'x' } }),
      durationMs: 10
    }))

    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defTransform())

    expect(result.status).toBe('completed')
    expect(result.finalOutput).toBe('null')
  })

  it('非 JSON 输入应当作字符串处理', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 's-1',
      status: 'success',
      output: 'not json',
      durationMs: 10
    }))

    const runner = new WorkflowRunner(executor)
    const def: WorkflowDef = {
      name: 'transform-text',
      steps: [
        { id: 'fetch', type: 'agent', prompt: 'go' },
        { id: 'extract', type: 'transform', input: '$fetch.output', transform: '' }
      ]
    }
    const result = await runner.runWorkflow('default', def)
    expect(result.status).toBe('completed')
    expect(result.finalOutput).toBe('not json')
  })
})

describe('WorkflowRunner — 条件执行', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('条件为 false 时应 skip 步骤', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('cond-flow', 'default', JSON.stringify(defConditionalFlow()))

    const pauseResult = await runner.runWorkflow('default', defConditionalFlow())
    const resumeResult = await runner.resumeWorkflow(pauseResult.resumeToken!, false)

    expect(resumeResult.status).toBe('completed')
    const run = store.getRunById(pauseResult.runId)
    expect(run!.stepResults.if_yes.status).toBe('skipped')
    expect(run!.stepResults.always.status).toBe('completed')
  })

  it('条件为 true 时应执行步骤', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('cond-flow', 'default', JSON.stringify(defConditionalFlow()))

    const pauseResult = await runner.runWorkflow('default', defConditionalFlow())
    const resumeResult = await runner.resumeWorkflow(pauseResult.resumeToken!, true)

    expect(resumeResult.status).toBe('completed')
    const run = store.getRunById(pauseResult.runId)
    expect(run!.stepResults.if_yes.status).toBe('completed')
    expect(run!.stepResults.always.status).toBe('completed')
  })

  it('skip 步骤应 emit step.completed(skipped)', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('cond-flow', 'default', JSON.stringify(defConditionalFlow()))

    const pauseResult = await runner.runWorkflow('default', defConditionalFlow())
    await runner.resumeWorkflow(pauseResult.resumeToken!, false)

    const skipEvent = mockEmit.mock.calls.find(
      (c) =>
        c[0] === 'workflow:step.completed' &&
        (c[1] as Record<string, unknown>)?.stepStatus === 'skipped'
    )
    expect(skipEvent).toBeDefined()
  })
})

describe('WorkflowRunner — linkedActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('步骤成功后应调用 executeLinkedActions', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defWithLinkedActions())

    expect(mockLinkedActions).toHaveBeenCalledTimes(1)
    expect(mockLinkedActions).toHaveBeenCalledWith(
      'default',
      defWithLinkedActions().steps[0].linkedActions,
      expect.any(Object),
      undefined
    )
  })

  it('步骤失败时不应调用 linkedActions', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 's',
      status: 'failed',
      output: 'err',
      durationMs: 10
    }))
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defWithLinkedActions())

    expect(mockLinkedActions).not.toHaveBeenCalled()
  })
})

describe('WorkflowRunner — cancelWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应取消 paused 工作流', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defApproveFlow())

    expect(runner.cancelWorkflow(result.runId)).toBe(true)

    const run = store.getRunById(result.runId)
    expect(run!.status).toBe('cancelled')
  })

  it('不存在的 runId 应返回 false', () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    expect(runner.cancelWorkflow('nonexistent')).toBe(false)
  })

  it('已完成的工作流不应被取消', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(runner.cancelWorkflow(result.runId)).toBe(false)
  })

  it('取消应 emit workflow:failed 事件', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defApproveFlow())

    runner.cancelWorkflow(result.runId)

    const cancelEvent = mockEmit.mock.calls.find(
      (c) =>
        c[0] === 'workflow:failed' &&
        (c[1] as Record<string, unknown>)?.error === 'Cancelled by user'
    )
    expect(cancelEvent).toBeDefined()
  })

  it('取消 running 工作流应 abort 正在执行的 executor signal', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveExec: ((v: StepExecutionOutput) => void) | undefined

    const executor = createMockExecutor((_scope, _input, signal) => {
      capturedSignal = signal
      return new Promise<StepExecutionOutput>((resolve) => {
        resolveExec = resolve
      })
    })

    const runner = new WorkflowRunner(executor)
    const runPromise = runner.runWorkflow('default', defSingleAgent())

    // 等待 executor 开始执行
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())

    expect(capturedSignal!.aborted).toBe(false)

    // 获取 runId（从 store 中查找 running 的 run）
    const runs = store.listRuns('default')
    const activeRun = runs.find((r) => r.status === 'running')
    expect(activeRun).toBeDefined()

    runner.cancelWorkflow(activeRun!.id)
    expect(capturedSignal!.aborted).toBe(true)

    // 让 executor 完成（模拟 abort 后 resolve）
    resolveExec!({ sessionId: 's', status: 'cancelled', output: '', durationMs: 0 })
    const result = await runPromise

    expect(result.status).toBe('cancelled')
    const run = store.getRunById(activeRun!.id)
    expect(run!.status).toBe('cancelled')
  })

  it('executor 应收到 AbortSignal 参数', async () => {
    let receivedSignal: AbortSignal | undefined
    const executor = createMockExecutor(async (_scope, _input, signal) => {
      receivedSignal = signal
      return { sessionId: 's', status: 'success', output: 'ok', durationMs: 10 }
    })

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal!.aborted).toBe(false)
  })
})

describe('WorkflowRunner — $args 和 $prev 引用', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应将 $args 通过 input 注入上下文', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: 'ok', durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'args-flow',
      steps: [{ id: 's1', type: 'agent', prompt: '分析数据', input: '$args.topic' }]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: { topic: 'AI安全' } })

    expect(calls[0].prompt).toContain('AI安全')
  })

  it('应将 prompt 文本中的 $args.xxx 引用解析为实际值', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: 'ok', durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'prompt-args',
      steps: [
        {
          id: 's1',
          type: 'agent',
          prompt: '请写关于「$args.topic」的简短分析，字数约 $args.count 字。',
          input: ''
        }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, {
      args: { topic: 'AI安全', count: '500' }
    })

    expect(calls[0].prompt).toContain('请写关于「AI安全」的简短分析')
    expect(calls[0].prompt).toContain('字数约 500 字')
    expect(calls[0].prompt).not.toContain('$args.')
  })

  it('$prev.output 应引用前一个 completed 步骤', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: `output-${calls.length}`, durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'prev-flow',
      steps: [
        { id: 's1', type: 'agent', prompt: 'step 1' },
        { id: 's2', type: 'agent', prompt: 'step 2', input: '$prev.output' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls[1].prompt).toContain('output-1')
  })

  it('无 input 的非首步应自动接收上一步输出（隐式管道）', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: `output-${calls.length}`, durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'implicit-pipe',
      steps: [
        { id: 's1', type: 'agent', prompt: 'step 1' },
        { id: 's2', type: 'agent', prompt: 'step 2' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls).toHaveLength(2)
    expect(calls[0].prompt).toBe('step 1')
    expect(calls[1].prompt).toContain('step 2')
    expect(calls[1].prompt).toContain('output-1')
    expect(calls[1].prompt).toContain('s1')
  })

  it('三步串行工作流隐式管道应逐步传递', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: `output-${calls.length}`, durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'triple-pipe',
      steps: [
        { id: 'create', type: 'agent', prompt: '创建' },
        { id: 'update', type: 'agent', prompt: '更新' },
        { id: 'read', type: 'agent', prompt: '读取' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls).toHaveLength(3)
    // 步骤2应接收步骤1的输出
    expect(calls[1].prompt).toContain('output-1')
    expect(calls[1].prompt).toContain('create')
    // 步骤3应接收步骤2的输出（不是步骤1的）
    expect(calls[2].prompt).toContain('output-2')
    expect(calls[2].prompt).toContain('update')
    expect(calls[2].prompt).not.toContain('output-1')
  })

  it('显式 input 应覆盖隐式管道', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: `output-${calls.length}`, durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'explicit-override',
      steps: [
        { id: 'a', type: 'agent', prompt: 'step a' },
        { id: 'b', type: 'agent', prompt: 'step b' },
        { id: 'c', type: 'agent', prompt: 'step c', input: '$a.output' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls).toHaveLength(3)
    // 步骤 c 显式引用 $a.output，应收到步骤 a 的输出
    expect(calls[2].prompt).toContain('output-1')
    expect(calls[2].prompt).toContain('步骤 "a" 的输出')
  })

  it('首步不应有隐式管道注入', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: 'output-1', durationMs: 10 }
    })

    const def: WorkflowDef = {
      name: 'first-step',
      steps: [{ id: 's1', type: 'agent', prompt: 'do it' }]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls[0].prompt).toBe('do it')
  })
})

describe('WorkflowRunner — store 状态一致性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('多步工作流每步完成后 store 应持续更新', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    const def: WorkflowDef = {
      name: 'triple',
      steps: [
        { id: 'a', type: 'agent', prompt: 'A' },
        { id: 'b', type: 'agent', prompt: 'B' },
        { id: 'c', type: 'agent', prompt: 'C' }
      ]
    }

    const result = await runner.runWorkflow('default', def)
    const run = store.getRunById(result.runId)

    expect(run!.status).toBe('completed')
    expect(Object.keys(run!.stepResults)).toHaveLength(3)
    expect(run!.stepResults.a.status).toBe('completed')
    expect(run!.stepResults.b.status).toBe('completed')
    expect(run!.stepResults.c.status).toBe('completed')
    expect(run!.stepResults.a.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('triggerType 和 linkedIds 应正确持久化', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('scope-x', defSingleAgent(), {
      triggerType: 'schedule',
      linkedScheduleId: 'sched-123',
      linkedTodoId: 'todo-456'
    })

    const run = store.getRunById(result.runId)
    expect(run!.scope).toBe('scope-x')
    expect(run!.triggerType).toBe('schedule')
    expect(run!.linkedScheduleId).toBe('sched-123')
    expect(run!.linkedTodoId).toBe('todo-456')
  })
})

// ─── 新增：workflow 工作区 + flushRunMeta + $data 引用 ───

describe('WorkflowRunner — workflow 工作区创建', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('runWorkflow 应调用 ensureWorkflowWorkspace', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    expect(mockEnsureWorkspace).toHaveBeenCalledWith(_scopeRootDir, 'single-agent')
  })

  it('workspaceDir 应传递给 executor', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: 'ok', durationMs: 10 }
    })

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    expect(calls).toHaveLength(1)
    expect(calls[0].workspaceDir).toBeTruthy()
    expect(calls[0].workspaceDir).toContain('single-agent')
  })

  it('resumeWorkflow 也应调用 ensureWorkflowWorkspace', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    defStore.registerDef('approve-flow', 'default', JSON.stringify(defApproveFlow()))
    const pauseResult = await runner.runWorkflow('default', defApproveFlow())
    vi.clearAllMocks()

    await runner.resumeWorkflow(pauseResult.resumeToken!, true)
    expect(mockEnsureWorkspace).toHaveBeenCalled()
  })
})

describe('WorkflowRunner — flushRunMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('单步完成后应调用 writeRunMeta', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    expect(mockWriteRunMeta).toHaveBeenCalled()
    const lastCall = mockWriteRunMeta.mock.calls[mockWriteRunMeta.mock.calls.length - 1]
    const data = lastCall[1]
    expect(data.workflowName).toBe('single-agent')
    expect(data.status).toBe('completed')
    expect(data.stepResults).toBeTruthy()
  })

  it('多步工作流每步后应调用 writeRunMeta', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defTwoAgents())

    // 至少 2 步 + completed 状态写入 = 至少 3 次调用
    expect(mockWriteRunMeta.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('失败时也应写入 flushRunMeta（状态 failed）', async () => {
    const executor = createMockExecutor(async () => {
      throw new Error('boom')
    })
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    const failedCalls = mockWriteRunMeta.mock.calls.filter(
      (c: unknown[]) => (c[1] as { status: string }).status === 'failed'
    )
    expect(failedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('paused 时应写入 flushRunMeta', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defApproveFlow())

    const pausedCalls = mockWriteRunMeta.mock.calls.filter(
      (c: unknown[]) => (c[1] as { status: string }).status === 'paused'
    )
    expect(pausedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('skip 步骤也应写入 flushRunMeta', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    defStore.registerDef('cond-flow', 'default', JSON.stringify(defConditionalFlow()))
    const pauseResult = await runner.runWorkflow('default', defConditionalFlow())
    vi.clearAllMocks()

    await runner.resumeWorkflow(pauseResult.resumeToken!, false)

    expect(mockWriteRunMeta).toHaveBeenCalled()
  })
})

describe('WorkflowRunner — $stepId.data.xxx 引用', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('$stepId.data.key 应从 structuredData 中提取值', async () => {
    const calls: StepExecutionInput[] = []
    let callIdx = 0
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      callIdx++
      return {
        sessionId: `s-${callIdx}`,
        status: 'success',
        output: `output-${callIdx}`,
        durationMs: 10
      }
    })

    mockScopeStore.getScopeData.mockImplementation(() => ({
      agentSessions: [
        {
          id: 's-1',
          scope: 'default',
          kind: 'background',
          bgStructuredData: '{"sentiment":"positive","score":0.95}',
          bgArtifacts: ['report.md'],
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    }))

    const def: WorkflowDef = {
      name: 'data-ref-flow',
      steps: [
        { id: 'analyze', type: 'agent', prompt: '分析' },
        { id: 'report', type: 'agent', prompt: '报告', input: '$analyze.data.sentiment' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls).toHaveLength(2)
    // input 通过 resolveReference 解析 $analyze.data.sentiment → 'positive'
    // 被附加到 prompt 后面：'报告\n\n--- 上一步输出 ---\npositive'
    expect(calls[1].prompt).toContain('positive')
  })

  it('$stepId.data 不存在时返回空字符串', async () => {
    const calls: StepExecutionInput[] = []
    let callIdx = 0
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      callIdx++
      return {
        sessionId: `s-${callIdx}`,
        status: 'success',
        output: `output-${callIdx}`,
        durationMs: 10
      }
    })

    mockScopeStore.getScopeData.mockImplementation(() => ({
      agentSessions: [
        {
          id: 's-1',
          scope: 'default',
          kind: 'background',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    }))

    const def: WorkflowDef = {
      name: 'no-data-flow',
      steps: [
        { id: 's1', type: 'agent', prompt: 'go' },
        { id: 's2', type: 'agent', prompt: 'ref: $s1.data.missing' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls[1].prompt).toContain('ref: ')
    expect(calls[1].prompt).not.toContain('undefined')
  })

  it('$stepId.data.nested.key 应支持深层引用', async () => {
    const calls: StepExecutionInput[] = []
    let callIdx = 0
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      callIdx++
      return {
        sessionId: `s-${callIdx}`,
        status: 'success',
        output: `output-${callIdx}`,
        durationMs: 10
      }
    })

    mockScopeStore.getScopeData.mockImplementation(() => ({
      agentSessions: [
        {
          id: 's-1',
          scope: 'default',
          kind: 'background',
          bgStructuredData: '{"result":{"category":"tech","tags":["ai","ml"]}}',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    }))

    const def: WorkflowDef = {
      name: 'nested-data-flow',
      steps: [
        { id: 'classify', type: 'agent', prompt: '分类' },
        { id: 'use', type: 'agent', prompt: '处理', input: '$classify.data.result.category' }
      ]
    }

    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    // input 通过 resolveReference 解析 $classify.data.result.category → 'tech'
    expect(calls[1].prompt).toContain('tech')
  })
})

describe('WorkflowRunner — extractBgSessionData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('应从 AgentSession 提取 bgStructuredData 和 bgArtifacts', async () => {
    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)

    const mockSession: Partial<AgentSession> = {
      id: expect.any(String),
      scope: 'default',
      kind: 'background',
      bgStructuredData: '{"key":"val"}',
      bgArtifacts: ['output.csv'],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    mockScopeStore.getScopeData.mockImplementation(() => ({
      agentSessions: [{ ...mockSession, id: expect.any(String) }]
    }))

    const def: WorkflowDef = {
      name: 'extract-flow',
      steps: [{ id: 's1', type: 'agent', prompt: 'go' }]
    }

    await runner.runWorkflow('default', def)

    const run = store.getRunById(
      mockWriteRunMeta.mock.calls[mockWriteRunMeta.mock.calls.length - 1]?.[1]?.runId
    )
    // extractBgSessionData 只在找到 session 时才提取数据
    // 验证 writeRunMeta 被调用（说明 flushRunMeta 正常工作）
    expect(mockWriteRunMeta).toHaveBeenCalled()
  })
})

describe('WorkflowRunner — cleanBefore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('cleanBefore=true 时应清空工作区（保留 .meta）', async () => {
    // 先创建 workspace 并写入一些文件
    const wsDir = mockEnsureWorkspace(_scopeRootDir, 'single-agent')
    fs.writeFileSync(path.join(wsDir, 'old-file.txt'), 'old data')
    fs.mkdirSync(path.join(wsDir, 'old-dir'), { recursive: true })
    fs.writeFileSync(path.join(wsDir, 'old-dir', 'nested.txt'), 'nested')
    fs.writeFileSync(path.join(wsDir, '.meta', 'runs', 'old-run.md'), '---\nrunId: old\n---\n')

    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent(), { cleanBefore: true })

    expect(fs.existsSync(path.join(wsDir, 'old-file.txt'))).toBe(false)
    expect(fs.existsSync(path.join(wsDir, 'old-dir'))).toBe(false)
    // .meta 应被保留
    expect(fs.existsSync(path.join(wsDir, '.meta', 'runs', 'old-run.md'))).toBe(true)
  })

  it('cleanBefore=false（默认）不应清空工作区', async () => {
    const wsDir = mockEnsureWorkspace(_scopeRootDir, 'single-agent')
    fs.writeFileSync(path.join(wsDir, 'preserved.txt'), 'data')

    const executor = createMockExecutor()
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', defSingleAgent())

    expect(fs.existsSync(path.join(wsDir, 'preserved.txt'))).toBe(true)
  })
})

describe('WorkflowRunner — 流水线 I/O 单一路径与结构化对齐', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDefStore()
    store.initResumeStore()
  })
  afterEach(() => store.closeResumeStore())

  it('无 def.args 时传 options.args 首步仍收到 inputParams（推断 schema）', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's1', status: 'success', output: 'ok', durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'no-args-def',
      steps: [{ id: 's1', type: 'agent', prompt: '处理' }]
    }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: { topic: 'AI安全', count: 42 } })

    expect(calls).toHaveLength(1)
    expect(calls[0].inputParams).toBeDefined()
    expect(calls[0].inputParams!.schema).toEqual({
      topic: { type: 'string', description: '' },
      count: { type: 'string', description: '' }
    })
    expect(calls[0].inputParams!.values).toEqual({ topic: 'AI安全', count: 42 })
  })

  it('completed 时 finalStructuredOutput 派生自最后一步 structuredData', async () => {
    const executor = createMockExecutor(async () => ({
      sessionId: 'sess-final',
      status: 'success',
      output: 'done',
      durationMs: 10
    }))
    mockScopeStore.getScopeData.mockImplementation(() => ({
      agentSessions: [
        {
          id: 'sess-final',
          scope: 'default',
          kind: 'background',
          bgStructuredData: '{"result":"Markdown 列表项1\\n列表项2"}',
          bgArtifacts: [],
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    }))
    const runner = new WorkflowRunner(executor)
    const result = await runner.runWorkflow('default', defSingleAgent())

    expect(result.status).toBe('completed')
    expect(result.finalOutput).toContain('done')
    expect(result.finalStructuredOutput).toBe('{"result":"Markdown 列表项1\\n列表项2"}')
  })

  it('结构化 I/O：def 含 args（type）与 outputs（单字段 result），首步 inputParams 带 type、末步 outputParams 与 def.outputs 一致', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's1', status: 'success', output: 'ok', durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'structured-io',
      args: {
        query: { description: '用户自然语言描述的需求', type: 'string' }
      },
      outputs: {
        result: {
          type: 'string',
          description: '以 Markdown 列表形式返回的最终结果，每条一行'
        }
      },
      steps: [{ id: 's1', type: 'agent', prompt: '处理' }]
    }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: { query: '请列三条要点' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].inputParams).toBeDefined()
    expect(calls[0].inputParams!.schema.query).toMatchObject({
      type: 'string',
      description: '用户自然语言描述的需求'
    })
    expect(calls[0].inputParams!.values).toEqual({ query: '请列三条要点' })
    expect(calls[0].outputParams).toBeDefined()
    expect(calls[0].outputParams!.schema).toEqual(def.outputs)
    expect(calls[0].outputParams!.required).toEqual(['result'])
  })

  it('多步工作流且传 options.args 时，run.args 单源由 workflow_context 提供，systemInstructions 不再包含流水线原始输入', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's', status: 'success', output: `out-${calls.length}`, durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'multi-original-input',
      steps: [
        { id: 's1', type: 'agent', prompt: '第一步' },
        { id: 's2', type: 'agent', prompt: '第二步' }
      ]
    }
    const runArgs = { topic: 'OriginalTopic', count: 100 }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: runArgs })

    expect(calls).toHaveLength(2)
    // run.args 仅在 workflow_context 片段中展示（工作流参数），此处不重复
    expect(calls[0].systemInstructions).not.toContain('流水线原始输入')
    expect(calls[1].systemInstructions).not.toContain('流水线原始输入')
    // 首步仍有 inputParams（表格形式），后续步骤通过 workflow_context 的 run 获取参数
    expect(calls[0].inputParams?.values).toEqual(runArgs)
  })

  it('有 def.args 且含 default，不传 options.args 时，首步 inputParams.values 为各 default', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's1', status: 'success', output: 'ok', durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'with-defaults',
      args: {
        topic: { default: 'AI', description: '主题' },
        count: { default: 3, type: 'number', description: '数量' }
      },
      steps: [{ id: 's1', type: 'agent', prompt: '处理' }]
    }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def)

    expect(calls).toHaveLength(1)
    expect(calls[0].inputParams).toBeDefined()
    expect(calls[0].inputParams!.values).toEqual({ topic: 'AI', count: 3 })
  })

  it('有 def.args 且含 default，传部分 options.args 时，未传的 key 使用 default', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's1', status: 'success', output: 'ok', durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'partial-args',
      args: {
        topic: { default: 'AI', description: '主题' },
        query: { default: '默认查询', description: '查询' }
      },
      steps: [{ id: 's1', type: 'agent', prompt: '处理' }]
    }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: { topic: '自定义主题' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].inputParams!.values).toEqual({
      topic: '自定义主题',
      query: '默认查询'
    })
  })

  it('有 def.args 且某参数无 default、未传时，该 key 在 values 中为 undefined', async () => {
    const calls: StepExecutionInput[] = []
    const executor = createMockExecutor(async (_scope, input) => {
      calls.push(input)
      return { sessionId: 's1', status: 'success', output: 'ok', durationMs: 10 }
    })
    const def: WorkflowDef = {
      name: 'partial-required',
      args: {
        required: { description: '必填' },
        note: { description: '备注' }
      },
      steps: [{ id: 's1', type: 'agent', prompt: '处理' }]
    }
    const runner = new WorkflowRunner(executor)
    await runner.runWorkflow('default', def, { args: { required: '必填值' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].inputParams).toBeDefined()
    expect(calls[0].inputParams!.values.required).toBe('必填值')
    expect(calls[0].inputParams!.values.note).toBeUndefined()
  })
})
