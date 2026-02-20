/**
 * BackgroundSessionManager 核心逻辑单元测试
 *
 * executeRun 通过 chatCore() 统一对话核心执行，
 * 本测试 mock chatCore 模块验证编排逻辑。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentSession } from '@prizm/shared'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import { BackgroundSessionManager } from './manager'

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

import { emit } from '../eventBus/eventBus'
import type { IChatService } from '../interfaces'
const mockEmit = emit as ReturnType<typeof vi.fn>
const mockChatCore = vi.fn()
const mockChatService: IChatService = { execute: mockChatCore }

function createMockAdapter(): IAgentAdapter {
  const sessions = new Map<string, AgentSession>()
  let idCounter = 0
  return {
    createSession: vi.fn(async (scope: string) => {
      const session: AgentSession = {
        id: `bg-sess-${++idCounter}`,
        scope,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      sessions.set(session.id, session)
      return session
    }),
    getSession: vi.fn(async (_scope: string, id: string) => sessions.get(id) ?? null),
    listSessions: vi.fn(async () => [...sessions.values()]),
    updateSession: vi.fn(async (_scope: string, id: string, update: Partial<AgentSession>) => {
      const s = sessions.get(id)
      if (!s) throw new Error('not found')
      Object.assign(s, update, { updatedAt: Date.now() })
      return { ...s }
    }),
    appendMessage: vi.fn(async (_scope: string, _sessionId: string, msg: Record<string, unknown>) => ({
      id: `msg-${Date.now()}`,
      role: msg.role as string,
      parts: msg.parts as unknown[],
      createdAt: Date.now()
    })),
    chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
      yield { text: '已完成任务' }
    })
  }
}

function setupDefaultChatCore(adapter: IAgentAdapter) {
  mockChatCore.mockImplementation(async (_adapter: IAgentAdapter, options: Record<string, unknown>, onChunk: (c: LLMStreamChunk) => void) => {
    const session = await adapter.getSession!('default', options.sessionId as string)
    if (session) {
      session.bgResult = '成功结果'
      session.bgStatus = 'completed'
      session.finishedAt = Date.now()
    }
    onChunk({ text: 'ok' })
    onChunk({ done: true })
    return {
      appendedMsg: { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', content: 'ok' }], createdAt: Date.now() },
      parts: [{ type: 'text', content: 'ok' }],
      reasoning: '',
      usage: undefined,
      memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } },
      injectedMemories: null,
      stopped: false
    }
  })
}

const DEFAULT_PAYLOAD = { prompt: '请分析数据并返回报告' }

describe('BackgroundSessionManager', () => {
  let mgr: BackgroundSessionManager
  let adapter: IAgentAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mgr = new BackgroundSessionManager()
    adapter = createMockAdapter()
    mgr.init(adapter, mockChatService)
  })

  afterEach(async () => {
    await mgr.shutdown()
    vi.useRealTimers()
  })

  // ─── init / shutdown ───

  describe('init / shutdown', () => {
    it('init 设置 adapter 和默认 limits', () => {
      expect(mgr.activeCount).toBe(0)
    })

    it('shutdown abort 所有活跃运行、清理 activeRuns', async () => {
      mockChatCore.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100_000))
        return { appendedMsg: { id: '', role: 'assistant', parts: [], createdAt: 0 }, parts: [], reasoning: '', memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } }, injectedMemories: null, stopped: false }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.activeCount).toBe(1)

      await mgr.shutdown()
      expect(mgr.activeCount).toBe(0)
    })

    it('自定义 limits 合并正确', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, mockChatService, { maxGlobal: 3 })
      await mgr2.shutdown()
    })
  })

  // ─── trigger ───

  describe('trigger — 异步触发', () => {
    it('正常触发：创建 session + 返回 sessionId', async () => {
      setupDefaultChatCore(adapter)
      const { sessionId } = await mgr.trigger('default', DEFAULT_PAYLOAD, {
        label: 'test-task'
      })

      expect(sessionId).toMatch(/^bg-sess-/)
      expect(adapter.createSession).toHaveBeenCalledWith('default')
    })

    it('adapter 不可用时抛错', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(undefined)
      await expect(mgr2.trigger('default', DEFAULT_PAYLOAD, {})).rejects.toThrow(
        'Agent adapter not available'
      )
      await mgr2.shutdown()
    })

    it('trigger 后 activeCount 增加', async () => {
      mockChatCore.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100_000))
        return { appendedMsg: { id: '', role: 'assistant', parts: [], createdAt: 0 }, parts: [], reasoning: '', memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } }, injectedMemories: null, stopped: false }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.activeCount).toBe(1)
    })

    it('默认 memoryPolicy 合并（skipPerRoundExtract=true 等）', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', DEFAULT_PAYLOAD, {})

      const updateCall = (adapter.updateSession as ReturnType<typeof vi.fn>).mock.calls[0]
      const update = updateCall[2]
      expect(update.bgMeta.memoryPolicy).toEqual({
        skipPerRoundExtract: true,
        skipNarrativeBatchExtract: true,
        skipDocumentExtract: false,
        skipConversationSummary: true
      })
    })

    it('自定义 memoryPolicy 覆盖默认值', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', DEFAULT_PAYLOAD, {
        memoryPolicy: { skipDocumentExtract: true }
      })

      const updateCall = (adapter.updateSession as ReturnType<typeof vi.fn>).mock.calls[0]
      const update = updateCall[2]
      expect(update.bgMeta.memoryPolicy.skipDocumentExtract).toBe(true)
      expect(update.bgMeta.memoryPolicy.skipPerRoundExtract).toBe(true)
    })
  })

  // ─── triggerSync ───

  describe('triggerSync — 同步触发', () => {
    it('正常同步执行：返回 BgRunResult', async () => {
      setupDefaultChatCore(adapter)

      const result = await mgr.triggerSync('default', DEFAULT_PAYLOAD, {})
      expect(result.sessionId).toBeTruthy()
      expect(result.status).toBe('success')
    })
  })

  // ─── cancel ───

  describe('cancel', () => {
    it('取消运行中的会话 → bgStatus=cancelled + emit bg:session.cancelled', async () => {
      mockChatCore.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100_000))
        return { appendedMsg: { id: '', role: 'assistant', parts: [], createdAt: 0 }, parts: [], reasoning: '', memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } }, injectedMemories: null, stopped: false }
      })

      const { sessionId, promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})

      await mgr.cancel('default', sessionId)

      expect(mockEmit).toHaveBeenCalledWith('bg:session.cancelled', expect.objectContaining({ sessionId }))

      const result = await promise
      expect(result.status).toBe('cancelled')
      expect(mgr.activeCount).toBe(0)
    })

    it('取消不存在的会话 → 无错误', async () => {
      await expect(mgr.cancel('default', 'nonexistent')).resolves.toBeUndefined()
    })
  })

  // ─── checkConcurrencyLimits ───

  describe('checkConcurrencyLimits（通过 trigger 间接测试）', () => {
    it('达到全局上限 → 抛出错误', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, mockChatService, { maxGlobal: 1 })

      mockChatCore.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100_000))
        return { appendedMsg: { id: '', role: 'assistant', parts: [], createdAt: 0 }, parts: [], reasoning: '', memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } }, injectedMemories: null, stopped: false }
      })

      await mgr2.trigger('default', DEFAULT_PAYLOAD, {})
      await expect(mgr2.trigger('default', DEFAULT_PAYLOAD, {})).rejects.toThrow(
        'global concurrency limit'
      )
      await mgr2.shutdown()
    })

    it('达到嵌套深度上限 → 抛出错误', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, mockChatService, { maxDepth: 1 })

      await expect(
        mgr2.trigger('default', DEFAULT_PAYLOAD, { depth: 1 })
      ).rejects.toThrow('max nesting depth')
      await mgr2.shutdown()
    })

    it('未达上限 → 正常通过', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, mockChatService, { maxGlobal: 5, maxDepth: 3 })
      setupDefaultChatCore(adapter)

      await expect(
        mgr2.trigger('default', DEFAULT_PAYLOAD, { depth: 0 })
      ).resolves.toBeTruthy()
      await mgr2.shutdown()
    })
  })

  // ─── systemPreamble（通过 chatCore 调用参数间接验证）───

  describe('systemPreamble（通过 chatCore 调用参数间接验证）', () => {
    it('仅 prompt → systemPreamble 含 set_result 提醒', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', { prompt: '任务A' }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCoreCall = mockChatCore.mock.calls[0]
      const opts = chatCoreCall[1]
      expect(opts.systemPreamble).toContain('prizm_set_result')
      expect(opts.content).toBe('任务A')
    })

    it('prompt + systemInstructions → systemPreamble 包含自定义指令', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', { prompt: '任务', systemInstructions: '你是数据分析师' }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCoreCall = mockChatCore.mock.calls[0]
      expect(chatCoreCall[1].systemPreamble).toContain('你是数据分析师')
    })

    it('prompt + context → systemPreamble 包含 JSON 上下文', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', { prompt: '任务', context: { key: 'value' } }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCoreCall = mockChatCore.mock.calls[0]
      expect(chatCoreCall[1].systemPreamble).toContain('"key"')
      expect(chatCoreCall[1].systemPreamble).toContain('"value"')
    })

    it('prompt + expectedOutputFormat → systemPreamble 包含格式要求', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger(
        'default',
        { prompt: '任务', expectedOutputFormat: 'JSON 格式输出' },
        {}
      )
      await vi.advanceTimersByTimeAsync(100)

      const chatCoreCall = mockChatCore.mock.calls[0]
      expect(chatCoreCall[1].systemPreamble).toContain('JSON 格式输出')
    })

    it('prompt + label → systemPreamble 包含标签', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', { prompt: '任务' }, { label: '数据报告' })
      await vi.advanceTimersByTimeAsync(100)

      const chatCoreCall = mockChatCore.mock.calls[0]
      expect(chatCoreCall[1].systemPreamble).toContain('数据报告')
    })
  })

  // ─── executeRun 流程 ───

  describe('executeRun 流程（通过 trigger + mock chatCore）', () => {
    it('chatCore 正常完成 + bgResult 已设 → completeRun', async () => {
      setupDefaultChatCore(adapter)

      const { sessionId, promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(result.status).toBe('success')
      expect(result.output).toBe('成功结果')
      expect(mockEmit).toHaveBeenCalledWith(
        'bg:session.completed',
        expect.objectContaining({ sessionId })
      )
    })

    it('chatCore 正常完成 + bgResult 未设 → 触发结果守卫', async () => {
      let callCount = 0
      mockChatCore.mockImplementation(async (_adapter: IAgentAdapter, options: Record<string, unknown>, onChunk: (c: LLMStreamChunk) => void) => {
        callCount++
        if (callCount === 2) {
          const session = await adapter.getSession!('default', options.sessionId as string)
          if (session) {
            session.bgResult = '守卫后补充'
            session.bgStatus = 'completed'
          }
        }
        onChunk({ done: true })
        return {
          appendedMsg: { id: `msg-${callCount}`, role: 'assistant', parts: [{ type: 'text', content: '已完成' }], createdAt: Date.now() },
          parts: [{ type: 'text', content: '已完成' }],
          reasoning: '',
          memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } },
          injectedMemories: null,
          stopped: false
        }
      })

      const { promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(callCount).toBe(2)
      expect(result.output).toBe('守卫后补充')
    })

    it('chatCore 抛出异常 → failRun + emit bg:session.failed', async () => {
      mockChatCore.mockRejectedValue(new Error('LLM 服务不可用'))

      const { sessionId, promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(result.status).toBe('failed')
      expect(result.output).toContain('LLM 服务不可用')
      expect(mockEmit).toHaveBeenCalledWith(
        'bg:session.failed',
        expect.objectContaining({ sessionId, error: 'LLM 服务不可用' })
      )
    })
  })

  // ─── chatCore 选项传递验证 ───

  describe('chatCore 选项传递', () => {
    it('BG 默认 memoryPolicy 映射到 chatCore skip 参数', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      await vi.advanceTimersByTimeAsync(100)

      const opts = mockChatCore.mock.calls[0][1]
      expect(opts.skipCheckpoint).toBe(true)
      expect(opts.skipSummary).toBe(true)
      expect(opts.skipPerRoundExtract).toBe(true)
      expect(opts.skipNarrativeBatchExtract).toBe(true)
      expect(opts.skipSlashCommands).toBe(true)
      expect(opts.skipChatStatus).toBe(true)
    })

    it('自定义 memoryPolicy 正确映射', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', DEFAULT_PAYLOAD, {
        memoryPolicy: { skipConversationSummary: false, skipPerRoundExtract: false }
      })
      await vi.advanceTimersByTimeAsync(100)

      const opts = mockChatCore.mock.calls[0][1]
      expect(opts.skipSummary).toBe(false)
      expect(opts.skipPerRoundExtract).toBe(false)
    })

    it('model 参数正确传递', async () => {
      setupDefaultChatCore(adapter)
      await mgr.trigger('default', DEFAULT_PAYLOAD, { model: 'gpt-4o' })
      await vi.advanceTimersByTimeAsync(100)

      const opts = mockChatCore.mock.calls[0][1]
      expect(opts.model).toBe('gpt-4o')
    })
  })

  // ─── isRunning ───

  describe('isRunning', () => {
    it('运行中返回 true', async () => {
      mockChatCore.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100_000))
        return { appendedMsg: { id: '', role: 'assistant', parts: [], createdAt: 0 }, parts: [], reasoning: '', memoryRefs: { injected: { user: [], scope: [], session: [] }, created: { user: [], scope: [], session: [] } }, injectedMemories: null, stopped: false }
      })

      const { sessionId } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.isRunning(sessionId)).toBe(true)
    })

    it('未运行返回 false', () => {
      expect(mgr.isRunning('nonexistent')).toBe(false)
    })
  })
})
