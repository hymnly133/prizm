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

vi.mock('../../core/backgroundSession', () => ({
  bgSessionManager: {
    trigger: vi.fn(),
    triggerSync: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getResult: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false)
  }
}))

import { executeSetResult, executeSpawnTask, executeTaskStatus } from './taskTools'
import { scopeStore } from '../../core/ScopeStore'
import { bgSessionManager } from '../../core/backgroundSession'

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
})

describe('executeSetResult', () => {
  it('正常 BG session 调用 → 写入 bgResult + bgStatus + finishedAt', async () => {
    const session: AgentSession = {
      id: 'sess-1', scope: 'default', kind: 'background', bgStatus: 'running',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
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
      id: 'sess-1', scope: 'default',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
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
      id: 'sess-1', scope: 'default', kind: 'background', bgStatus: 'running',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
    })

    const ctx = makeCtx({ args: { output: '  ' } })
    const result = await executeSetResult(ctx)
    expect(result.isError).toBe(true)
  })

  it('status=failed → bgStatus 设为 failed', async () => {
    const session: AgentSession = {
      id: 'sess-1', scope: 'default', kind: 'background', bgStatus: 'running',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
    }
    seedSession(session)

    const ctx = makeCtx({ args: { output: '错误信息', status: 'failed' } })
    await executeSetResult(ctx)
    expect(session.bgStatus).toBe('failed')
  })

  it('带 structured_data → 返回信息包含附加提示', async () => {
    seedSession({
      id: 'sess-1', scope: 'default', kind: 'background', bgStatus: 'running',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
    })

    const ctx = makeCtx({
      args: { output: '结果', structured_data: '{"key":"value"}' }
    })
    const result = await executeSetResult(ctx)
    expect(result.text).toContain('结构化数据')
  })

  it('验证 emitAudit 被调用', async () => {
    seedSession({
      id: 'sess-1', scope: 'default', kind: 'background', bgStatus: 'running',
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
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
    ;(bgSessionManager.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-child-1',
      promise: Promise.resolve({ status: 'success', output: 'done' })
    })

    const ctx = makeCtx({
      toolName: 'prizm_spawn_task',
      args: { task: '分析数据', mode: 'async', label: '数据分析' }
    })
    const result = await executeSpawnTask(ctx)

    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('bg-child-1')
    expect(result.text).toContain('异步执行中')
  })

  it('同步模式：mock triggerSync → 返回完整结果', async () => {
    ;(bgSessionManager.triggerSync as ReturnType<typeof vi.fn>).mockResolvedValue({
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

  it('bgSessionManager.trigger 抛错 → 返回 isError', async () => {
    ;(bgSessionManager.trigger as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('concurrency limit')
    )

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '任务' } })
    const result = await executeSpawnTask(ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('concurrency limit')
  })

  it('验证 parentDepth 递增', async () => {
    seedSession({
      id: 'sess-1', scope: 'default', kind: 'background',
      bgMeta: { triggerType: 'tool_spawn', depth: 1 } as any,
      messages: [], createdAt: Date.now(), updatedAt: Date.now()
    })

    ;(bgSessionManager.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-child-2',
      promise: Promise.resolve({ status: 'success' })
    })

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '子任务' } })
    await executeSpawnTask(ctx)

    const triggerCall = (bgSessionManager.trigger as ReturnType<typeof vi.fn>).mock.calls[0]
    const meta = triggerCall[2]
    expect(meta.depth).toBe(2)
  })

  it('验证 emitAudit 被调用', async () => {
    ;(bgSessionManager.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-child-3',
      promise: Promise.resolve({ status: 'success' })
    })

    const ctx = makeCtx({ toolName: 'prizm_spawn_task', args: { task: '任务' } })
    await executeSpawnTask(ctx)
    expect(ctx.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'spawn', toolName: 'prizm_spawn_task' })
    )
  })
})

describe('executeTaskStatus', () => {
  it("action='list' → 调用 bgSessionManager.list", async () => {
    ;(bgSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'bg-1', kind: 'background', bgStatus: 'running',
        bgMeta: { label: '任务A' }, messages: [], createdAt: 0, updatedAt: 0, scope: 'default'
      }
    ])

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'list' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('任务A')
    expect(result.text).toContain('1')
  })

  it("action='list' 无子任务 → 返回当前无子任务", async () => {
    ;(bgSessionManager.list as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'list' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('当前无子任务')
  })

  it("action='status' 有结果 → 返回状态摘要", async () => {
    ;(bgSessionManager.getResult as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-1', status: 'success', output: '完成', durationMs: 1000
    })

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'status', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('success')
    expect(result.text).toContain('1000ms')
  })

  it("action='status' 运行中 → 返回执行中", async () => {
    ;(bgSessionManager.getResult as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(bgSessionManager.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true)

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'status', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('正在执行中')
  })

  it("action='status' 无 task_id → 返回 isError", async () => {
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'status' } })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
  })

  it("action='result' 有结果 → 返回 output", async () => {
    ;(bgSessionManager.getResult as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-1', status: 'success', output: '详细结果内容', durationMs: 500
    })

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'result', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('详细结果内容')
  })

  it("action='result' 无结果 → 返回不可用", async () => {
    ;(bgSessionManager.getResult as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'result', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('不可用')
  })

  it("action='cancel' → 调用 bgSessionManager.cancel", async () => {
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'cancel', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.text).toContain('已取消')
    expect(bgSessionManager.cancel).toHaveBeenCalledWith('default', 'bg-1')
  })

  it("action='cancel' 失败 → 返回 isError", async () => {
    ;(bgSessionManager.cancel as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('not found')
    )

    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'cancel', task_id: 'bg-1' } })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not found')
  })

  it('未知 action → 返回 isError', async () => {
    const ctx = makeCtx({ toolName: 'prizm_task_status', args: { action: 'unknown' } })
    const result = await executeTaskStatus(ctx)
    expect(result.isError).toBe(true)
  })
})
