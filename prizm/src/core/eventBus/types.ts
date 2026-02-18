/**
 * 领域事件类型定义
 * 定义系统内部各模块之间通过 EventBus 通信的事件映射
 */

import type { AgentMessage, OperationActor, MemoryIdsByLayer, BgTriggerType } from '@prizm/shared'
import type { AuditEntryInput } from '../agentAuditLog'
import type { LockableResourceType } from '../resourceLockManager'

// ─── Agent 生命周期事件 ───

export interface AgentSessionCreatedEvent {
  scope: string
  sessionId: string
  /** 操作者身份 */
  actor?: OperationActor
}

export interface AgentSessionDeletedEvent {
  scope: string
  sessionId: string
  /** 操作者身份 */
  actor?: OperationActor
}

export interface AgentMessageCompletedEvent {
  scope: string
  sessionId: string
  /** 本轮完整的用户+助手消息 */
  messages: AgentMessage[]
  /** 消息唯一 ID（用于去重） */
  roundMessageId?: string
  /** 操作者身份 */
  actor?: OperationActor
}

export interface AgentSessionCompressingEvent {
  scope: string
  sessionId: string
  /** 被压缩的旧轮次消息 */
  rounds: AgentMessage[]
}

export interface AgentSessionRolledBackEvent {
  scope: string
  sessionId: string
  /** 回退目标 checkpoint */
  checkpointId: string
  /** 目标 checkpoint 的消息索引 */
  checkpointMessageIndex: number
  /** 被移除的 checkpoint ID 列表 */
  removedCheckpointIds: string[]
  /** 从被移除消息的 memoryRefs.created 中汇总的 P1 记忆 ID */
  removedMemoryIds: MemoryIdsByLayer
  /** 创建回退导致的文档删除 */
  deletedDocumentIds: string[]
  /** 回退恢复的文档（update/delete rollback） */
  restoredDocumentIds: string[]
  /** 截断后剩余消息数 */
  remainingMessageCount: number
  /** 操作者身份 */
  actor?: OperationActor
}

// ─── Tool 执行事件 ───

export interface ToolExecutedEvent {
  scope: string
  sessionId: string
  toolName: string
  /** 审计数据，由 handler 写入 auditManager */
  auditInput: AuditEntryInput
  /** 操作者身份 */
  actor?: OperationActor
}

// ─── 文档生命周期事件 ───

export interface DocumentSavedEvent {
  scope: string
  documentId: string
  title: string
  content: string
  previousContent?: string
  version?: number
  /** 操作者身份 */
  actor?: OperationActor
  changeReason?: string
  /**
   * @deprecated 使用 actor 替代
   */
  changedBy?: {
    type: 'agent' | 'user'
    sessionId?: string
    apiSource?: string
  }
}

export interface DocumentDeletedEvent {
  scope: string
  documentId: string
  /** 操作者身份 */
  actor?: OperationActor
}

// ─── 资源锁事件 ───

export interface ResourceLockChangedEvent {
  action: 'locked' | 'unlocked'
  scope: string
  resourceType: LockableResourceType
  resourceId: string
  sessionId?: string
  reason?: string
}

// ─── 文件操作事件 ───

export interface FileOperationEvent {
  action: 'created' | 'moved' | 'deleted'
  scope: string
  relativePath: string
  fromPath?: string
  /** 操作者身份 */
  actor?: OperationActor
}

// ─── Todo 操作事件 ───

export interface TodoMutatedEvent {
  action: 'created' | 'updated' | 'deleted'
  scope: string
  /** 目标资源类型 */
  resourceType: 'list' | 'item'
  /** list ID */
  listId: string
  /** item ID（仅 resourceType='item' 时有值） */
  itemId?: string
  /** 操作者身份 */
  actor?: OperationActor
  /** item 级数据，供客户端增量更新（仅 resourceType='item' 时携带） */
  title?: string
  description?: string
  status?: string
  createdAt?: number
  updatedAt?: number
}

// ─── Clipboard 操作事件 ───

export interface ClipboardMutatedEvent {
  action: 'added' | 'deleted'
  scope: string
  itemId: string
  /** 操作者身份 */
  actor?: OperationActor
  /** added 时携带完整数据，供客户端零请求增量插入 */
  itemType?: string
  content?: string
  sourceApp?: string
  createdAt?: number
}

// ─── BG Session 生命周期事件 ───

export interface BgSessionTriggeredEvent {
  scope: string
  sessionId: string
  triggerType: BgTriggerType
  parentSessionId?: string
  label?: string
}

export interface BgSessionStartedEvent {
  scope: string
  sessionId: string
}

export interface BgSessionCompletedEvent {
  scope: string
  sessionId: string
  result: string
  durationMs: number
}

export interface BgSessionFailedEvent {
  scope: string
  sessionId: string
  error: string
  durationMs: number
}

export interface BgSessionTimeoutEvent {
  scope: string
  sessionId: string
  timeoutMs: number
}

export interface BgSessionCancelledEvent {
  scope: string
  sessionId: string
}

// ─── 统一领域事件映射 ───

export interface DomainEventMap {
  // Agent 生命周期
  'agent:session.created': AgentSessionCreatedEvent
  'agent:session.deleted': AgentSessionDeletedEvent
  'agent:message.completed': AgentMessageCompletedEvent
  'agent:session.compressing': AgentSessionCompressingEvent
  'agent:session.rolledBack': AgentSessionRolledBackEvent

  // Tool 执行（审计用）
  'tool:executed': ToolExecutedEvent

  // 文档
  'document:saved': DocumentSavedEvent
  'document:deleted': DocumentDeletedEvent

  // 资源锁
  'resource:lock.changed': ResourceLockChangedEvent

  // 文件操作
  'file:operation': FileOperationEvent

  // Todo
  'todo:mutated': TodoMutatedEvent

  // Clipboard
  'clipboard:mutated': ClipboardMutatedEvent

  // BG Session 生命周期
  'bg:session.triggered': BgSessionTriggeredEvent
  'bg:session.started': BgSessionStartedEvent
  'bg:session.completed': BgSessionCompletedEvent
  'bg:session.failed': BgSessionFailedEvent
  'bg:session.timeout': BgSessionTimeoutEvent
  'bg:session.cancelled': BgSessionCancelledEvent
}

/** 领域事件名称 */
export type DomainEventName = keyof DomainEventMap
