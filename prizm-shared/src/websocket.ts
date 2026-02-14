/**
 * WebSocket 消息类型
 * 单一数据源，供 server 与 client-core 复用
 */

import type { EventType } from './events'

// ============ 客户端 -> 服务器的消息 ============

export interface AuthMessage {
  type: 'auth'
  apiKey: string
}

export interface RegisterEventMessage {
  type: 'register'
  eventType: EventType | string
  scope?: string
}

export interface UnregisterEventMessage {
  type: 'unregister'
  eventType: EventType | string
}

export interface PingMessage {
  type: 'ping'
}

export type ClientToServerMessage =
  | AuthMessage
  | RegisterEventMessage
  | UnregisterEventMessage
  | PingMessage

// ============ 服务器 -> 客户端的消息 ============

export interface ConnectedMessage {
  type: 'connected'
  clientId: string
  serverTime: number
}

export interface AuthenticatedMessage {
  type: 'authenticated'
  clientId: string
  allowedScopes: string[]
}

export interface RegisteredMessage {
  type: 'registered'
  eventType: EventType | string
}

export interface UnregisteredMessage {
  type: 'unregistered'
  eventType: EventType | string
}

export interface EventPushMessage<T = unknown> {
  type: 'event'
  eventType: EventType | string
  payload: T
  scope?: string
  timestamp: number
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ServerToClientMessage =
  | ConnectedMessage
  | AuthenticatedMessage
  | RegisteredMessage
  | UnregisteredMessage
  | EventPushMessage
  | ErrorMessage
  | { type: 'pong' }

// ============ 通用 ============

export type WebSocketMessage = ClientToServerMessage | ServerToClientMessage

// ============ 验证函数 ============

export function isClientMessage(message: unknown): message is ClientToServerMessage {
  if (typeof message !== 'object' || message === null) return false
  const msg = message as Record<string, unknown>
  const type = msg.type as string
  return type === 'auth' || type === 'register' || type === 'unregister' || type === 'ping'
}

export function isServerMessage(message: unknown): message is ServerToClientMessage {
  if (typeof message !== 'object' || message === null) return false
  const msg = message as Record<string, unknown>
  const type = msg.type as string
  return (
    type === 'connected' ||
    type === 'authenticated' ||
    type === 'registered' ||
    type === 'unregistered' ||
    type === 'event' ||
    type === 'error' ||
    type === 'pong'
  )
}
