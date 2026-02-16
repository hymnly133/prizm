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

// ============ 终端 WebSocket 消息（专用 /ws/terminal 通道） ============

/** 终端附着消息 */
export interface TerminalAttachMessage {
  type: 'terminal:attach'
  terminalId: string
}

/** 终端输入消息 */
export interface TerminalInputMessage {
  type: 'terminal:input'
  terminalId: string
  data: string
}

/** 终端尺寸调整消息 */
export interface TerminalResizeMessage {
  type: 'terminal:resize'
  terminalId: string
  cols: number
  rows: number
}

/** 终端分离消息 */
export interface TerminalDetachMessage {
  type: 'terminal:detach'
  terminalId: string
}

/** 终端 Ping 消息 */
export interface TerminalPingMessage {
  type: 'terminal:ping'
}

/** 客户端 -> 服务端的终端消息 */
export type TerminalClientMessage =
  | TerminalAttachMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalDetachMessage
  | TerminalPingMessage

/** 终端输出消息 */
export interface TerminalOutputMessage {
  type: 'terminal:output'
  terminalId: string
  data: string
}

/** 终端退出消息 */
export interface TerminalExitMessage {
  type: 'terminal:exit'
  terminalId: string
  exitCode: number
  signal?: number
}

/** 终端附着确认消息 */
export interface TerminalAttachedMessage {
  type: 'terminal:attached'
  terminalId: string
}

/** 终端标题变更消息 */
export interface TerminalTitleMessage {
  type: 'terminal:title'
  terminalId: string
  title: string
}

/** 终端错误消息 */
export interface TerminalErrorMessage {
  type: 'terminal:error'
  terminalId: string
  message: string
}

/** 终端 Pong 消息 */
export interface TerminalPongMessage {
  type: 'terminal:pong'
}

/** 服务端 -> 客户端的终端消息 */
export type TerminalServerMessage =
  | TerminalOutputMessage
  | TerminalExitMessage
  | TerminalAttachedMessage
  | TerminalTitleMessage
  | TerminalErrorMessage
  | TerminalPongMessage

/** 所有终端 WebSocket 消息 */
export type TerminalWebSocketMessage = TerminalClientMessage | TerminalServerMessage

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
