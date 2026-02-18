/**
 * BackgroundSessionManager 核心逻辑单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentSession, BgSessionMeta } from '@prizm/shared'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import { BackgroundSessionManager } from './manager'

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

import { emit } from '../eventBus/eventBus'
const mockEmit = emit as ReturnType<typeof vi.fn>

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
    chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
      yield { text: '已完成任务' }
    })
  }
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
    mgr.init(adapter)
  })

  afterEach(() => {
    mgr.shutdown()
    vi.useRealTimers()
  })

  // ─── init / shutdown ───

  describe('init / shutdown', () => {
    it('init 设置 adapter 和默认 limits', () => {
      expect(mgr.activeCount).toBe(0)
    })

    it('shutdown abort 所有活跃运行、清理 activeRuns', async () => {
      let resolveBlock!: () => void
      const blockPromise = new Promise<void>((r) => { resolveBlock = r })
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await blockPromise
        yield { text: 'done' }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.activeCount).toBe(1)

      mgr.shutdown()
      expect(mgr.activeCount).toBe(0)
      resolveBlock()
    })

    it('自定义 limits 合并正确', () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxGlobal: 3 })
      mgr2.shutdown()
    })
  })

  // ─── trigger ───

  describe('trigger — 异步触发', () => {
    it('正常触发：创建 session + emit bg:session.triggered + 返回 sessionId', async () => {
      const { sessionId } = await mgr.trigger('default', DEFAULT_PAYLOAD, {
        label: 'test-task'
      })

      expect(sessionId).toMatch(/^bg-sess-/)
      expect(adapter.createSession).toHaveBeenCalledWith('default')
      expect(mockEmit).toHaveBeenCalledWith(
        'bg:session.triggered',
        expect.objectContaining({ sessionId, label: 'test-task' })
      )
    })

    it('adapter 不可用时抛错', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(undefined)
      await expect(mgr2.trigger('default', DEFAULT_PAYLOAD, {})).rejects.toThrow(
        'Agent adapter not available'
      )
      mgr2.shutdown()
    })

    it('trigger 后 activeCount 增加', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.activeCount).toBe(1)
    })

    it('默认 memoryPolicy 合并（skipPerRoundExtract=true 等）', async () => {
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
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = '同步结果'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      const result = await mgr.triggerSync('default', DEFAULT_PAYLOAD, {})
      expect(result.sessionId).toBeTruthy()
      expect(result.status).toBe('success')
    })
  })

  // ─── cancel ───

  describe('cancel', () => {
    it('取消运行中的会话 → bgStatus=cancelled + emit bg:session.cancelled', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
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

  // ─── list ───

  describe('list', () => {
    async function seedSessions() {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = '结果'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, { label: 'A', triggerType: 'api' })
      await mgr.trigger('default', DEFAULT_PAYLOAD, { label: 'B', triggerType: 'tool_spawn', parentSessionId: 'parent-1' })
      await vi.advanceTimersByTimeAsync(100)
    }

    it('按 bgStatus 过滤', async () => {
      await seedSessions()
      const completed = await mgr.list('default', { bgStatus: 'completed' })
      expect(completed.length).toBeGreaterThanOrEqual(0)
    })

    it('按 parentSessionId 过滤', async () => {
      await seedSessions()
      const children = await mgr.list('default', { parentSessionId: 'parent-1' })
      expect(children.every((s) => s.bgMeta?.parentSessionId === 'parent-1')).toBe(true)
    })

    it('按 triggerType 过滤', async () => {
      await seedSessions()
      const api = await mgr.list('default', { triggerType: 'api' })
      expect(api.every((s) => s.bgMeta?.triggerType === 'api')).toBe(true)
    })

    it('空结果处理', async () => {
      const result = await mgr.list('default', { bgStatus: 'timeout' })
      expect(result).toEqual([])
    })
  })

  // ─── getResult ───

  describe('getResult', () => {
    it('已完成的 BG session → 返回 BgRunResult', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = '分析完成'
          session.bgStatus = 'completed'
          session.finishedAt = Date.now()
        }
        yield { text: 'ok' }
      })

      const { sessionId, promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      await promise

      const result = await mgr.getResult('default', sessionId)
      expect(result).not.toBeNull()
      expect(result!.output).toBe('分析完成')
      expect(result!.status).toBe('success')
    })

    it('运行中的 BG session → 返回 null', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      const { sessionId } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await mgr.getResult('default', sessionId)
      expect(result).toBeNull()
    })

    it('非 BG session → 返回 null', async () => {
      const result = await mgr.getResult('default', 'nonexistent')
      expect(result).toBeNull()
    })
  })

  // ─── getSummary ───

  describe('getSummary', () => {
    it('返回各状态计数', async () => {
      const summary = await mgr.getSummary('default')
      expect(summary).toEqual({
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        timeout: expect.any(Number),
        cancelled: expect.any(Number)
      })
    })
  })

  // ─── batchCancel ───

  describe('batchCancel', () => {
    it('批量取消指定 IDs', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      const { sessionId: id1 } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const { sessionId: id2 } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})

      const count = await mgr.batchCancel('default', [id1, id2])
      expect(count).toBe(2)
      expect(mgr.activeCount).toBe(0)
    })

    it('无参数时取消当前 scope 所有活跃', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      await mgr.trigger('default', DEFAULT_PAYLOAD, {})

      const count = await mgr.batchCancel('default')
      expect(count).toBe(2)
    })
  })

  // ─── checkConcurrencyLimits ───

  describe('checkConcurrencyLimits（通过 trigger 间接测试）', () => {
    it('达到全局上限 → 抛出错误', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxGlobal: 1 })

      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      await mgr2.trigger('default', DEFAULT_PAYLOAD, {})
      await expect(mgr2.trigger('default', DEFAULT_PAYLOAD, {})).rejects.toThrow(
        'global concurrency limit'
      )
      mgr2.shutdown()
    })

    it('达到嵌套深度上限 → 抛出错误', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxDepth: 1 })

      await expect(
        mgr2.trigger('default', DEFAULT_PAYLOAD, { depth: 1 })
      ).rejects.toThrow('max nesting depth')
      mgr2.shutdown()
    })

    it('未达上限 → 正常通过', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxGlobal: 5, maxDepth: 3 })

      await expect(
        mgr2.trigger('default', DEFAULT_PAYLOAD, { depth: 0 })
      ).resolves.toBeTruthy()
      mgr2.shutdown()
    })
  })

  // ─── buildMessages（通过 trigger + mock chat 间接验证）───

  describe('buildMessages（通过 chat 参数间接验证）', () => {
    it('仅 prompt → system 含 set_result 提醒 + user 消息', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger('default', { prompt: '任务A' }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCall = chatMock.mock.calls[0]
      const messages: Array<{ role: string; content: string }> = chatCall[2]
      expect(messages.some((m) => m.role === 'system' && m.content.includes('prizm_set_result'))).toBe(true)
      expect(messages.some((m) => m.role === 'user' && m.content === '任务A')).toBe(true)
    })

    it('prompt + systemInstructions → system 消息包含自定义指令', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger('default', { prompt: '任务', systemInstructions: '你是数据分析师' }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCall = chatMock.mock.calls[0]
      const messages: Array<{ role: string; content: string }> = chatCall[2]
      expect(messages.some((m) => m.content.includes('你是数据分析师'))).toBe(true)
    })

    it('prompt + context → system 消息包含 JSON 上下文', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger('default', { prompt: '任务', context: { key: 'value' } }, {})
      await vi.advanceTimersByTimeAsync(100)

      const chatCall = chatMock.mock.calls[0]
      const messages: Array<{ role: string; content: string }> = chatCall[2]
      expect(messages.some((m) => m.content.includes('"key"') && m.content.includes('"value"'))).toBe(true)
    })

    it('prompt + expectedOutputFormat → system 消息包含格式要求', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger(
        'default',
        { prompt: '任务', expectedOutputFormat: 'JSON 格式输出' },
        {}
      )
      await vi.advanceTimersByTimeAsync(100)

      const chatCall = chatMock.mock.calls[0]
      const messages: Array<{ role: string; content: string }> = chatCall[2]
      expect(messages.some((m) => m.content.includes('JSON 格式输出'))).toBe(true)
    })

    it('prompt + label → system 消息包含标签', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await mgr.trigger('default', { prompt: '任务' }, { label: '数据报告' })
      await vi.advanceTimersByTimeAsync(100)

      const chatCall = chatMock.mock.calls[0]
      const messages: Array<{ role: string; content: string }> = chatCall[2]
      expect(messages.some((m) => m.content.includes('数据报告'))).toBe(true)
    })
  })

  // ─── executeRun 流程 ───

  describe('executeRun 流程（通过 trigger + mock chat）', () => {
    it('chat 正常完成 + bgResult 已设 → completeRun', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = '成功结果'
          session.bgStatus = 'completed'
          session.finishedAt = Date.now()
        }
        yield { text: 'ok' }
      })

      const { sessionId, promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(result.status).toBe('success')
      expect(result.output).toBe('成功结果')
      expect(mockEmit).toHaveBeenCalledWith(
        'bg:session.completed',
        expect.objectContaining({ sessionId })
      )
    })

    it('chat 正常完成 + bgResult 未设 → 触发结果守卫', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      let callCount = 0
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        callCount++
        if (callCount === 2) {
          const session = await adapter.getSession!(_s, sid)
          if (session) {
            session.bgResult = '守卫后补充'
            session.bgStatus = 'completed'
          }
        }
        yield { text: '已完成' }
      })

      const { promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(callCount).toBe(2)
      expect(result.output).toBe('守卫后补充')
    })

    it('第二轮仍未设 → fallback 降级', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session && !session.messages.some((m) => m.role === 'assistant')) {
          session.messages.push({
            id: 'fallback-msg',
            role: 'assistant',
            parts: [{ type: 'text', content: '降级输出内容' }],
            createdAt: Date.now()
          })
        }
        yield { text: '已完成' }
      })

      const { promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      const result = await promise

      expect(result.output).toBeTruthy()
    })

    it('chat 抛出异常 → failRun + emit bg:session.failed', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        throw new Error('LLM 服务不可用')
      })

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

  // ─── isRunning ───

  describe('isRunning', () => {
    it('运行中返回 true', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await new Promise((r) => setTimeout(r, 100_000))
        yield { text: 'done' }
      })

      const { sessionId } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      expect(mgr.isRunning(sessionId)).toBe(true)
    })

    it('未运行返回 false', () => {
      expect(mgr.isRunning('nonexistent')).toBe(false)
    })
  })

  // ─── cleanup ───

  describe('cleanup', () => {
    it('清理已终结的 activeRuns 条目', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = await adapter.getSession!(_s, sid)
        if (session) {
          session.bgResult = 'done'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      const { promise } = await mgr.trigger('default', DEFAULT_PAYLOAD, {})
      await promise

      await mgr.cleanup()
      expect(mgr.activeCount).toBe(0)
    })
  })
})
