/**
 * 服务端 WebSocket 事件类型
 * 与 server EVENT_TYPES 对应
 */

export const EVENT_TYPES = [
  'notification',
  'smtc:change',
  'note:created',
  'note:updated',
  'note:deleted',
  'group:created',
  'group:updated',
  'group:deleted',
  'todo_list:updated',
  'pomodoro:started',
  'pomodoro:stopped',
  'clipboard:itemAdded',
  'clipboard:itemDeleted',
  'document:created',
  'document:updated',
  'document:deleted'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 服务端全部事件类型（用于 subscribeEvents: "all"） */
export const ALL_EVENTS: readonly string[] = [...EVENT_TYPES]
