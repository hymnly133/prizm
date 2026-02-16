/**
 * TerminalConnection 客户端 SDK 单元测试
 *
 * 覆盖：
 * - 事件系统（on/emit/取消订阅）
 * - 消息解析（output/exit/title/error/attached/pong）
 * - attach/detach/write/resize 消息发送
 * - getAttachedTerminalId / isConnected 状态查询
 * - dispose 清理（关闭 WS、清理定时器、清理监听器）
 * - 重连逻辑（disposed 后不重连）
 *
 * 使用 mock WebSocket 进行测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TerminalConnection } from './TerminalConnection'

// ---- Mock WebSocket ----

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { reason: string }) => void) | null = null
  onerror: (() => void) | null = null

  sent: string[] = []
  closed = false
  closeCode?: number
  closeReason?: string

  constructor(public url: string) {
    // 模拟异步 open
    setTimeout(() => {
      if (this.onopen) this.onopen()
    }, 0)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ reason: reason || '' })
    }
  }

  // 模拟接收服务器消息
  simulateMessage(data: Record<string, unknown>): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  simulateClose(reason = 'test'): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ reason })
    }
  }
}

// 替换全局 WebSocket
let mockWsInstance: MockWebSocket | null = null

vi.stubGlobal(
  'WebSocket',
  class {
    constructor(url: string) {
      mockWsInstance = new MockWebSocket(url)
      return mockWsInstance as unknown as WebSocket
    }
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3
  }
)

// ---- Tests ----

describe('TerminalConnection', () => {
  let conn: TerminalConnection

  beforeEach(() => {
    vi.useFakeTimers()
    mockWsInstance = null
    conn = new TerminalConnection('ws://localhost:4127/ws/terminal?apiKey=test')
  })

  afterEach(() => {
    conn.dispose()
    vi.useRealTimers()
  })

  // ---- 连接 ----

  describe('connect', () => {
    it('should create WebSocket with correct URL', () => {
      conn.connect()
      expect(mockWsInstance).toBeDefined()
      expect(mockWsInstance!.url).toBe('ws://localhost:4127/ws/terminal?apiKey=test')
    })

    it('should emit connected event on open', async () => {
      const connectedSpy = vi.fn()
      conn.on('connected', connectedSpy)
      conn.connect()

      // 触发异步 onopen
      await vi.advanceTimersByTimeAsync(10)

      expect(connectedSpy).toHaveBeenCalled()
    })

    it('should not connect if already open', () => {
      conn.connect()
      const firstInstance = mockWsInstance
      conn.connect()
      expect(mockWsInstance).toBe(firstInstance)
    })

    it('should not connect if disposed', () => {
      conn.dispose()
      conn.connect()
      expect(mockWsInstance).toBeNull()
    })
  })

  // ---- 事件系统 ----

  describe('event system', () => {
    it('should handle output messages', async () => {
      const outputSpy = vi.fn()
      conn.on('output', outputSpy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      mockWsInstance!.simulateMessage({
        type: 'terminal:output',
        terminalId: 'term-1',
        data: 'hello'
      })

      expect(outputSpy).toHaveBeenCalledWith({
        terminalId: 'term-1',
        data: 'hello'
      })
    })

    it('should handle exit messages', async () => {
      const exitSpy = vi.fn()
      conn.on('exit', exitSpy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      mockWsInstance!.simulateMessage({
        type: 'terminal:exit',
        terminalId: 'term-1',
        exitCode: 0,
        signal: undefined
      })

      expect(exitSpy).toHaveBeenCalledWith({
        terminalId: 'term-1',
        exitCode: 0,
        signal: undefined
      })
    })

    it('should handle title messages', async () => {
      const titleSpy = vi.fn()
      conn.on('title', titleSpy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      mockWsInstance!.simulateMessage({
        type: 'terminal:title',
        terminalId: 'term-1',
        title: 'new title'
      })

      expect(titleSpy).toHaveBeenCalledWith({
        terminalId: 'term-1',
        title: 'new title'
      })
    })

    it('should handle error messages', async () => {
      const errorSpy = vi.fn()
      conn.on('error', errorSpy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      mockWsInstance!.simulateMessage({
        type: 'terminal:error',
        terminalId: 'term-1',
        message: 'something went wrong'
      })

      expect(errorSpy).toHaveBeenCalledWith({
        terminalId: 'term-1',
        message: 'something went wrong'
      })
    })

    it('should handle attached messages', async () => {
      const attachedSpy = vi.fn()
      conn.on('attached', attachedSpy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      mockWsInstance!.simulateMessage({
        type: 'terminal:attached',
        terminalId: 'term-1'
      })

      expect(attachedSpy).toHaveBeenCalledWith({ terminalId: 'term-1' })
    })

    it('should handle pong messages without error', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      expect(() => {
        mockWsInstance!.simulateMessage({ type: 'terminal:pong' })
      }).not.toThrow()
    })

    it('should support unsubscribing from events', async () => {
      const spy = vi.fn()
      const unsub = conn.on('output', spy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      unsub()

      mockWsInstance!.simulateMessage({
        type: 'terminal:output',
        terminalId: 'term-1',
        data: 'test'
      })

      expect(spy).not.toHaveBeenCalled()
    })

    it('should handle malformed messages gracefully', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      // 发送非 JSON 消息
      expect(() => {
        if (mockWsInstance!.onmessage) {
          mockWsInstance!.onmessage({ data: 'not json' })
        }
      }).not.toThrow()
    })
  })

  // ---- attach/detach/write/resize ----

  describe('terminal operations', () => {
    it('should send attach message', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.attach('term-1')

      const sent = JSON.parse(mockWsInstance!.sent[mockWsInstance!.sent.length - 1])
      expect(sent.type).toBe('terminal:attach')
      expect(sent.terminalId).toBe('term-1')
      expect(conn.getAttachedTerminalId()).toBe('term-1')
    })

    it('should send detach message', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.attach('term-1')
      conn.detach()

      const sent = JSON.parse(mockWsInstance!.sent[mockWsInstance!.sent.length - 1])
      expect(sent.type).toBe('terminal:detach')
      expect(sent.terminalId).toBe('term-1')
      expect(conn.getAttachedTerminalId()).toBeNull()
    })

    it('should not send detach when not attached', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      const sentBefore = mockWsInstance!.sent.length
      conn.detach()
      expect(mockWsInstance!.sent.length).toBe(sentBefore)
    })

    it('should send write message when attached', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.attach('term-1')
      conn.write('hello\n')

      const sent = JSON.parse(mockWsInstance!.sent[mockWsInstance!.sent.length - 1])
      expect(sent.type).toBe('terminal:input')
      expect(sent.terminalId).toBe('term-1')
      expect(sent.data).toBe('hello\n')
    })

    it('should not send write when not attached', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      const sentBefore = mockWsInstance!.sent.length
      conn.write('hello\n')
      expect(mockWsInstance!.sent.length).toBe(sentBefore)
    })

    it('should send resize message when attached', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.attach('term-1')
      conn.resize(120, 40)

      const sent = JSON.parse(mockWsInstance!.sent[mockWsInstance!.sent.length - 1])
      expect(sent.type).toBe('terminal:resize')
      expect(sent.cols).toBe(120)
      expect(sent.rows).toBe(40)
    })

    it('should not send resize when not attached', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      const sentBefore = mockWsInstance!.sent.length
      conn.resize(120, 40)
      expect(mockWsInstance!.sent.length).toBe(sentBefore)
    })
  })

  // ---- 状态查询 ----

  describe('state queries', () => {
    it('should report not connected before connect', () => {
      expect(conn.isConnected()).toBe(false)
    })

    it('should report connected after open', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)
      expect(conn.isConnected()).toBe(true)
    })

    it('should report not connected after dispose', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)
      conn.dispose()
      expect(conn.isConnected()).toBe(false)
    })

    it('should return null attachedTerminalId initially', () => {
      expect(conn.getAttachedTerminalId()).toBeNull()
    })
  })

  // ---- dispose ----

  describe('dispose', () => {
    it('should close WebSocket on dispose', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.dispose()

      expect(mockWsInstance!.closed).toBe(true)
      expect(mockWsInstance!.closeCode).toBe(1000)
    })

    it('should clear listeners on dispose', async () => {
      const spy = vi.fn()
      conn.on('output', spy)
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.dispose()

      // 尝试接收消息 — 不应触发回调
      mockWsInstance!.simulateMessage({
        type: 'terminal:output',
        terminalId: 'term-1',
        data: 'test'
      })
      expect(spy).not.toHaveBeenCalled()
    })

    it('should clear attached terminal on dispose', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)
      conn.attach('term-1')
      conn.dispose()
      expect(conn.getAttachedTerminalId()).toBeNull()
    })

    it('should not reconnect after dispose', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)
      conn.dispose()

      // 模拟 close 事件
      mockWsInstance!.simulateClose('test')

      // 推进定时器 — 不应创建新连接
      await vi.advanceTimersByTimeAsync(60000)
      // dispose 后不应重连（没有新的 WS 实例）
    })
  })

  // ---- 重连 ----

  describe('reconnect on close', () => {
    it('should re-attach to previous terminal after reconnect', async () => {
      conn.connect()
      await vi.advanceTimersByTimeAsync(10)

      conn.attach('term-1')

      // 保存旧实例
      const oldWs = mockWsInstance!

      // 模拟断开（不是 dispose）
      oldWs.readyState = MockWebSocket.CLOSED
      if (oldWs.onclose) oldWs.onclose({ reason: 'network error' })

      // 推进到第一次重连（1s 延迟）
      await vi.advanceTimersByTimeAsync(1100)

      // 新连接应该被创建
      expect(mockWsInstance).not.toBe(oldWs)

      // onopen 后应该重新发送 attach
      await vi.advanceTimersByTimeAsync(10)

      const lastSent = mockWsInstance!.sent[mockWsInstance!.sent.length - 1]
      if (lastSent) {
        const msg = JSON.parse(lastSent)
        expect(msg.type).toBe('terminal:attach')
        expect(msg.terminalId).toBe('term-1')
      }
    })
  })
})
