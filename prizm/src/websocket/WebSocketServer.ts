/**
 * Prizm WebSocket 服务器
 * 主 WebSocket 服务器管理器，处理连接、鉴权和消息分发
 */

import http from 'http'
import { WebSocketServer as WSServer } from 'ws'
import type { WebSocket } from 'ws'
import { createLogger } from '../logger'

const log = createLogger('WebSocket')
import { v4 as uuidv4 } from 'uuid'
import type { ClientRegistry } from '../auth/ClientRegistry'
import { EventRegistry } from './EventRegistry'
import { WebSocketContext } from './WebSocketContext'
import type {
  ClientToServerMessage,
  ServerToClientMessage,
  WebSocketMessage,
  EventType,
  EventPushMessage,
  ErrorMessage
} from './types'

export interface WebSocketServerOptions {
  path?: string
  clientTrackingTimeout?: number // 毫秒
}

export class WebSocketServer {
  private wss: InstanceType<typeof WSServer>
  private eventRegistry: EventRegistry
  private clientRegistry: ClientRegistry
  private options: WebSocketServerOptions

  constructor(
    httpServer: http.Server,
    clientRegistry: ClientRegistry,
    options: WebSocketServerOptions = {}
  ) {
    this.eventRegistry = this.createEventRegistry()
    this.clientRegistry = clientRegistry
    this.options = {
      path: '/ws',
      clientTrackingTimeout: 30000,
      ...options
    }

    // 创建 WebSocket 服务器（noServer 模式，由 server.ts 统一路由 upgrade）
    this.wss = new WSServer({ noServer: true })

    this.setupConnectionHandlers()
    log.info('Initialized on path', this.options.path)
  }

  /**
   * 创建 EventRegistry 实例
   * 可以被重写以提供自定义实现
   */
  protected createEventRegistry(): EventRegistry {
    return new EventRegistry()
  }

  /**
   * 设置连接处理器
   */
  private setupConnectionHandlers(): void {
    this.wss.on('connection', (socket: WebSocket, req) => {
      this.handleConnection(socket, req)
    })

    this.wss.on('error', (error) => {
      log.error('Error:', error)
    })

    this.wss.on('close', () => {
      log.info('Closed')
    })

    // 定期清理断开的连接
    setInterval(() => {
      this.eventRegistry.cleanup()
    }, 60000)
  }

  /**
   * 处理新连接
   */
  private async handleConnection(socket: WebSocket, req: http.IncomingMessage): Promise<void> {
    const connectionId = uuidv4()

    log.info('New connection', connectionId)

    try {
      // 鉴权 - 从 URL 查询参数获取 API Key
      const apiKey = this.extractApiKey(req.url)
      if (!apiKey) {
        this.sendError(socket, 'AUTH_MISSING', 'API key is required')
        socket.close(4001, 'API key is required')
        return
      }

      const validationResult = this.clientRegistry.validate(apiKey)
      if (!validationResult) {
        this.sendError(socket, 'AUTH_INVALID', 'Invalid API key')
        socket.close(4003, 'Invalid API key')
        return
      }

      const clientId = validationResult.clientId
      const allowedScopes = validationResult.allowedScopes

      // 创建上下文
      const context = this.createWebSocketContext(connectionId, clientId, allowedScopes, socket)
      this.eventRegistry.registerClient(context)

      // 发送连接成功消息
      this.sendMessage(socket, {
        type: 'connected',
        clientId,
        serverTime: Date.now()
      })

      // 设置消息处理器
      socket.on('message', (data: Buffer) => {
        this.handleMessage(context, data.toString())
      })

      socket.on('close', () => {
        this.eventRegistry.unregisterClient(connectionId)
      })

      socket.on('error', (error) => {
        log.error('Error for', connectionId, ':', error)
        this.eventRegistry.unregisterClient(connectionId)
      })

      log.info('Client', clientId, 'authenticated', connectionId)
    } catch (error) {
      log.error('Error handling connection', connectionId, ':', error)
      this.sendError(socket, 'INTERNAL_ERROR', 'Failed to establish connection')
      socket.close(5000, 'Internal error')
    }
  }

