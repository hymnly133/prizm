/**
 * Prizm Tauri 客户端类型定义
 */

// ============ 配置结构 ============

export interface ServerConfig {
  host: string
  port: string
}

export interface ClientConfig {
  name: string
  auto_register: string
  requested_scopes: string[]
}

export interface TrayConfig {
  enabled: string
  minimize_to_tray: string
  show_notification: string
}

export interface PrizmConfig {
  server: ServerConfig
  client: ClientConfig
  api_key: string
  tray: TrayConfig
}

// ============ WebSocket 配置 ============

export interface WebSocketConfig {
  host: string
  port: number
  apiKey: string
}

// ============ WebSocket 消息类型 ============

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
  eventType: string
}

export interface UnregisteredMessage {
  type: 'unregistered'
  eventType: string
}

export interface EventPushMessage<T = unknown> {
  type: 'event'
  eventType: string
  payload: T
  scope?: string
  timestamp: number
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | ConnectedMessage
  | AuthenticatedMessage
  | RegisteredMessage
  | UnregisteredMessage
  | EventPushMessage
  | ErrorMessage
  | { type: 'pong' }

export interface RegisterEventMessage {
  type: 'register'
  eventType: string
  scope?: string
}

export interface UnregisterEventMessage {
  type: 'unregister'
  eventType: string
}

export interface AuthMessage {
  type: 'auth'
  apiKey: string
}

export interface PingMessage {
  type: 'ping'
}

export type ClientMessage =
  | AuthMessage
  | RegisterEventMessage
  | UnregisterEventMessage
  | PingMessage

// ============ 事件载荷类型 ============

export interface NotificationPayload {
  title: string
  body?: string
}

// ============ WebSocket 客户端事件 ============

export type WebSocketEventType = 'connected' | 'disconnected' | 'error' | 'notification'

export interface WebSocketClientEventMap {
  connected: ConnectedMessage
  disconnected: void
  error: Error
  notification: NotificationPayload
}

export type WebSocketEventHandler<T extends WebSocketEventType> = (
  data: WebSocketClientEventMap[T]
) => void
