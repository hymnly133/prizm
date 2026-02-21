/**
 * bgSessionStepExecutor.test.ts — BG Session 步骤执行器
 *
 * 覆盖：
 * - 成功执行 → 正确映射 StepExecutionOutput
 * - workspaceDir 传递到 bgManager.trigger meta
 * - 无 workspaceDir 时 meta.workspaceDir 为 undefined
 * - 各 status 映射（success / failed / timeout / cancelled）
 * - structuredData 透传
 * - label / model / timeoutMs 参数透传
 * - bgManager 抛异常时向上传播
 * - 默认 label 为 'workflow-step'
 * - autoCleanup 始终为 true
 * - onSessionCreated 在 session 创建后被调用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BgSessionStepExecutor } from './bgSessionStepExecutor'
import type { StepExecutionInput } from './types'
import type { BackgroundSessionManager } from '../backgroundSession/manager'

const DEFAULT_RESULT = {
  sessionId: 'bg-sess-1',
  status: 'success' as const,
  output: '执行结果',
  structuredData: undefined,
  durationMs: 500
}

function createMockBgManager() {
  return {
    trigger: vi.fn().mockImplementation(async () => ({
      sessionId: DEFAULT_RESULT.sessionId,
      promise: Promise.resolve(DEFAULT_RESULT)
    }))
  } as unknown as BackgroundSessionManager
}

let mockBg: ReturnType<typeof createMockBgManager>
let executor: BgSessionStepExecutor

beforeEach(() => {
  vi.clearAllMocks()
  mockBg = createMockBgManager()
  executor = new BgSessionStepExecutor(mockBg)
})

describe('BgSessionStepExecutor.execute', () => {
  it('成功执行 → 返回正确的 StepExecutionOutput', async () => {
    const result = await executor.execute('default', {
      prompt: '分析数据'
    })

    expect(result.sessionId).toBe('bg-sess-1')
    expect(result.status).toBe('success')
    expect(result.output).toBe('执行结果')
    expect(result.durationMs).toBe(500)
  })

  it('应传递 workspaceDir 到 trigger meta', async () => {
    const input: StepExecutionInput = {
      prompt: '生成报告',
      workspaceDir: '/path/to/workflow/workspace'
    }
    await executor.execute('default', input)

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    expect(triggerFn).toHaveBeenCalledTimes(1)

    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.workspaceDir).toBe('/path/to/workflow/workspace')
  })

  it('无 workspaceDir 时 meta.workspaceDir 为 undefined', async () => {
    await executor.execute('default', { prompt: '任务' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.workspaceDir).toBeUndefined()
  })

  it('应传递 prompt 到 payload', async () => {
    await executor.execute('scope-x', { prompt: '具体任务描述' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [scope, payload] = triggerFn.mock.calls[0]
    expect(scope).toBe('scope-x')
    expect(payload.prompt).toBe('具体任务描述')
  })

  it('应传递 systemInstructions 和 expectedOutputFormat', async () => {
    await executor.execute('default', {
      prompt: '任务',
      systemInstructions: '你是助手',
      expectedOutputFormat: 'JSON'
    })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, payload] = triggerFn.mock.calls[0]
    expect(payload.systemInstructions).toBe('你是助手')
    expect(payload.expectedOutputFormat).toBe('JSON')
  })

  it('应传递 context 对象', async () => {
    await executor.execute('default', {
      prompt: '任务',
      context: { key: 'value' }
    })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, payload] = triggerFn.mock.calls[0]
    expect(payload.context).toEqual({ key: 'value' })
  })

  it('应传递 label 到 meta（自定义值）', async () => {
    await executor.execute('default', {
      prompt: '任务',
      label: 'workflow:analyze'
    })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.label).toBe('workflow:analyze')
  })

  it('无 label 时使用默认值 workflow-step', async () => {
    await executor.execute('default', { prompt: '任务' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.label).toBe('workflow-step')
  })

  it('应传递 model 到 meta', async () => {
    await executor.execute('default', { prompt: '任务', model: 'gpt-4' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.model).toBe('gpt-4')
  })

  it('应传递 timeoutMs 到 meta', async () => {
    await executor.execute('default', { prompt: '任务', timeoutMs: 60000 })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.timeoutMs).toBe(60000)
  })

  it('meta.triggerType 始终为 event_hook', async () => {
    await executor.execute('default', { prompt: '任务' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.triggerType).toBe('event_hook')
  })

  it('meta.autoCleanup 始终为 true', async () => {
    await executor.execute('default', { prompt: '任务' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.autoCleanup).toBe(true)
  })

  it('failed 状态 → 正确映射', async () => {
    ;(mockBg.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-2',
      promise: Promise.resolve({
        sessionId: 'bg-2',
        status: 'failed',
        output: '执行失败',
        durationMs: 200
      })
    })

    const result = await executor.execute('default', { prompt: '任务' })
    expect(result.status).toBe('failed')
    expect(result.output).toBe('执行失败')
  })

  it('timeout 状态 → 正确映射', async () => {
    ;(mockBg.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-3',
      promise: Promise.resolve({
        sessionId: 'bg-3',
        status: 'timeout',
        output: '超时',
        durationMs: 30000
      })
    })

    const result = await executor.execute('default', { prompt: '任务' })
    expect(result.status).toBe('timeout')
  })

  it('structuredData 透传', async () => {
    ;(mockBg.trigger as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 'bg-4',
      promise: Promise.resolve({
        sessionId: 'bg-4',
        status: 'success',
        output: 'ok',
        structuredData: '{"key":"val"}',
        durationMs: 100
      })
    })

    const result = await executor.execute('default', { prompt: '任务' })
    expect(result.structuredData).toBe('{"key":"val"}')
  })

  it('bgManager 抛异常时应向上传播', async () => {
    ;(mockBg.trigger as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('连接失败')
    )

    await expect(executor.execute('default', { prompt: '任务' })).rejects.toThrow('连接失败')
  })

  it('inputParams 应传递到 payload.inputParams', async () => {
    const input: StepExecutionInput = {
      prompt: '执行任务',
      inputParams: {
        schema: { topic: { type: 'string', description: '主题' } },
        values: { topic: 'AI' }
      }
    }
    await executor.execute('default', input)

    const call = (mockBg.trigger as ReturnType<typeof vi.fn>).mock.calls[0]
    const payload = call[1]
    expect(payload.inputParams).toEqual(input.inputParams)
  })

  it('outputParams 应映射到 meta.ioConfig', async () => {
    const input: StepExecutionInput = {
      prompt: '生成结果',
      outputParams: {
        schema: { summary: { type: 'string', description: '摘要' } },
        required: ['summary']
      }
    }
    await executor.execute('default', input)

    const call = (mockBg.trigger as ReturnType<typeof vi.fn>).mock.calls[0]
    const meta = call[2]
    expect(meta.ioConfig).toBeDefined()
    expect(meta.ioConfig.outputParams).toEqual(input.outputParams)
  })

  it('inputParams + outputParams 同时存在时 ioConfig 包含两者', async () => {
    const input: StepExecutionInput = {
      prompt: '完整任务',
      inputParams: {
        schema: { topic: { type: 'string', description: '主题' } },
        values: { topic: 'AI' }
      },
      outputParams: {
        schema: { result: { type: 'string', description: '结果' } },
        required: ['result']
      }
    }
    await executor.execute('default', input)

    const call = (mockBg.trigger as ReturnType<typeof vi.fn>).mock.calls[0]
    const meta = call[2]
    expect(meta.ioConfig.inputParams).toEqual(input.inputParams)
    expect(meta.ioConfig.outputParams).toEqual(input.outputParams)
  })

  it('无 inputParams/outputParams 时 meta.ioConfig 为 undefined', async () => {
    await executor.execute('default', { prompt: '简单任务' })

    const call = (mockBg.trigger as ReturnType<typeof vi.fn>).mock.calls[0]
    const meta = call[2]
    expect(meta.ioConfig).toBeUndefined()
  })

  it('应传递 persistentWorkspaceDir 到 meta', async () => {
    const input: StepExecutionInput = {
      prompt: '工作流任务',
      workspaceDir: '/path/to/run-workspace',
      persistentWorkspaceDir: '/path/to/persistent-workspace'
    }
    await executor.execute('default', input)

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.workspaceDir).toBe('/path/to/run-workspace')
    expect(meta.persistentWorkspaceDir).toBe('/path/to/persistent-workspace')
  })

  it('无 persistentWorkspaceDir 时 meta.persistentWorkspaceDir 为 undefined', async () => {
    await executor.execute('default', { prompt: '任务' })

    const triggerFn = mockBg.trigger as ReturnType<typeof vi.fn>
    const [, , meta] = triggerFn.mock.calls[0]
    expect(meta.persistentWorkspaceDir).toBeUndefined()
  })

  it('onSessionCreated 在 session 创建后被调用', async () => {
    const onSessionCreated = vi.fn()
    await executor.execute('default', { prompt: '任务', onSessionCreated })

    expect(onSessionCreated).toHaveBeenCalledTimes(1)
    expect(onSessionCreated).toHaveBeenCalledWith('bg-sess-1')
  })
})
