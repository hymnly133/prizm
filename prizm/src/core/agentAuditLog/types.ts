/**
 * 操作审计日志 - 类型定义
 * 支持 Agent 和 User 双来源审计
 */

import type { ScopeActivityAction, ScopeActivityItemKind } from '@prizm/shared'

/** 审计动作，扩展自 ScopeActivityAction + 锁定/领取/强制介入/BG 相关操作 */
export type AuditAction =
  | ScopeActivityAction
  | 'checkout'
  | 'checkin'
  | 'claim'
  | 'release'
  | 'force_release'
  | 'force_override'
  | 'spawn'
  | 'bg_trigger'
  | 'bg_set_result'
  | 'bg_cancel'

/** 审计资源类型，复用 ScopeActivityItemKind 并扩展 */
export type AuditResourceType =
  | ScopeActivityItemKind
  | 'todo_list'
  | 'memory'
  | 'session'
  | 'schedule'
  | 'cron_job'
  | 'feedback'

/** 审计结果 */
export type AuditResult = 'success' | 'error' | 'denied'

/** 操作者类型 */
export type AuditActorType = 'agent' | 'user' | 'system'

/** 审计日志条目 */
export interface AgentAuditEntry {
  id: string
  scope: string
  /** 操作者类型 */
  actorType: AuditActorType
  /** Agent session ID（actorType='agent' 时有值） */
  sessionId?: string
  /** API client ID（actorType='user' 时有值） */
  clientId?: string
  toolName: string
  action: AuditAction
  resourceType: AuditResourceType
  resourceId?: string
  resourceTitle?: string
  /** 操作上下文（如工具参数摘要、变更描述） */
  detail?: string
  /** 记忆相关操作时，关联的记忆类型（如 'document' / 'narrative'） */
  memoryType?: string
  /** 文档记忆操作时，关联的子类型（如 'overview' / 'fact' / 'migration'） */
  documentSubType?: string
  result: AuditResult
  errorMessage?: string
  timestamp: number
}

/** 创建审计条目时的输入（id/scope/sessionId/clientId/actorType/timestamp 由管理器自动填充） */
export type AuditEntryInput = Omit<
  AgentAuditEntry,
  'id' | 'scope' | 'sessionId' | 'clientId' | 'actorType' | 'timestamp'
>

/** 审计日志查询过滤器 */
export interface AuditQueryFilter {
  scope?: string
  sessionId?: string
  clientId?: string
  actorType?: AuditActorType
  resourceType?: AuditResourceType
  resourceId?: string
  action?: AuditAction
  result?: AuditResult
  /** 起始时间 (ms) */
  since?: number
  /** 结束时间 (ms) */
  until?: number
  limit?: number
  offset?: number
}
