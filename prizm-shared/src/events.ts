/**
 * 服务端 WebSocket 事件类型
 * 单一数据源：数组为权威定义，对象形式供 server 键式访问
 */

import type {
  NotificationPayload,
  ClipboardItem,
  Document,
  TodoItem,
  TerminalSession
} from './domain'

export const EVENT_TYPES = [
  'notification',
  'smtc:change',
  'todo_list:created',
  'todo_list:updated',
  'todo_list:deleted',
  'todo_item:created',
  'todo_item:updated',
  'todo_item:deleted',
  'clipboard:itemAdded',
  'clipboard:itemDeleted',
  'document:created',
  'document:updated',
  'document:deleted',
  'file:created',
  'file:updated',
  'file:deleted',
  'file:moved',
  'terminal:created',
  'terminal:exited',
  'terminal:killed',
  'resource:locked',
  'resource:unlocked',
  'agent:session.created',
  'agent:session.deleted',
  'agent:session.rolledBack',
  'agent:session.chatStatusChanged',
  'agent:message.completed',
  'bg:session.completed',
  'bg:session.failed',
  'bg:session.timeout',
  'bg:session.cancelled',
  'schedule:created',
  'schedule:updated',
  'schedule:deleted',
  'schedule:reminded',
  'cron:job.created',
  'cron:job.executed',
  'cron:job.failed',
  'document:memory.updated',
  'task:started',
  'task:completed',
  'task:failed',
  'task:cancelled',
  'workflow:started',
  'workflow:step.completed',
  'workflow:paused',
  'workflow:completed',
  'workflow:failed'
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 对象形式，供 server 使用 EVENT_TYPES_OBJ.DOCUMENT_CREATED 等键式访问 */
export const EVENT_TYPES_OBJ = {
  NOTIFICATION: 'notification',
  SMTC_CHANGE: 'smtc:change',
  TODO_LIST_CREATED: 'todo_list:created',
  TODO_LIST_UPDATED: 'todo_list:updated',
  TODO_LIST_DELETED: 'todo_list:deleted',
  TODO_ITEM_CREATED: 'todo_item:created',
  TODO_ITEM_UPDATED: 'todo_item:updated',
  TODO_ITEM_DELETED: 'todo_item:deleted',
  CLIPBOARD_ITEM_ADDED: 'clipboard:itemAdded',
  CLIPBOARD_ITEM_DELETED: 'clipboard:itemDeleted',
  DOCUMENT_CREATED: 'document:created',
  DOCUMENT_UPDATED: 'document:updated',
  DOCUMENT_DELETED: 'document:deleted',
  FILE_CREATED: 'file:created',
  FILE_UPDATED: 'file:updated',
  FILE_DELETED: 'file:deleted',
  FILE_MOVED: 'file:moved',
  TERMINAL_CREATED: 'terminal:created',
  TERMINAL_EXITED: 'terminal:exited',
  TERMINAL_KILLED: 'terminal:killed',
  RESOURCE_LOCKED: 'resource:locked',
  RESOURCE_UNLOCKED: 'resource:unlocked',
  AGENT_SESSION_CREATED: 'agent:session.created',
  AGENT_SESSION_DELETED: 'agent:session.deleted',
  AGENT_SESSION_ROLLED_BACK: 'agent:session.rolledBack',
  AGENT_SESSION_CHAT_STATUS_CHANGED: 'agent:session.chatStatusChanged',
  AGENT_MESSAGE_COMPLETED: 'agent:message.completed',
  BG_SESSION_COMPLETED: 'bg:session.completed',
  BG_SESSION_FAILED: 'bg:session.failed',
  BG_SESSION_TIMEOUT: 'bg:session.timeout',
  BG_SESSION_CANCELLED: 'bg:session.cancelled',
  SCHEDULE_CREATED: 'schedule:created',
  SCHEDULE_UPDATED: 'schedule:updated',
  SCHEDULE_DELETED: 'schedule:deleted',
  SCHEDULE_REMINDED: 'schedule:reminded',
  CRON_JOB_CREATED: 'cron:job.created',
  CRON_JOB_EXECUTED: 'cron:job.executed',
  CRON_JOB_FAILED: 'cron:job.failed',
  DOCUMENT_MEMORY_UPDATED: 'document:memory.updated',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_CANCELLED: 'task:cancelled',
  WORKFLOW_STARTED: 'workflow:started',
  WORKFLOW_STEP_COMPLETED: 'workflow:step.completed',
  WORKFLOW_PAUSED: 'workflow:paused',
  WORKFLOW_COMPLETED: 'workflow:completed',
  WORKFLOW_FAILED: 'workflow:failed'
} as const satisfies Record<string, EventType>

/** 服务端全部事件类型（用于 subscribeEvents: "all"） */
export const ALL_EVENTS: readonly string[] = [...EVENT_TYPES]

/** 数据同步事件：任务/剪贴板/文档/文件变更时触发，用于客户端实时刷新列表 */
export const DATA_SYNC_EVENTS = [
  'todo_list:created',
  'todo_list:updated',
  'todo_list:deleted',
  'todo_item:created',
  'todo_item:updated',
  'todo_item:deleted',
  'clipboard:itemAdded',
  'clipboard:itemDeleted',
  'document:created',
  'document:updated',
  'document:deleted',
  'file:created',
  'file:updated',
  'file:deleted',
  'file:moved',
  'agent:session.created',
  'agent:session.deleted',
  'agent:session.rolledBack',
  'agent:session.chatStatusChanged',
  'agent:message.completed',
  'bg:session.completed',
  'bg:session.failed',
  'bg:session.timeout',
  'bg:session.cancelled',
  'schedule:created',
  'schedule:updated',
  'schedule:deleted',
  'schedule:reminded',
  'cron:job.created',
  'cron:job.executed',
  'cron:job.failed',
  'document:memory.updated',
  'task:started',
  'task:completed',
  'task:failed',
  'task:cancelled',
  'workflow:started',
  'workflow:step.completed',
  'workflow:paused',
  'workflow:completed',
  'workflow:failed'
] as const

export type DataSyncEventType = (typeof DATA_SYNC_EVENTS)[number]

/** 判断是否为数据同步事件 */
export function isDataSyncEvent(eventType: string): eventType is DataSyncEventType {
  return (DATA_SYNC_EVENTS as readonly string[]).includes(eventType)
}

// ============ Event-Payload 类型映射 ============

/** 带 scope 和 sourceClientId 的通用事件载荷基类 */
export interface EventPayloadBase {
  scope?: string
  sourceClientId?: string
}

/** TODO 列表更新载荷（listId 显式，与 id 语义区分） */
export interface TodoListUpdatePayload extends EventPayloadBase {
  listId?: string
  title?: string
  itemCount?: number
  doneCount?: number
  items?: TodoItem[]
  updatedAt?: number
  deleted?: boolean
  /** 仅 title 变更时省略 items，客户端做本地合并 */
  itemsOmitted?: true
}

/** TODO 列表删除载荷 */
export interface TodoListDeletedPayload extends EventPayloadBase {
  scope: string
  listId?: string
  deleted: true
}

/** TODO 项删除载荷 */
export interface TodoItemDeletedPayload extends EventPayloadBase {
  itemId: string
  scope?: string
}

/** SMTC 媒体控制载荷 */
export interface SMTCPayload extends EventPayloadBase {
  sessionId?: string
  action: 'play' | 'pause' | 'stop' | 'skipNext' | 'skipPrevious' | 'toggle'
}

/** 文件事件载荷 */
export interface FileEventPayload extends EventPayloadBase {
  /** 相对 scopeRoot 的路径 */
  relativePath: string
  /** 旧路径（仅 file:moved 事件） */
  oldRelativePath?: string
  isDir?: boolean
}

/** 资源锁事件载荷 */
export interface ResourceLockEventPayload extends EventPayloadBase {
  resourceType: 'document' | 'todo_list'
  resourceId: string
  sessionId?: string
  reason?: string
}

/** Agent 会话事件载荷 */
export interface AgentSessionEventPayload extends EventPayloadBase {
  sessionId: string
}

/** Agent 会话回退事件载荷 */
export interface AgentSessionRolledBackPayload extends EventPayloadBase {
  sessionId: string
  checkpointId: string
  remainingMessageCount: number
}

/** Agent 会话对话状态变更载荷 */
export interface AgentSessionChatStatusChangedPayload extends EventPayloadBase {
  sessionId: string
  chatStatus: import('./domain').SessionChatStatus
}

/** Agent 消息完成事件载荷 */
export interface AgentMessageCompletedPayload extends EventPayloadBase {
  sessionId: string
}

/** BG Session 事件载荷 */
export interface BgSessionEventPayload extends EventPayloadBase {
  sessionId: string
  triggerType?: string
  parentSessionId?: string
  label?: string
  result?: string
  error?: string
  durationMs?: number
  timeoutMs?: number
}

/** Schedule 事件载荷 */
export interface ScheduleEventPayload extends EventPayloadBase {
  scheduleId: string
  title?: string
  type?: string
  startTime?: number
  endTime?: number
  status?: string
}

/** Schedule 提醒事件载荷 */
export interface ScheduleRemindedPayload extends EventPayloadBase {
  scheduleId: string
  title: string
  startTime: number
  reminderMinutes: number
}

/** Cron Job 创建事件载荷 */
export interface CronJobCreatedPayload extends EventPayloadBase {
  jobId: string
  name: string
  schedule: string
}

/** Cron Job 执行事件载荷 */
export interface CronJobExecutedPayload extends EventPayloadBase {
  jobId: string
  name?: string
  sessionId?: string
  status: string
  durationMs?: number
  error?: string
}

/** Cron Job 失败事件载荷 */
export interface CronJobFailedPayload extends EventPayloadBase {
  jobId: string
  error: string
}

/** 文档记忆更新事件载荷 */
export interface DocumentMemoryUpdatedPayload extends EventPayloadBase {
  documentId: string
  title: string
  updatedSubTypes: string[]
}

/** Task 事件载荷 */
export interface TaskStartedPayload extends EventPayloadBase {
  taskId: string
  label?: string
}

export interface TaskCompletedPayload extends EventPayloadBase {
  taskId: string
  label?: string
  durationMs?: number
}

export interface TaskFailedPayload extends EventPayloadBase {
  taskId: string
  label?: string
  error: string
}

export interface TaskCancelledPayload extends EventPayloadBase {
  taskId: string
  label?: string
}

/** Workflow 事件载荷 */
export interface WorkflowStartedPayload extends EventPayloadBase {
  runId: string
  workflowName: string
}

export interface WorkflowStepCompletedPayload extends EventPayloadBase {
  runId: string
  stepId: string
  stepStatus: string
  outputPreview?: string
  approved?: boolean
}

export interface WorkflowPausedPayload extends EventPayloadBase {
  runId: string
  workflowName: string
  stepId: string
  approvePrompt: string
}

export interface WorkflowCompletedPayload extends EventPayloadBase {
  runId: string
  workflowName: string
  finalOutput?: string
}

export interface WorkflowFailedPayload extends EventPayloadBase {
  runId: string
  workflowName: string
  error: string
}

/** 各事件类型对应的 payload 类型 */
export interface EventPayloadMap {
  notification: NotificationPayload
  'smtc:change': SMTCPayload
  'todo_list:created': import('./domain').TodoList & { listId: string } & EventPayloadBase
  'todo_list:updated': TodoListUpdatePayload
  'todo_list:deleted': TodoListDeletedPayload
  'todo_item:created': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:updated': TodoItem & { itemId: string; listId: string } & EventPayloadBase
  'todo_item:deleted': TodoItemDeletedPayload
  'clipboard:itemAdded': ClipboardItem & EventPayloadBase
  'clipboard:itemDeleted': { id: string } & EventPayloadBase
  'document:created': Partial<Document> & EventPayloadBase
  'document:updated': Partial<Document> & EventPayloadBase
  'document:deleted': { id: string } & EventPayloadBase
  'file:created': FileEventPayload
  'file:updated': FileEventPayload
  'file:deleted': FileEventPayload
  'file:moved': FileEventPayload
  'terminal:created': TerminalSession & EventPayloadBase
  'terminal:exited': { id: string; exitCode: number; signal?: number } & EventPayloadBase
  'terminal:killed': { id: string } & EventPayloadBase
  'resource:locked': ResourceLockEventPayload
  'resource:unlocked': ResourceLockEventPayload
  'agent:session.created': AgentSessionEventPayload
  'agent:session.deleted': AgentSessionEventPayload
  'agent:session.rolledBack': AgentSessionRolledBackPayload
  'agent:session.chatStatusChanged': AgentSessionChatStatusChangedPayload
  'agent:message.completed': AgentMessageCompletedPayload
  'bg:session.completed': BgSessionEventPayload
  'bg:session.failed': BgSessionEventPayload
  'bg:session.timeout': BgSessionEventPayload
  'bg:session.cancelled': BgSessionEventPayload
  'schedule:created': ScheduleEventPayload
  'schedule:updated': ScheduleEventPayload
  'schedule:deleted': { scheduleId: string } & EventPayloadBase
  'schedule:reminded': ScheduleRemindedPayload
  'cron:job.created': CronJobCreatedPayload
  'cron:job.executed': CronJobExecutedPayload
  'cron:job.failed': CronJobFailedPayload
  'document:memory.updated': DocumentMemoryUpdatedPayload
  'task:started': TaskStartedPayload
  'task:completed': TaskCompletedPayload
  'task:failed': TaskFailedPayload
  'task:cancelled': TaskCancelledPayload
  'workflow:started': WorkflowStartedPayload
  'workflow:step.completed': WorkflowStepCompletedPayload
  'workflow:paused': WorkflowPausedPayload
  'workflow:completed': WorkflowCompletedPayload
  'workflow:failed': WorkflowFailedPayload
}

/** 类型安全的 EventPushMessage，payload 与 eventType 对应 */
export interface TypedEventPushMessage<T extends EventType = EventType> {
  type: 'event'
  eventType: T
  payload: EventPayloadMap[T]
  scope?: string
  timestamp: number
}
