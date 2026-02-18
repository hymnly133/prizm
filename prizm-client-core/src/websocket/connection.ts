/**
 * Prizm WebSocket 客户端连接（可复用核心 SDK）
 */

import { createClientLogger } from '../logger'
import { ALL_EVENTS } from '../types'
import type {
  ServerMessage,
  ClientMessage,
  WebSocketConfig,
  WebSocketEventType,
  WebSocketEventHandler,
  NotificationPayload,
  EventPushMessage,
  WebSocketClientEventMap,
  RegisterEventMessage,
  UnregisterEventMessage
} from '../types'

const log = createClientLogger('WebSocket')

const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_RECONNECT_DELAY_MS = 60_000

export class PrizmWebSocketClient {
  private ws: WebSocket | null = null
  private config: WebSocketConfig
  private reconnectTimer: number | null = null
  private reconnectAttempts = 0
  private heartbeatTimer: number | null = null
  private lastPongTime = 0
  private eventHandlers = new Map<
    WebSocketEventType,
    Set<WebSocketEventHandler<WebSocketEventType>>
  >()
  private manualDisconnect = false

  constructor(config: WebSocketConfig) {
    this.config = config
  }

  /**
   * 连接到 WebSocket 服务器
   */
  async connect(): Promise<void> {
    const wsUrl = `ws://${this.config.host}:${this.config.port}/ws?apiKey=${encodeURIComponent(
      this.config.apiKey
    )}`
    log.info('Connecting to', wsUrl)

    return new Promise((resolve, reject) => {
      this.manualDisconnect = false

      try {
        this.ws = new WebSocket(wsUrl)
      } catch (error) {
        log.error('Failed to create WebSocket:', error)
        reject(error)
        return
      }

      this.ws.onopen = () => {
        log.debug('WebSocket handshake complete, waiting for server auth')
        this.reconnectAttempts = 0
        this.startHeartbeat()
        const events =
          this.config.subscribeEvents === 'all'
            ? [...ALL_EVENTS]
            : this.config.subscribeEvents ?? ['notification']
        for (const eventType of events) {
          this.registerEvent(eventType)
        }
        resolve()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string)
      }

      this.ws.onclose = (event: CloseEvent) => {
        log.warn('WebSocket closed:', event.code, '-', event.reason)
        this.stopHeartbeat()

        if (!this.manualDisconnect) {
          this.emit('disconnected', undefined as unknown as void)
          this.scheduleReconnect()
        }

        this.ws = null
      }

      this.ws.onerror = (error: Event) => {
        log.error('WebSocket error:', error)
        this.emit('error', error as unknown as Error)
        reject(error as unknown as Error)
      }
    })
  }

  /**
   * 处理服务器消息
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ServerMessage

      switch (message.type) {
        case 'connected': {
          const connectedMsg = message as {
            type: 'connected'
            clientId: string
            serverTime: number
          }
          log.info('Server acknowledged, clientId:', connectedMsg.clientId)
          this.emit('connected', connectedMsg)
          break
        }

        case 'registered':
          log.debug('Registered for event:', (message as any).eventType)
          break

        case 'unregistered':
          log.debug('Unregistered from event:', (message as any).eventType)
          break

        case 'event':
          this.handleEventPush(message as EventPushMessage<NotificationPayload>)
          break

        case 'error':
          log.error('Server error:', (message as any).code, (message as any).message)
          break

        case 'pong':
          this.lastPongTime = Date.now()
          break
      }
    } catch (error) {
      log.error('Failed to parse message:', error)
    }
  }

  /**
   * 处理事件推送
   */
  private handleEventPush(message: EventPushMessage<NotificationPayload>): void {
    const { eventType, payload } = message
    // 通用事件：供客户端根据 notify_events 决定是否弹窗
    this.emit('event', { eventType, payload })
    // 兼容：notification 事件单独发出
    if (eventType === 'notification') {
      const p = payload as NotificationPayload
      this.emit('notification', p)
    }
  }

  /**
   * 注册事件
   */
  registerEvent(eventType: string): void {
    const message: RegisterEventMessage = {
      type: 'register',
      eventType
    }
    this.send(message)
  }

  /**
   * 取消注册事件
   */
  unregisterEvent(eventType: string): void {
    const message: UnregisterEventMessage = {
      type: 'unregister',
      eventType
    }
    this.send(message)
  }

  /**
   * 批量订阅事件（运行时动态订阅）
   */
  subscribeEvents(events: string[]): void {
    for (const eventType of events) {
      this.registerEvent(eventType)
    }
  }

  /**
   * 批量退订事件（运行时动态退订）
   */
  unsubscribeEvents(events: string[]): void {
    for (const eventType of events) {
      this.unregisterEvent(eventType)
    }
  }

  /**
   * 发送 Ping
   */
  ping(): void {
    this.send({ type: 'ping' })
  }

  /**
   * 发送消息
   */
  private send(data: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send: WebSocket not connected')
      return
    }

    try {
      this.ws.send(JSON.stringify(data))
    } catch (error) {
      log.error('Failed to send message:', error)
    }
  }

  /**
   * 注册事件处理器
   */
  on<T extends WebSocketEventType>(eventType: T, handler: WebSocketEventHandler<T>): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set())
    }
    this.eventHandlers.get(eventType)!.add(handler as any)
  }

  /**
   * 移除事件处理器
   */
  off<T extends WebSocketEventType>(eventType: T, handler: WebSocketEventHandler<T>): void {
    const handlers = this.eventHandlers.get(eventType)
    if (handlers) {
      handlers.delete(handler as any)
    }
  }

  /**
   * 触发事件
   */
  private emit<T extends WebSocketEventType>(eventType: T, data: WebSocketClientEventMap[T]): void {
    const handlers = this.eventHandlers.get(eventType)
    if (handlers) {
      for (const handler of handlers) {
        try {
          ;(handler as WebSocketEventHandler<T>)(data)
        } catch (error) {
          log.error('Error in', eventType, 'handler:', error)
        }
      }
    }
  }

  /**
   * 计划重连（指数退避：1s → 2s → 4s → ... → 60s max）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempts++
    log.info('Scheduling reconnect in', delay, 'ms (attempt', this.reconnectAttempts, ')')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      log.info('Reconnecting...')
      this.connect().catch((err) => {
        log.error('Reconnect failed:', err)
        this.scheduleReconnect()
      })
    }, delay) as unknown as number
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.lastPongTime = Date.now()
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return
      const sincePong = Date.now() - this.lastPongTime
      if (sincePong > HEARTBEAT_INTERVAL_MS * 2) {
        log.warn('No pong received for', sincePong, 'ms, forcing reconnect')
        this.ws?.close(4000, 'Heartbeat timeout')
        return
      }
      this.ping()
    }, HEARTBEAT_INTERVAL_MS) as unknown as number
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.manualDisconnect = true
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.reconnectAttempts = 0
    log.info('Disconnected (manual)')
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
