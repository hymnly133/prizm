/**
 * TerminalWebSocketServer
 * 专用 WebSocket 通道 — 处理终端实时 I/O
 *
 * 挂载路径: /ws/terminal
 * 认证: ?apiKey=xxx
 * 协议: attach -> 双向流式传输 -> detach/exit
 * 支持: 同一终端多个观察者、心跳检测、重连回放
 */

import http from 'http'
import { WebSocketServer as WSServer } from 'ws'
import type { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { ClientRegistry } from '../auth/ClientRegistry'
import type { TerminalSessionManager, Disposable } from './TerminalSessionManager'
import type { TerminalClientMessage, TerminalServerMessage } from '@prizm/shared'
import { createLogger } from '../logger'

const log = createLogger('TerminalWS')

/** 心跳间隔 (ms) */
const HEARTBEAT_INTERVAL_MS = 30_000
/** 心跳超时 (ms) — 超过此时间无 pong 断开连接 */
const HEARTBEAT_TIMEOUT_MS = 60_000

interface TerminalWSConnection {
  id: string
  clientId: string
  socket: WebSocket
  /** 当前 attach 的终端 ID */
  attachedTerminalId: string | null
  /** 输出监听 disposable */
  outputDisposable: Disposable | null
  /** 退出监听 disposable */
  exitDisposable: Disposable | null
  /** 最后一次活动时间 */
  lastActivity: number
  /** 是否存活（心跳检测用） */
  isAlive: boolean
}

export interface TerminalWebSocketServerOptions {
  path?: string
}

export class TerminalWebSocketServer {
  private wss: InstanceType<typeof WSServer>
  private connections = new Map<string, TerminalWSConnection>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    httpServer: http.Server,
    private clientRegistry: ClientRegistry,
    private terminalManager: TerminalSessionManager,
    options: TerminalWebSocketServerOptions = {}
  ) {
    const wsPath = options.path ?? '/ws/terminal'

    // noServer 模式 — 由 server.ts 统一路由 upgrade 事件
    this.wss = new WSServer({ noServer: true })

    this.setupHandlers()
    this.startHeartbeat()
    log.info('Initialized on path', wsPath)
  }

  private setupHandlers(): void {
    this.wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(socket, req)
    })

    this.wss.on('error', (error) => {
      log.error('Server error:', error)
    })
  }

  private handleConnection(socket: WebSocket, req: http.IncomingMessage): void {
    // 认证
    const apiKey = this.extractApiKey(req.url)
    if (!apiKey) {
      this.sendToSocket(socket, {
        type: 'terminal:error',
        terminalId: '',
        message: 'API key is required'
      })
      socket.close(4001, 'API key is required')
      return
    }

    const validation = this.clientRegistry.validate(apiKey)
    if (!validation) {
      this.sendToSocket(socket, {
        type: 'terminal:error',
        terminalId: '',
        message: 'Invalid API key'
      })
      socket.close(4003, 'Invalid API key')
      return
    }

    const connId = uuidv4()
    const conn: TerminalWSConnection = {
      id: connId,
      clientId: validation.clientId,
      socket,
      attachedTerminalId: null,
      outputDisposable: null,
      exitDisposable: null,
      lastActivity: Date.now(),
      isAlive: true
    }
    this.connections.set(connId, conn)
    log.info('Terminal WS connected:', connId, 'client:', validation.clientId)

    socket.on('message', (raw: Buffer) => {
      conn.lastActivity = Date.now()
      conn.isAlive = true
      try {
        const msg = JSON.parse(raw.toString()) as TerminalClientMessage
        this.handleMessage(conn, msg)
      } catch (err) {
        log.error('Failed to parse terminal WS message:', err)
      }
    })

    socket.on('close', () => {
      this.cleanupConnection(connId)
    })

    socket.on('error', (err) => {
      log.error('Terminal WS connection error:', connId, err)
      this.cleanupConnection(connId)
    })

    // pong 响应
    socket.on('pong', () => {
      conn.isAlive = true
    })
  }

  private handleMessage(conn: TerminalWSConnection, msg: TerminalClientMessage): void {
    switch (msg.type) {
      case 'terminal:attach':
        this.handleAttach(conn, msg.terminalId)
        break
      case 'terminal:input':
        this.handleInput(conn, msg.terminalId, msg.data)
        break
      case 'terminal:resize':
        this.handleResize(conn, msg.terminalId, msg.cols, msg.rows)
        break
      case 'terminal:detach':
        this.handleDetach(conn)
        break
      case 'terminal:ping':
        this.sendToSocket(conn.socket, { type: 'terminal:pong' })
        break
    }
  }

  private handleAttach(conn: TerminalWSConnection, terminalId: string): void {
    // 先 detach 已有的
    if (conn.attachedTerminalId) {
      this.handleDetach(conn)
    }

    const terminal = this.terminalManager.getTerminal(terminalId)
    if (!terminal) {
      this.sendToSocket(conn.socket, {
        type: 'terminal:error',
        terminalId,
        message: `Terminal not found: ${terminalId}`
      })
      return
    }

    conn.attachedTerminalId = terminalId

    // 回放最近输出缓冲区（用于重连）
    const recentOutput = this.terminalManager.getRecentOutput(terminalId)
    if (recentOutput) {
      this.sendToSocket(conn.socket, {
        type: 'terminal:output',
        terminalId,
        data: recentOutput
      })
    }

    // 注册输出监听
    try {
      conn.outputDisposable = this.terminalManager.onOutput(terminalId, (data) => {
        this.sendToSocket(conn.socket, {
          type: 'terminal:output',
          terminalId,
          data
        })
      })

      conn.exitDisposable = this.terminalManager.onExit(terminalId, (exitCode, signal) => {
        this.sendToSocket(conn.socket, {
          type: 'terminal:exit',
          terminalId,
          exitCode,
          signal
        })
      })
    } catch {
      // terminal 可能刚好被删除了
      this.sendToSocket(conn.socket, {
        type: 'terminal:error',
        terminalId,
        message: 'Failed to attach to terminal'
      })
      return
    }

    // 如果终端已退出，立即发送退出事件
    if (terminal.status === 'exited') {
      this.sendToSocket(conn.socket, {
        type: 'terminal:exit',
        terminalId,
        exitCode: terminal.exitCode ?? -1,
        signal: terminal.signal
      })
    }

    this.sendToSocket(conn.socket, {
      type: 'terminal:attached',
      terminalId
    })

    log.info(`Connection ${conn.id} attached to terminal ${terminalId}`)
  }

  private handleInput(conn: TerminalWSConnection, terminalId: string, data: string): void {
    if (conn.attachedTerminalId !== terminalId) {
      this.sendToSocket(conn.socket, {
        type: 'terminal:error',
        terminalId,
        message: 'Not attached to this terminal'
      })
      return
    }
    try {
      this.terminalManager.writeToTerminal(terminalId, data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.sendToSocket(conn.socket, {
        type: 'terminal:error',
        terminalId,
        message: msg
      })
    }
  }

  private handleResize(
    conn: TerminalWSConnection,
    terminalId: string,
    cols: number,
    rows: number
  ): void {
    if (conn.attachedTerminalId !== terminalId) return
    try {
      this.terminalManager.resizeTerminal(terminalId, cols, rows)
    } catch {
      // 忽略 resize 错误
    }
  }

  private handleDetach(conn: TerminalWSConnection): void {
    if (conn.outputDisposable) {
      conn.outputDisposable.dispose()
      conn.outputDisposable = null
    }
    if (conn.exitDisposable) {
      conn.exitDisposable.dispose()
      conn.exitDisposable = null
    }
    conn.attachedTerminalId = null
  }

  private cleanupConnection(connId: string): void {
    const conn = this.connections.get(connId)
    if (!conn) return
    this.handleDetach(conn)
    this.connections.delete(connId)
    log.info('Terminal WS disconnected:', connId)
  }

  /**
   * 向指定终端的所有观察者广播消息
   */
  broadcastToTerminal(terminalId: string, msg: TerminalServerMessage): void {
    for (const conn of this.connections.values()) {
      if (conn.attachedTerminalId === terminalId) {
        this.sendToSocket(conn.socket, msg)
      }
    }
  }

  private sendToSocket(socket: WebSocket, msg: TerminalServerMessage): boolean {
    if (socket.readyState !== 1) return false
    try {
      socket.send(JSON.stringify(msg))
      return true
    } catch (err) {
      log.error('Failed to send terminal WS message:', err)
      return false
    }
  }

  private extractApiKey(url?: string): string | null {
    if (!url) return null
    try {
      const urlObj = new URL(url, 'http://localhost')
      return urlObj.searchParams.get('apiKey')
    } catch {
      return null
    }
  }

  // ---- 心跳检测 ----

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [connId, conn] of this.connections) {
        if (!conn.isAlive) {
          log.info('Heartbeat timeout, closing:', connId)
          conn.socket.terminate()
          this.cleanupConnection(connId)
          continue
        }
        conn.isAlive = false
        try {
          conn.socket.ping()
        } catch {
          this.cleanupConnection(connId)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }

  /**
   * 处理 HTTP upgrade 请求（noServer 模式下由 server.ts 调用）
   */
  handleUpgrade(
    req: http.IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer
  ): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req)
    })
  }

  /**
   * 销毁 Terminal WebSocket 服务器
   */
  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const connId of Array.from(this.connections.keys())) {
      const conn = this.connections.get(connId)
      if (conn) {
        conn.socket.close(1000, 'Server shutting down')
        this.cleanupConnection(connId)
      }
    }
    this.wss.close(() => {
      log.info('Terminal WebSocket server shut down')
    })
  }
}
