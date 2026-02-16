/**
 * TerminalWebSocketServer 单元测试
 *
 * 覆盖：
 * - 连接认证（有效/无效 API key）
 * - attach/detach 消息处理
 * - input 转发
 * - resize 转发
 * - 重连回放（attach 时发送 recentOutput）
 * - 错误处理（terminal not found、未 attach 就 input）
 * - destroy 清理
 *
 * 使用 mock 对象模拟 ClientRegistry、TerminalSessionManager 和 WebSocket
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import http from 'http'
import { WebSocket } from 'ws'
import { TerminalWebSocketServer } from './TerminalWebSocketServer'
import type { TerminalSessionManager, Disposable } from './TerminalSessionManager'
import type { ClientRegistry } from '../auth/ClientRegistry'
import type { TerminalSession } from '@prizm/shared'

// ---- Mock Factories ----

function createMockClientRegistry(
  validateResult: { clientId: string; scopes: string[] } | null = {
    clientId: 'test-client',
    scopes: ['*']
  }
): ClientRegistry {
  return {
    validate: vi.fn().mockReturnValue(validateResult),
    register: vi.fn(),
    revoke: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    get: vi.fn()
  } as unknown as ClientRegistry
}

function createMockTerminalSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-1',
    agentSessionId: 'session-1',
    scope: 'default',
    sessionType: 'interactive',
    shell: '/bin/bash',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    pid: 12345,
    title: 'test terminal',
    status: 'running',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    ...overrides
  }
}

function createMockTerminalManager(): TerminalSessionManager & {
  _outputCallbacks: Map<string, (data: string) => void>
  _exitCallbacks: Map<string, (code: number, sig?: number) => void>
} {
  const outputCallbacks = new Map<string, (data: string) => void>()
  const exitCallbacks = new Map<string, (code: number, sig?: number) => void>()

  return {
    _outputCallbacks: outputCallbacks,
    _exitCallbacks: exitCallbacks,
    getTerminal: vi.fn().mockReturnValue(createMockTerminalSession()),
    getRecentOutput: vi.fn().mockReturnValue('previous output data'),
    writeToTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    listTerminals: vi.fn().mockReturnValue([]),
    createTerminal: vi.fn(),
    cleanupSession: vi.fn(),
    shutdown: vi.fn(),
    onOutput: vi.fn().mockImplementation((termId: string, cb: (data: string) => void) => {
      outputCallbacks.set(termId, cb)
      return { dispose: () => outputCallbacks.delete(termId) }
    }),
    onExit: vi
      .fn()
      .mockImplementation((termId: string, cb: (code: number, sig?: number) => void) => {
        exitCallbacks.set(termId, cb)
        return { dispose: () => exitCallbacks.delete(termId) }
      }),
    totalCount: 0,
    runningCount: 0
  } as unknown as TerminalSessionManager & {
    _outputCallbacks: Map<string, (data: string) => void>
    _exitCallbacks: Map<string, (code: number, sig?: number) => void>
  }
}

// ---- Tests ----

describe('TerminalWebSocketServer', () => {
  let httpServer: http.Server
  let termWsServer: TerminalWebSocketServer
  let mockRegistry: ClientRegistry
  let mockManager: ReturnType<typeof createMockTerminalManager>
  let serverPort: number

  beforeEach(async () => {
    mockRegistry = createMockClientRegistry()
    mockManager = createMockTerminalManager()

    httpServer = http.createServer()

    termWsServer = new TerminalWebSocketServer(httpServer, mockRegistry, mockManager, {
      path: '/ws/terminal'
    })

    // 手动挂载 upgrade handler（模拟 server.ts 的行为）
    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'ws://localhost').pathname
      if (pathname === '/ws/terminal') {
        termWsServer.handleUpgrade(req, socket, head)
      } else {
        socket.destroy()
      }
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address() as { port: number }
        serverPort = addr.port
        resolve()
      })
    })
  })

  afterEach(async () => {
    termWsServer.destroy()
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
    })
  })

  function connectWs(apiKey = 'valid-key'): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/terminal?apiKey=${apiKey}`)
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  function receiveMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      ws.once('message', (raw) => {
        resolve(JSON.parse(raw.toString()))
      })
    })
  }

  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      ws.on('close', () => resolve())
      ws.close()
    })
  }

  // ---- 认证 ----

  describe('authentication', () => {
    it('should accept connection with valid API key', async () => {
      const ws = await connectWs('valid-key')
      expect(ws.readyState).toBe(WebSocket.OPEN)
      await closeWs(ws)
    })

    it('should close connection with invalid API key', async () => {
      ;(mockRegistry.validate as Mock).mockReturnValue(null)

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/terminal?apiKey=invalid`)

      const closePromise = new Promise<{ code: number }>((resolve) => {
        ws.on('close', (code) => resolve({ code }))
      })

      const { code } = await closePromise
      expect(code).toBe(4003)
    })

    it('should close connection without API key', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/terminal`)

      const closePromise = new Promise<{ code: number }>((resolve) => {
        ws.on('close', (code) => resolve({ code }))
      })

      const { code } = await closePromise
      expect(code).toBe(4001)
    })
  })

  // ---- attach/detach ----

  describe('attach / detach', () => {
    it('should attach to terminal and replay recent output', async () => {
      const ws = await connectWs()

      // 发送 attach 消息
      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))

      // 等待回放输出 + attached 确认
      const messages: Record<string, unknown>[] = []
      await new Promise<void>((resolve) => {
        ws.on('message', (raw) => {
          messages.push(JSON.parse(raw.toString()))
          // 等到收到 attached 消息
          if (messages.some((m) => m.type === 'terminal:attached')) {
            resolve()
          }
        })
      })

      // 应该收到 output（回放）和 attached
      const outputMsg = messages.find((m) => m.type === 'terminal:output')
      const attachedMsg = messages.find((m) => m.type === 'terminal:attached')

      expect(outputMsg).toBeDefined()
      expect((outputMsg as { data: string }).data).toBe('previous output data')
      expect(attachedMsg).toBeDefined()
      expect((attachedMsg as { terminalId: string }).terminalId).toBe('term-1')

      // 验证 onOutput 和 onExit 被注册
      expect(mockManager.onOutput).toHaveBeenCalledWith('term-1', expect.any(Function))
      expect(mockManager.onExit).toHaveBeenCalledWith('term-1', expect.any(Function))

      await closeWs(ws)
    })

    it('should send error when attaching to non-existent terminal', async () => {
      ;(mockManager.getTerminal as Mock).mockReturnValue(undefined)

      const ws = await connectWs()
      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'nonexistent' }))

      const msg = await receiveMessage(ws)
      expect(msg.type).toBe('terminal:error')
      expect(msg.message).toContain('Terminal not found')

      await closeWs(ws)
    })

    it('should send exit event immediately for already-exited terminal', async () => {
      ;(mockManager.getTerminal as Mock).mockReturnValue(
        createMockTerminalSession({ status: 'exited', exitCode: 0 })
      )

      const ws = await connectWs()
      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))

      const messages: Record<string, unknown>[] = []
      await new Promise<void>((resolve) => {
        ws.on('message', (raw) => {
          messages.push(JSON.parse(raw.toString()))
          if (messages.some((m) => m.type === 'terminal:exit')) {
            resolve()
          }
        })
      })

      const exitMsg = messages.find((m) => m.type === 'terminal:exit')
      expect(exitMsg).toBeDefined()
      expect((exitMsg as { exitCode: number }).exitCode).toBe(0)

      await closeWs(ws)
    })
  })

  // ---- input 转发 ----

  describe('input forwarding', () => {
    it('should forward input to terminal manager', async () => {
      const ws = await connectWs()

      // 先 attach
      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))
      await new Promise((r) => setTimeout(r, 100))

      // 发送输入
      ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'term-1', data: 'ls -la\n' }))
      await new Promise((r) => setTimeout(r, 100))

      expect(mockManager.writeToTerminal).toHaveBeenCalledWith('term-1', 'ls -la\n')

      await closeWs(ws)
    })

    it('should reject input when not attached to target terminal', async () => {
      const ws = await connectWs()

      // 不 attach 直接发输入
      ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'term-1', data: 'test' }))

      const msg = await receiveMessage(ws)
      expect(msg.type).toBe('terminal:error')
      expect(msg.message).toContain('Not attached')

      await closeWs(ws)
    })
  })

  // ---- resize 转发 ----

  describe('resize forwarding', () => {
    it('should forward resize to terminal manager', async () => {
      const ws = await connectWs()

      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))
      await new Promise((r) => setTimeout(r, 100))

      ws.send(
        JSON.stringify({
          type: 'terminal:resize',
          terminalId: 'term-1',
          cols: 120,
          rows: 40
        })
      )
      await new Promise((r) => setTimeout(r, 100))

      expect(mockManager.resizeTerminal).toHaveBeenCalledWith('term-1', 120, 40)

      await closeWs(ws)
    })
  })

  // ---- ping/pong ----

  describe('ping/pong', () => {
    it('should respond to ping with pong', async () => {
      const ws = await connectWs()

      ws.send(JSON.stringify({ type: 'terminal:ping' }))

      const msg = await receiveMessage(ws)
      expect(msg.type).toBe('terminal:pong')

      await closeWs(ws)
    })
  })

  // ---- output/exit 事件广播 ----

  describe('event broadcasting', () => {
    it('should relay output events to attached clients', async () => {
      const ws = await connectWs()

      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))

      // 等待 attach 完成（收到 attached 消息）
      await new Promise<void>((resolve) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'terminal:attached') resolve()
        })
      })

      // 模拟终端输出
      const outputCb = mockManager._outputCallbacks.get('term-1')
      expect(outputCb).toBeDefined()
      outputCb!('hello from terminal')

      const msg = await receiveMessage(ws)
      expect(msg.type).toBe('terminal:output')
      expect(msg.data).toBe('hello from terminal')

      await closeWs(ws)
    })

    it('should relay exit events to attached clients', async () => {
      const ws = await connectWs()

      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))

      await new Promise<void>((resolve) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'terminal:attached') resolve()
        })
      })

      // 模拟终端退出
      const exitCb = mockManager._exitCallbacks.get('term-1')
      expect(exitCb).toBeDefined()
      exitCb!(0, undefined)

      const msg = await receiveMessage(ws)
      expect(msg.type).toBe('terminal:exit')
      expect(msg.exitCode).toBe(0)

      await closeWs(ws)
    })
  })

  // ---- 连接清理 ----

  describe('connection cleanup', () => {
    it('should clean up on client disconnect', async () => {
      const ws = await connectWs()

      ws.send(JSON.stringify({ type: 'terminal:attach', terminalId: 'term-1' }))
      await new Promise((r) => setTimeout(r, 100))

      await closeWs(ws)

      // 等一下让服务器处理断开
      await new Promise((r) => setTimeout(r, 100))

      // 输出回调应该被 dispose
      expect(mockManager._outputCallbacks.has('term-1')).toBe(false)
    })
  })

  // ---- destroy ----

  describe('destroy', () => {
    it('should close all connections on destroy', async () => {
      const ws = await connectWs()

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve())
      })

      termWsServer.destroy()
      await closePromise
    })
  })
})