  /**
   * 创建 WebSocketContext
   * 可以被重写以提供自定义实现
   */
  protected createWebSocketContext(
    id: string,
    clientId: string,
    allowedScopes: string[],
    socket: WebSocket
  ): WebSocketContext {
    return new WebSocketContext(id, clientId, allowedScopes, socket)
  }

  /**
   * 从 URL 提取 API Key
   */
  private extractApiKey(url?: string): string | null {
    if (!url) return null

    try {
      const urlObj = new URL(url, 'http://localhost')
      return urlObj.searchParams.get('apiKey')
    } catch {
      return null
    }
  }

  /**
   * 处理客户端消息
   */
  private handleMessage(context: WebSocketContext, message: string): void {
    try {
      const data = JSON.parse(message) as ClientToServerMessage
      this.processMessage(context, data)
    } catch (error) {
      log.error('Failed to parse message from', context.clientId, ':', error)
      this.sendError(context.socket, 'INVALID_MESSAGE', 'Failed to parse message')
    }
  }

  /**
   * 处理消息
   */
  private processMessage(context: WebSocketContext, message: ClientToServerMessage): void {
    switch (message.type) {
      case 'register':
        this.handleRegister(context, message)
        break

      case 'unregister':
        this.handleUnregister(context, message)
        break

      case 'ping':
        this.sendMessage(context.socket, { type: 'pong' })
        break

      default:
        this.sendError(
          context.socket,
          'UNKNOWN_MESSAGE_TYPE',
          `Unknown message type: ${(message as { type: string }).type}`
        )
    }
  }

  /**
   * 处理事件注册
   */
  private handleRegister(
    context: WebSocketContext,
    message: { type: 'register'; eventType: EventType | string; scope?: string }
  ): void {
    this.eventRegistry.registerEvent(context.id, message.eventType as EventType)

    // 更新 scope（如果提供）
    if (message.scope) {
      context.setCurrentScope(message.scope)
    }

    this.sendMessage(context.socket, {
      type: 'registered',
      eventType: message.eventType
    })
  }

  /**
   * 处理事件取消注册
   */
  private handleUnregister(
    context: WebSocketContext,
    message: { type: 'unregister'; eventType: EventType | string }
  ): void {
    this.eventRegistry.unregisterEvent(context.id, message.eventType as EventType)

    this.sendMessage(context.socket, {
      type: 'unregistered',
      eventType: message.eventType
    })
  }

  /**
   * 发送消息
   */
  private sendMessage(socket: WebSocket, message: ServerToClientMessage): boolean {
    if (socket.readyState !== 1) return false

    try {
      socket.send(JSON.stringify(message))
      return true
    } catch (error) {
      log.error('Failed to send message:', error)
      return false
    }
  }

  /**
   * 发送错误消息
   */
  private sendError(socket: WebSocket, code: string, message: string): void {
    this.sendMessage(socket, { type: 'error', code, message })
  }

  // ============ 公共 API ============

  /**
   * 广播事件到所有订阅者
   */
  broadcast(eventType: EventType, payload: unknown, scope?: string): number {
    return this.eventRegistry.broadcast(eventType, payload, scope)
  }

  /**
   * 向指定客户端发送事件
   */
  broadcastToClient(
    clientId: string,
    eventType: EventType,
    payload: unknown,
    scope?: string
  ): boolean {
    return this.eventRegistry.broadcastToClient(clientId, eventType, payload, scope)
  }

  /**
   * 获取所有已连接的客户端
   */
  getConnectedClients(): Array<{
    clientId: string
    registeredEvents: EventType[]
    currentScope: string
  }> {
    return this.eventRegistry.getConnectedClients()
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
   * 销毁 WebSocket 服务器
   */
  destroy(): void {
    log.info('Shutting down...')

    // 关闭所有连接
    for (const client of this.wss.clients) {
      client.close(1000, 'Server shutting down')
    }

    this.wss.close(() => {
      log.info('Shut down complete')
    })
  }
}
