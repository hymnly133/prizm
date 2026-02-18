/**
 * 后台会话跨模块集成测试
 *
 * 使用真实 EventBus + Mock IAgentAdapter,
 * 验证完整 BG Session 生命周期、结果守卫、超时、取消、事件链、并发限制、嵌套深度、记忆豁免。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentSession } from '@prizm/shared'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import { BackgroundSessionManager } from './manager'
import { emit, subscribe, clearAll } from '../eventBus/eventBus'

function createMockAdapter(): IAgentAdapter & { _sessions: Map<string, AgentSession> } {
  const sessions = new Map<string, AgentSession>()
  let idCounter = 0
  return {
    _sessions: sessions,
    createSession: vi.fn(async (scope: string) => {
      const session: AgentSession = {
        id: `int-bg-${++idCounter}`,
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

describe('BG Session 集成测试', () => {
  let mgr: BackgroundSessionManager
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    clearAll()
    mgr = new BackgroundSessionManager()
    adapter = createMockAdapter()
    mgr.init(adapter)
  })

  afterEach(() => {
    mgr.shutdown()
    clearAll()
    vi.useRealTimers()
  })

  // ─── 场景 A：完整 BG Session 生命周期 ───

  describe('场景 A：完整 BG Session 生命周期', () => {
    it('trigger → running → set_result → completed → getResult', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = adapter._sessions.get(sid)
        if (session) {
          session.bgResult = '集成测试报告'
          session.bgStatus = 'completed'
          session.finishedAt = Date.now()
        }
        yield { text: 'ok' }
      })

      const { sessionId, promise } = await mgr.trigger(
        'default',
        { prompt: '执行分析' },
        { label: '集成测试A' }
      )

      expect(sessionId).toBeTruthy()

      const session = adapter._sessions.get(sessionId)!
      expect(session.kind).toBe('background')
      expect(session.bgStatus).toBeDefined()

      const result = await promise

      expect(result.status).toBe('success')
      expect(result.output).toBe('集成测试报告')

      const fetchedResult = await mgr.getResult('default', sessionId)
      expect(fetchedResult).not.toBeNull()
      expect(fetchedResult!.output).toBe('集成测试报告')
      expect(fetchedResult!.status).toBe('success')
    })
  })

  // ─── 场景 B：结果守卫完整流程 ───

  describe('场景 B：结果守卫完整流程', () => {
    it('chat 未调用 set_result → 守卫提醒 → 仍未设置 → fallback 降级', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      let callCount = 0
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        callCount++
        const session = adapter._sessions.get(sid)
        if (session && callCount === 1) {
          session.messages.push({
            id: `msg-${callCount}`,
            role: 'assistant',
            parts: [{ type: 'text', content: '我已完成分析但忘记提交结果' }],
            createdAt: Date.now()
          })
        }
        yield { text: '回复' }
      })

      const { promise } = await mgr.trigger(
        'default',
        { prompt: '分析数据' },
        { label: '守卫测试' }
      )

      const result = await promise
      expect(callCount).toBe(2)
      expect(result.output).toBeTruthy()
      expect(result.status).toBe('success')
    })
  })

  // ─── 场景 C：超时场景 ───

  describe('场景 C：超时场景', () => {
    it('timeoutMs=100 + chat 延迟 → bgStatus=timeout', async () => {
      let resolveBlock!: () => void
      const blockPromise = new Promise<void>((r) => { resolveBlock = r })
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await blockPromise
        yield { text: 'late' }
      })

      const { sessionId, promise } = await mgr.trigger(
        'default',
        { prompt: '慢任务' },
        { timeoutMs: 100 }
      )

      await vi.advanceTimersByTimeAsync(200)

      resolveBlock()
      const result = await promise

      expect(result.status).toBe('timeout')
      expect(result.output).toContain('超时')
    })
  })

  // ─── 场景 D：取消场景 ───

  describe('场景 D：取消场景', () => {
    it('trigger + 立即 cancel → bgStatus=cancelled', async () => {
      let resolveBlock!: () => void
      const blockPromise = new Promise<void>((r) => { resolveBlock = r })
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        await blockPromise
        yield { text: 'done' }
      })

      const { sessionId, promise } = await mgr.trigger(
        'default',
        { prompt: '取消任务' },
        {}
      )

      await mgr.cancel('default', sessionId)
      resolveBlock()

      const result = await promise
      expect(result.status).toBe('cancelled')
    })
  })

  // ─── 场景 E：EventBus 事件链 ───

  describe('场景 E：EventBus 事件链', () => {
    it('trigger → bg:session.triggered; completed → bg:session.completed', async () => {
      const triggeredEvents: string[] = []
      const completedEvents: string[] = []

      subscribe('bg:session.triggered', (data) => {
        triggeredEvents.push(data.sessionId)
      })
      subscribe('bg:session.completed', (data) => {
        completedEvents.push(data.sessionId)
      })

      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = adapter._sessions.get(sid)
        if (session) {
          session.bgResult = '事件链测试'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      const { sessionId, promise } = await mgr.trigger(
        'default',
        { prompt: '事件测试' },
        {}
      )

      await promise
      // manager 使用 void emit() 异步发射事件，需要等待微任务处理
      await new Promise((r) => setTimeout(r, 0))
      await vi.advanceTimersByTimeAsync(10)

      expect(triggeredEvents).toContain(sessionId)
      expect(completedEvents).toContain(sessionId)
    })
  })

  // ─── 场景 F：并发限制 ───

  describe('场景 F：并发限制', () => {
    it('maxGlobal=2 → 第 3 个触发失败 → 取消 1 个后可以触发', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxGlobal: 2, maxDepth: 5 })

      let resolveBlock1!: () => void
      let resolveBlock2!: () => void
      const block1 = new Promise<void>((r) => { resolveBlock1 = r })
      const block2 = new Promise<void>((r) => { resolveBlock2 = r })
      let callIdx = 0

      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* () {
        const idx = callIdx++
        if (idx === 0) await block1
        else if (idx === 1) await block2
        yield { text: 'ok' }
      })

      const { sessionId: id1 } = await mgr2.trigger('default', { prompt: '任务1' }, {})
      const { sessionId: id2 } = await mgr2.trigger('default', { prompt: '任务2' }, {})
      expect(mgr2.activeCount).toBe(2)

      await expect(
        mgr2.trigger('default', { prompt: '任务3' }, {})
      ).rejects.toThrow('global concurrency limit')

      await mgr2.cancel('default', id1)
      resolveBlock1()
      expect(mgr2.activeCount).toBe(1)

      await expect(
        mgr2.trigger('default', { prompt: '任务3-retry' }, {})
      ).resolves.toBeTruthy()

      resolveBlock2()
      mgr2.shutdown()
    })
  })

  // ─── 场景 G：嵌套深度限制 ───

  describe('场景 G：嵌套深度限制', () => {
    it('maxDepth=1 → depth=0 成功, depth=1 失败', async () => {
      const mgr2 = new BackgroundSessionManager()
      mgr2.init(adapter, { maxDepth: 1 })

      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = adapter._sessions.get(sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      await expect(
        mgr2.trigger('default', { prompt: '顶层' }, { depth: 0 })
      ).resolves.toBeTruthy()

      await expect(
        mgr2.trigger('default', { prompt: '嵌套' }, { depth: 1 })
      ).rejects.toThrow('max nesting depth')

      mgr2.shutdown()
    })
  })

  // ─── 场景 H：记忆豁免验证 ───

  describe('场景 H：记忆豁免验证', () => {
    it('默认 memoryPolicy: skipPerRoundExtract=true, skipConversationSummary=true', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = adapter._sessions.get(sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      const { sessionId } = await mgr.trigger('default', { prompt: '默认策略' }, {})
      const session = adapter._sessions.get(sessionId)!

      expect(session.bgMeta?.memoryPolicy?.skipPerRoundExtract).toBe(true)
      expect(session.bgMeta?.memoryPolicy?.skipConversationSummary).toBe(true)
      expect(session.bgMeta?.memoryPolicy?.skipDocumentExtract).toBe(false)
    })

    it('自定义 memoryPolicy 覆盖默认值', async () => {
      const chatMock = adapter.chat as ReturnType<typeof vi.fn>
      chatMock.mockImplementation(async function* (_s: string, sid: string) {
        const session = adapter._sessions.get(sid)
        if (session) {
          session.bgResult = 'ok'
          session.bgStatus = 'completed'
        }
        yield { text: 'ok' }
      })

      const { sessionId } = await mgr.trigger(
        'default',
        { prompt: '自定义策略' },
        { memoryPolicy: { skipPerRoundExtract: false, skipDocumentExtract: true } }
      )
      const session = adapter._sessions.get(sessionId)!

      expect(session.bgMeta?.memoryPolicy?.skipPerRoundExtract).toBe(false)
      expect(session.bgMeta?.memoryPolicy?.skipDocumentExtract).toBe(true)
      expect(session.bgMeta?.memoryPolicy?.skipConversationSummary).toBe(true)
    })
  })
})
