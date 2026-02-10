/**
 * Prizm 事件注册表
 * 中央管理所有 WebSocket 客户端的事件订阅
 */

import type { WebSocketContext } from './WebSocketContext'
import type { EventType, EventPushMessage } from './types'

export interface SubscriberInfo {
  clientId: string
  registeredEvents: EventType[]
  currentScope: string
}

export class EventRegistry {
  private clients = new Map<string, WebSocketContext>() // connectionId -> context
  private clientIds = new Map<string, string>() // clientId -> connectionId (for lookup)
  private eventSubscriptions = new Map<EventType, Set<string>>() // eventType -> Set<connectionId>

  /**
   * 注册客户端
   */
  registerClient(context: WebSocketContext): void {
    this.clients.set(context.id, context)
    this.clientIds.set(context.clientId, context.id)
    console.log(`[Prizm EventRegistry] Registered client ${context.clientId} (${context.id})`)
  }

  /**
   * 注销客户端
   */
  unregisterClient(contextId: string): void {
    const context = this.clients.get(contextId)
    if (!context) return

    // 从所有事件订阅中移除
    for (const eventType of context.getRegisteredEvents()) {
      this.unregisterEvent(contextId, eventType)
    }

    // 从映射中移除
    this.clientIds.delete(context.clientId)
    this.clients.delete(contextId)

    console.log(`[Prizm EventRegistry] Unregistered client ${context.clientId} (${contextId})`)
  }

  /**
   * 根据 clientId 获取 context
   */
  getClientByClientId(clientId: string): WebSocketContext | undefined {
    const connectionId = this.clientIds.get(clientId)
    return connectionId ? this.clients.get(connectionId) : undefined
  }

  /**
   * 注册事件订阅
   */
  registerEvent(contextId: string, eventType: EventType): void {
    if (!this.eventSubscriptions.has(eventType)) {
      this.eventSubscriptions.set(eventType, new Set())
    }
    this.eventSubscriptions.get(eventType)!.add(contextId)

    const context = this.clients.get(contextId)
    if (context) {
      context.registerEvent(eventType)
    }

    console.log(
      `[Prizm EventRegistry] Client ${contextId} registered for event ${eventType}`
    )
  }

  /**
   * 取消事件订阅
   */
  unregisterEvent(contextId: string, eventType: EventType): void {
    const subscribers = this.eventSubscriptions.get(eventType)
    if (subscribers) {
      subscribers.delete(contextId)
    }

    const context = this.clients.get(contextId)
    if (context) {
      context.unregisterEvent(eventType)
    }

    console.log(
      `[Prizm EventRegistry] Client ${contextId} unregistered from event ${eventType}`
    )
  }

  /**
   * 获取事件的所有订阅者
   */
  getSubscribers(eventType: EventType): WebSocketContext[] {
    const subscribers = this.eventSubscriptions.get(eventType)
    if (!subscribers) return []

    return Array.from(subscribers)
      .map((id) => this.clients.get(id))
      .filter((c): c is WebSocketContext => c !== undefined && c.isOpen())
  }

  /**
   * 广播事件到所有订阅者
   */
  broadcast(
    eventType: EventType,
    payload: unknown,
    scope?: string
  ): number {
    const subscribers = this.getSubscribers(eventType)
    let delivered = 0

    for (const subscriber of subscribers) {
      // scope 过滤
      if (scope && !subscriber.hasScopePermission(scope)) {
        continue
      }

      const message: EventPushMessage = {
        type: 'event',
        eventType,
        payload,
        scope,
        timestamp: Date.now()
      }

      if (subscriber.send(message)) {
        delivered++
      }
    }

    console.log(
      `[Prizm EventRegistry] Broadcasted event ${eventType} to ${delivered}/${subscribers.length} subscribers`
    )

    return delivered
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
    const context = this.getClientByClientId(clientId)
    if (!context || !context.isOpen()) {
      console.warn(
        `[Prizm EventRegistry] Client ${clientId} not found or not connected`
      )
      return false
    }

    // 检查 scope 权限
    if (scope && !context.hasScopePermission(scope)) {
      console.warn(
        `[Prizm EventRegistry] Client ${clientId} does not have permission for scope ${scope}`
      )
      return false
    }

    const message: EventPushMessage = {
      type: 'event',
      eventType,
      payload,
      scope,
      timestamp: Date.now()
    }

    return context.send(message)
  }

  /**
   * 获取所有已连接的客户端信息
   */
  getConnectedClients(): SubscriberInfo[] {
    const clients: SubscriberInfo[] = []

    for (const context of this.clients.values()) {
      if (context.isOpen()) {
        clients.push({
          clientId: context.clientId,
          registeredEvents: context.getRegisteredEvents(),
          currentScope: context.getCurrentScope()
        })
      }
    }

    return clients
  }

  /**
   * 获取事件订阅数量
   */
  getSubscriberCount(eventType: EventType): number {
    const subscribers = this.eventSubscriptions.get(eventType)
    return subscribers ? subscribers.size : 0
  }

  /**
   * 获取所有已注册的事件类型
   */
  getRegisteredEventTypes(): EventType[] {
    return Array.from(this.eventSubscriptions.keys())
  }

  /**
   * 清理所有断开的连接
   */
  cleanup(): void {
    const toRemove: string[] = []

    for (const [id, context] of this.clients.entries()) {
      if (!context.isOpen()) {
        toRemove.push(id)
      }
    }

    for (const id of toRemove) {
      this.unregisterClient(id)
    }

    if (toRemove.length > 0) {
      console.log(`[Prizm EventRegistry] Cleaned up ${toRemove.length} disconnected clients`)
    }
  }
}
