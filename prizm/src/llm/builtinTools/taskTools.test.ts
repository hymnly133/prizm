/**
 * taskTools 单元测试
 * executeSetResult / executeSpawnTask / executeTaskStatus
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentSession } from '@prizm/shared'
import type { BuiltinToolContext } from './types'

vi.mock('../../core/ScopeStore', () => {
  const sessions = new Map<string, AgentSession>()
  return {
    scopeStore: {
      getScopeData: vi.fn((scope: string) => ({
        agentSessions: [...sessions.values()].filter((s) => s.scope === scope)
      })),
      saveScope: vi.fn(),
      _sessions: sessions
    }
  }
})

const mockTaskRunner = {
  list: vi.fn().mockReturnValue([]),
  getStatus: vi.fn().mockReturnValue(null),
  cancel: vi.fn().mockResolvedValue(true),
  trigger: vi.fn().mockResolvedValue({ taskId: 'task-mock-1' }),
  triggerSync: vi.fn().mockResolvedValue({
    id: 'task-mock-1',
    sessionId: 'sess-mock',
    status: 'success',
    output: '同步结果',
    durationMs: 100
  })
}

vi.mock('../../core/workflowEngine', () => ({
  getTaskRunner: vi.fn(() => mockTaskRunner)
}))

import { executeSetResult, executeSpawnTask, executeTaskStatus } from './taskTools'
import { scopeStore } from '../../core/ScopeStore'

const mockScopeStore = scopeStore as unknown as {
  getScopeData: ReturnType<typeof vi.fn>
  saveScope: ReturnType<typeof vi.fn>
  _sessions: Map<string, AgentSession>
}

function makeCtx(overrides: Partial<BuiltinToolContext> = {}): BuiltinToolContext {
  return {
    scope: 'default',
    toolName: 'prizm_set_result',
    args: {},
    scopeRoot: '/tmp/test',
    data: { agentSessions: [] } as any,
    wsCtx: {} as any,
    record: vi.fn(),
    emitAudit: vi.fn(),
    wsArg: undefined,
    sessionId: 'sess-1',
    grantedPaths: undefined,
    ...overrides
  }
}

function seedSession(session: AgentSession) {
  mockScopeStore._sessions.set(session.id, session)
  mockScopeStore.getScopeData.mockImplementation((scope: string) => ({
    agentSessions: [...mockScopeStore._sessions.values()].filter((s) => s.scope === scope)
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockScopeStore._sessions.clear()
  mockTaskRunner.list.mockReturnValue([])
  mockTaskRunner.getStatus.mockReturnValue(null)
  mockTaskRunner.cancel.mockResolvedValue(true)
  mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-mock-1' })
  mockTaskRunner.triggerSync.mockResolvedValue({
    id: 'task-mock-1',
    sessionId: 'sess-mock',
    status: 'success',
    output: '同步结果',
    durationMs: 100
  })
})

describe('executeSetResult', () => {
  it('正常 BG session 调用 → 写入 bgResult + bgStatus + finishedAt', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '分析报告内容', status: 'success' } })
    const result = await executeSetResult(ctx)

    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('结果已提交')
    expect(session.bgResult).toBe('分析报告内容')
    expect(session.bgStatus).toBe('completed')
    expect(session.finishedAt).toBeDefined()
    expect(mockScopeStore.saveScope).toHaveBeenCalled()
  })

  it('交互 session 调用 → 返回仅后台生效提示', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const ctx = makeCtx({ args: { output: 'test' } })
    const result = await executeSetResult(ctx)

    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('仅在后台会话中生效')
  })

  it('无 sessionId → 返回 isError', async () => {
    const ctx = makeCtx({ sessionId: undefined, args: { output: 'test' } })
    const result = await executeSetResult(ctx)
    expect(result.isError).toBe(true)
  })

  it('session 不存在 → 返回 isError', async () => {
    const ctx = makeCtx({ sessionId: 'nonexistent', args: { output: 'test' } })
    const result = await executeSetResult(ctx)
    expect(result.isError).toBe(true)
  })

  it('output 为空字符串 → 返回 isError', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const ctx = makeCtx({ args: { output: '  ' } })
    const result = await executeSetResult(ctx)
    expect(result.isError).toBe(true)
  })

  it('status=failed → bgStatus 设为 failed', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '错误信息', status: 'failed' } })
    await executeSetResult(ctx)
    expect(session.bgStatus).toBe('failed')
  })

  it('带 structured_data → 返回信息包含附加提示', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const ctx = makeCtx({
      args: { output: '结果', structured_data: '{"key":"value"}' }
    })
    const result = await executeSetResult(ctx)
    expect(result.text).toContain('结构化数据')
  })

  it('structured_data 应写入 session.bgStructuredData', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({
      args: { output: '结果', structured_data: '{"sentiment":"positive","score":0.9}' }
    })
    await executeSetResult(ctx)

    expect(session.bgStructuredData).toBe('{"sentiment":"positive","score":0.9}')
  })

  it('artifacts 数组应写入 session.bgArtifacts', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({
      args: {
        output: '完成',
        artifacts: ['reports/summary.md', 'data/output.csv']
      }
    })
    await executeSetResult(ctx)

    expect(session.bgArtifacts).toEqual(['reports/summary.md', 'data/output.csv'])
  })

  it('artifacts 包含非字符串元素时应过滤', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({
      args: {
        output: '完成',
        artifacts: ['valid.md', 123, null, 'also-valid.csv']
      }
    })
    await executeSetResult(ctx)

    expect(session.bgArtifacts).toEqual(['valid.md', 'also-valid.csv'])
  })

  it('空 artifacts 数组 → bgArtifacts 应为 undefined', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '完成', artifacts: [] } })
    await executeSetResult(ctx)

    expect(session.bgArtifacts).toBeUndefined()
  })

  it('非数组 artifacts → bgArtifacts 应为 undefined', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '完成', artifacts: 'not-array' } })
    await executeSetResult(ctx)

    expect(session.bgArtifacts).toBeUndefined()
  })

  it('无 structured_data → bgStructuredData 应为 undefined', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '结果' } })
    await executeSetResult(ctx)

    expect(session.bgStructuredData).toBeUndefined()
  })

  it('structured_data 非字符串 → 应忽略', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '结果', structured_data: 42 } })
    await executeSetResult(ctx)

    expect(session.bgStructuredData).toBeUndefined()
  })

  it('带 artifacts 时返回信息应包含文件列表', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const ctx = makeCtx({
      args: { output: '完成', artifacts: ['report.md'] }
    })
    const result = await executeSetResult(ctx)
    expect(result.text).toContain('report.md')
    expect(result.text).toContain('产出文件')
  })

  it('同时带 structured_data + artifacts → 全部写入', async () => {
    const session: AgentSession = {
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({
      args: {
        output: '完成',
        structured_data: '{"type":"analysis"}',
        artifacts: ['report.md', 'chart.png']
      }
    })
    const result = await executeSetResult(ctx)

    expect(session.bgStructuredData).toBe('{"type":"analysis"}')
    expect(session.bgArtifacts).toEqual(['report.md', 'chart.png'])
    expect(result.text).toContain('结构化数据')
    expect(result.text).toContain('产出文件')
    expect(result.text).toContain('结果已提交')
  })

  it('验证 emitAudit 被调用', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgStatus: 'running',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const ctx = makeCtx({ args: { output: '结果' } })
    await executeSetResult(ctx)
    expect(ctx.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'bg_set_result', toolName: 'prizm_set_result' })
    )
  })
})

describe('executeSpawnTask', () => {
  it('异步模式：mock trigger → 返回 taskId', async () => {
    mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-child-1' })

    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '分析数据', mode: 'async', label: '数据分析' }
    })
    const result = await executeSpawnTask(ctx)

    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('task-child-1')
    expect(result.text).toContain('异步执行中')
  })

  it('同步模式：mock triggerSync → 返回完整结果', async () => {
    mockTaskRunner.triggerSync.mockResolvedValue({
      id: 'task-sync-1',
      sessionId: 'bg-sync-1',
      status: 'success',
      output: '同步执行结果',
      durationMs: 500
    })

    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '短任务', mode: 'sync' }
    })
    const result = await executeSpawnTask(ctx)

    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('同步执行结果')
    expect(result.text).toContain('success')
  })

  it('task 为空 → 返回 isError', async () => {
    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '' } })
    const result = await executeSpawnTask(ctx)
    expect(result.isError).toBe(true)
  })

  it('context 非法 JSON → 返回 isError', async () => {
    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '任务', context: 'not json' }
    })
    const result = await executeSpawnTask(ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('JSON')
  })

  it('taskRunner.trigger 抛错 → 返回 isError', async () => {
    mockTaskRunner.trigger.mockRejectedValue(new Error('concurrency limit'))

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '任务' } })
    const result = await executeSpawnTask(ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('concurrency limit')
  })

  it('验证 parentDepth 递增', async () => {
    seedSession({
      id: 'sess-1',
      scope: 'default',
      kind: 'background',
      bgMeta: { triggerType: 'tool_spawn', depth: 1 } as any,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-child-2' })

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '子任务' } })
    await executeSpawnTask(ctx)

    const triggerCall = mockTaskRunner.trigger.mock.calls[0]
    const meta = triggerCall[2]
    expect(meta.parentSessionId).toBe('sess-1')
  })

  it('验证 emitAudit 被调用', async () => {
    mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-child-3' })

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '任务' } })
    await executeSpawnTask(ctx)
    expect(ctx.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'spawn', toolName: 'prizm_spawn_task' })
    )
  })
})

describe('executeTaskStatus', () => {
  it("action='list' → 从 taskRunner 读取任务列表", async () => {
    mockTaskRunner.list.mockReturnValue([{ id: 'task-1', status: 'running', label: '任务A' }])

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'list' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('任务A')
    expect(result.text).toContain('1')
  })

  it("action='list' 无子任务 → 返回当前无子任务", async () => {
    mockTaskRunner.list.mockReturnValue([])
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'list' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('当前无子任务')
  })

  it("action='status' 已完成 → 返回状态摘要", async () => {
    mockTaskRunner.getStatus.mockReturnValue({
      id: 'task-1',
      status: 'completed',
      output: '完成',
      durationMs: 1000
    })

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'status', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('completed')
    expect(result.text).toContain('1000ms')
  })

  it("action='status' 运行中 → 返回正在执行中", async () => {
    mockTaskRunner.getStatus.mockReturnValue({
      id: 'task-1',
      status: 'running'
    })

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'status', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('正在执行中')
  })

  it("action='status' 无 task_id → 返回 isError", async () => {
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'status' } })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
  })

  it("action='result' 有结果 → 返回 output", async () => {
    mockTaskRunner.getStatus.mockReturnValue({
      id: 'task-1',
      status: 'completed',
      output: '详细结果内容'
    })

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'result', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('详细结果内容')
  })

  it("action='result' 无结果 → 返回不可用", async () => {
    mockTaskRunner.getStatus.mockReturnValue({
      id: 'task-1',
      status: 'running',
      output: undefined
    })

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'result', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('不可用')
  })

  it("action='cancel' → 调用 taskRunner.cancel", async () => {
    mockTaskRunner.cancel.mockResolvedValue(true)
    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'cancel', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('已取消')
    expect(mockTaskRunner.cancel).toHaveBeenCalledWith('task-1')
  })

  it("action='cancel' 失败 → 返回 isError", async () => {
    mockTaskRunner.cancel.mockRejectedValue(new Error('not found'))

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'cancel', task_id: 'task-1' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not found')
  })

  it('未知 action → 返回 isError', async () => {
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'unknown' } })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
  })

  it("action='cancel' 返回 false（无法取消） → 返回无法取消提示", async () => {
    mockTaskRunner.cancel.mockResolvedValue(false)

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'cancel', task_id: 'task-done-already' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('无法取消')
  })

  it("action='result' 任务不存在 → 返回不可用", async () => {
    mockTaskRunner.getStatus.mockReturnValue(null)

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'result', task_id: 'nonexistent' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('不可用')
    expect(result.text).toContain('不存在')
  })

  it("action='status' 任务不存在 → 返回未找到", async () => {
    mockTaskRunner.getStatus.mockReturnValue(null)

    const ctx = makeCtx({
      toolName: 'prizm_task_status',
      args: { action: 'status', task_id: 'nonexistent' }
    })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('未找到')
  })
})

describe('executeSpawnTask — 补充场景', () => {
  it('带 expected_output 参数 → 传递到 expectedOutputFormat', async () => {
    mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-eo-1' })

    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '任务', expected_output: 'JSON 格式' }
    })
    await executeSpawnTask(ctx)

    const triggerCall = mockTaskRunner.trigger.mock.calls[0]
    const input = triggerCall[1]
    expect(input.expectedOutputFormat).toBe('JSON 格式')
  })

  it('带 context 对象参数（字符串 JSON） → 正确传递', async () => {
    mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-ctx-1' })

    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '任务', context: '{"data":"value","count":5}' }
    })
    await executeSpawnTask(ctx)

    const triggerCall = mockTaskRunner.trigger.mock.calls[0]
    const input = triggerCall[1]
    expect(input.context).toEqual({ data: 'value', count: 5 })
  })
})

// ─── Dynamic Output Schema (ioConfig) ───

describe('executeSetResult — 动态 output schema 模式', () => {
  it('有 ioConfig.outputParams 时，将 schema 字段打包为 structuredData', async () => {
    seedSession({
      id: 'sess-io-1',
      scope: 'default',
      messages: [],
      kind: 'background',
      bgMeta: {
        triggerType: 'event_hook',
        ioConfig: {
          outputParams: {
            schema: {
              summary: { type: 'string', description: '摘要' },
              tags: { type: 'string', description: '标签' }
            },
            required: ['summary']
          }
        }
      }
    } as any)

    const ctx = makeCtx({
      sessionId: 'sess-io-1',
      args: { summary: 'AI 趋势摘要', tags: '["ai","ml"]', status: 'success' }
    })
    const res = await executeSetResult(ctx)

    expect(res.isError).toBeFalsy()
    expect(res.text).toContain('结果已提交')

    const session = mockScopeStore._sessions.get('sess-io-1') as any
    expect(session.bgResult).toBe('AI 趋势摘要')
    expect(session.bgStructuredData).toBe(JSON.stringify({ summary: 'AI 趋势摘要', tags: '["ai","ml"]' }))
    expect(session.bgStatus).toBe('completed')
  })

  it('动态模式下无输出字段时返回错误', async () => {
    seedSession({
      id: 'sess-io-2',
      scope: 'default',
      messages: [],
      kind: 'background',
      bgMeta: {
        triggerType: 'event_hook',
        ioConfig: {
          outputParams: {
            schema: {
              result: { type: 'string', description: '结果' }
            }
          }
        }
      }
    } as any)

    const ctx = makeCtx({
      sessionId: 'sess-io-2',
      args: { status: 'success' }
    })
    const res = await executeSetResult(ctx)

    expect(res.isError).toBe(true)
    expect(res.text).toContain('至少需要提供一个输出字段')
  })

  it('动态模式下第一个字符串字段作为 bgResult', async () => {
    seedSession({
      id: 'sess-io-3',
      scope: 'default',
      messages: [],
      kind: 'background',
      bgMeta: {
        triggerType: 'event_hook',
        ioConfig: {
          outputParams: {
            schema: {
              count: { type: 'number', description: '数量' },
              text: { type: 'string', description: '文本' }
            }
          }
        }
      }
    } as any)

    const ctx = makeCtx({
      sessionId: 'sess-io-3',
      args: { count: 42, text: '测试文本' }
    })
    await executeSetResult(ctx)

    const session = mockScopeStore._sessions.get('sess-io-3') as any
    expect(session.bgResult).toBe('测试文本')
  })

  it('无 ioConfig 时使用默认模式', async () => {
    seedSession({
      id: 'sess-default-1',
      scope: 'default',
      messages: [],
      kind: 'background',
      bgMeta: { triggerType: 'event_hook' }
    } as any)

    const ctx = makeCtx({
      sessionId: 'sess-default-1',
      args: { output: '默认输出', status: 'success' }
    })
    const res = await executeSetResult(ctx)

    expect(res.isError).toBeFalsy()
    const session = mockScopeStore._sessions.get('sess-default-1') as any
    expect(session.bgResult).toBe('默认输出')
    expect(session.bgStructuredData).toBeUndefined()
  })
})
