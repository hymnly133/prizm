/**
 * Prizm WebSocket 消息类型定义
 */

import {
  EVENT_TYPES_OBJ,
  type EventType,
  type AuthMessage,
  type RegisterEventMessage,
  type UnregisterEventMessage,
  type PingMessage,
  type ClientToServerMessage,
  type ConnectedMessage,
  type AuthenticatedMessage,
  type RegisteredMessage,
  type UnregisteredMessage,
  type EventPushMessage,
  type ErrorMessage,
  type ServerToClientMessage,
  type WebSocketMessage,
  isClientMessage,
  isServerMessage,
  type SMTCPayload
} from '@prizm/shared'

/** 事件类型对象，供 server 键式访问（如 EVENT_TYPES.NOTE_CREATED） */
export const EVENT_TYPES = EVENT_TYPES_OBJ

export type { EventType } from '@prizm/shared'

export type {
  AuthMessage,
  RegisterEventMessage,
  UnregisterEventMessage,
  PingMessage,
  ClientToServerMessage,
  ConnectedMessage,
  AuthenticatedMessage,
  RegisteredMessage,
  UnregisteredMessage,
  EventPushMessage,
  ErrorMessage,
  ServerToClientMessage,
  WebSocketMessage
} from '@prizm/shared'

export { isClientMessage, isServerMessage } from '@prizm/shared'

// ============ 事件载荷类型（简化版，与 domain 对齐） ============

export type { SMTCPayload } from '@prizm/shared'

export interface NotePayload {
  id: string
  content: string
  tags?: string[]
}

// ============ WebSocket 配置（Server 专用） ============

export interface WebSocketServerConfig {
  enableWebSocket?: boolean
  websocketPath?: string
}
