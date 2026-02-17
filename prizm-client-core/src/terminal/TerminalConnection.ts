/**
 * TerminalConnection — WebSocket 终端连接封装
 *
 * 管理到 /ws/terminal 的 WebSocket 连接，提供：
 * - attach/detach 终端
 * - 写入输入 / 调整尺寸
 * - 输出/退出/错误事件
 * - 自动重连
 */

import { createClientLogger } from '../logger'
import type { TerminalClientMessage, TerminalServerMessage } from '@prizm/shared'

const log = createClientLogger('Terminal')

export type TerminalEventType =
  | 'output'
  | 'exit'
  | 'title'
  | 'error'
  | 'attached'
  | 'connected'
  | 'disconnected'

export interface TerminalOutputEvent {
  terminalId: string
  data: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number
  signal?: number
}

export interface TerminalTitleEvent {
  terminalId: string
  title: string
}

export interface TerminalErrorEvent {
  terminalId: string
  message: string
}

type TerminalEventMap = {
  output: TerminalOutputEvent
  exit: TerminalExitEvent
  title: TerminalTitleEvent
  error: TerminalErrorEvent
  attached: { terminalId: string }
  connected: void
  disconnected: { reason?: string }
}

type EventCallback<T> = (data: T) => void

export class TerminalConnection {
  private ws: WebSocket | null = null
  private readonly wsUrl: string
  private attachedTerminalId: string | null = null
  private listeners = new Map<string, Set<EventCallback<unknown>>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private disposed = false
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl
  }

  /** 连接到 Terminal WebSocket 服务器 */
  connect(): void {
    if (this.disposed) return
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    log.info('Connecting to terminal WebSocket:', this.wsUrl)
    try {
      this.ws = new WebSocket(this.wsUrl)
    } catch (err) {
      log.error('Failed to create WebSocket:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      log.info('Terminal WebSocket connected')
      this.startPing()
      this.emit('connected', undefined as unknown as void)

      // 如果之前有 attach 的终端，重新 attach
      if (this.attachedTerminalId) {
        this.sendMessage({ type: 'terminal:attach', terminalId: this.attachedTerminalId })
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as TerminalServerMessage
        this.handleServerMessage(msg)
      } catch {
        log.warn('Failed to parse terminal message')
      }
    }

    this.ws.onclose = (event) => {
      this.stopPing()
      log.warn('Terminal WebSocket closed:', event.code, event.reason)
      this.emit('disconnected', { reason: event.reason || 'Connection closed' })
      if (!this.disposed) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      log.error('Terminal WebSocket error')
    }
  }

  /** 附着到指定终端 */
  attach(terminalId: string): void {
    log.debug('Attaching terminal:', terminalId)
    this.attachedTerminalId = terminalId
    this.sendMessage({ type: 'terminal:attach', terminalId })
  }

  /** 分离当前终端 */
  detach(): void {
    log.debug('Detaching terminal')
    if (this.attachedTerminalId) {
      this.sendMessage({ type: 'terminal:detach', terminalId: this.attachedTerminalId })
      this.attachedTerminalId = null
    }
  }

  /** 写入终端输入 */
  write(data: string): void {
    if (!this.attachedTerminalId) return
    this.sendMessage({ type: 'terminal:input', terminalId: this.attachedTerminalId, data })
  }

  /** 调整终端尺寸 */
  resize(cols: number, rows: number): void {
    if (!this.attachedTerminalId) return
    this.sendMessage({
      type: 'terminal:resize',
      terminalId: this.attachedTerminalId,
      cols,
      rows
    })
  }

  /** 获取当前附着的终端 ID */
  getAttachedTerminalId(): string | null {
    return this.attachedTerminalId
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  // ---- 事件系统 ----

  on<K extends keyof TerminalEventMap>(
    event: K,
    callback: EventCallback<TerminalEventMap[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const set = this.listeners.get(event)!
    set.add(callback as EventCallback<unknown>)
    return () => {
      set.delete(callback as EventCallback<unknown>)
    }
  }

  private emit<K extends keyof TerminalEventMap>(event: K, data: TerminalEventMap[K]): void {
    const set = this.listeners.get(event)
    if (set) {
      for (const cb of set) {
        try {
          cb(data)
        } catch {
          // ignore callback errors
        }
      }
    }
  }

  // ---- 销毁 ----

  dispose(): void {
    log.debug('Terminal connection disposed')
    this.disposed = true
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disposed')
      this.ws = null
    }
    this.listeners.clear()
    this.attachedTerminalId = null
  }

  // ---- 内部方法 ----

  private handleServerMessage(msg: TerminalServerMessage): void {
    switch (msg.type) {
      case 'terminal:output':
        this.emit('output', { terminalId: msg.terminalId, data: msg.data })
        break
      case 'terminal:exit':
        this.emit('exit', {
          terminalId: msg.terminalId,
          exitCode: msg.exitCode,
          signal: msg.signal
        })
        break
      case 'terminal:title':
        this.emit('title', { terminalId: msg.terminalId, title: msg.title })
        break
      case 'terminal:error':
        this.emit('error', { terminalId: msg.terminalId, message: msg.message })
        break
      case 'terminal:attached':
        this.emit('attached', { terminalId: msg.terminalId })
        break
      case 'terminal:pong':
        // heartbeat response, no action needed
        break
    }
  }

  private sendMessage(msg: TerminalClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      log.warn('Cannot send: terminal not connected')
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error('Terminal max reconnect attempts reached')
      return
    }
    log.info('Terminal reconnecting, attempt:', this.reconnectAttempts + 1, '/', this.maxReconnectAttempts)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      this.sendMessage({ type: 'terminal:ping' })
    }, 25000)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
