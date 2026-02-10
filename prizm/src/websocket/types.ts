/**
 * Prizm WebSocket 消息类型定义
 */

// 预定义的事件类型
export const EVENT_TYPES = {
  NOTIFICATION: 'notification',
  SMTC_CHANGE: 'smtc:change',
  NOTE_CREATED: 'note:created',
  NOTE_UPDATED: 'note:updated',
  NOTE_DELETED: 'note:deleted',
  GROUP_CREATED: 'group:created',
  GROUP_UPDATED: 'group:updated',
  GROUP_DELETED: 'group:deleted'
} as const

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES] | string

// ============ 客户端 -> 服务器的消息 ============

export interface AuthMessage {
  type: 'auth'
  apiKey: string
}

export interface RegisterEventMessage {
  type: 'register'
  eventType: EventType
  scope?: string
}

export interface UnregisterEventMessage {
  type: 'unregister'
  eventType: EventType
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
  eventType: EventType
}

export interface UnregisteredMessage {
  type: 'unregistered'
  eventType: EventType
}

export interface EventPushMessage<T = unknown> {
  type: 'event'
  eventType: EventType
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

// ============ 通用 WebSocket 消息 ============

export type WebSocketMessage = ClientToServerMessage | ServerToClientMessage

// ============ 事件载荷类型 ============

export interface NotificationPayload {
  title: string
  body?: string
}

export interface SMTCPayload {
  sessionId?: string
  action: 'play' | 'pause' | 'stop' | 'skipNext' | 'skipPrevious' | 'toggle'
}

export interface NotePayload {
  id: string
  content: string
  groupId?: string
}

export interface GroupPayload {
  id: string
  name: string
}

// ============ WebSocket 配置 ============

export interface WebSocketServerConfig {
  enableWebSocket?: boolean
  websocketPath?: string
}

// ============ 验证函数 ============

export function isClientMessage(message: unknown): message is ClientToServerMessage {
  if (typeof message !== 'object' || message === null) return false
  const msg = message as Record<string, unknown>
  const type = msg.type as string
  return (
    type === 'auth' ||
    type === 'register' ||
    type === 'unregister' ||
    type === 'ping'
  )
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
