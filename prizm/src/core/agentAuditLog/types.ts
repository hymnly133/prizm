/**
 * Agent 操作审计日志 - 类型定义
 * 与记忆系统枚举（MemoryType / DocumentSubType）对齐
 */

import type { ScopeActivityAction, ScopeActivityItemKind } from '@prizm/shared'

/** 审计动作，扩展自 ScopeActivityAction + 锁定/领取/强制介入操作 */
export type AuditAction =
  | ScopeActivityAction
  | 'checkout'
  | 'checkin'
  | 'claim'
  | 'release'
  | 'force_release'
  | 'force_override'

/** 审计资源类型，复用 ScopeActivityItemKind 并扩展 */
export type AuditResourceType = ScopeActivityItemKind | 'todo_list' | 'memory'

/** 审计结果 */
export type AuditResult = 'success' | 'error' | 'denied'

/** 审计日志条目 */
export interface AgentAuditEntry {
  id: string
  scope: string
  sessionId: string
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

/** 创建审计条目时的输入（id/scope/sessionId/timestamp 由管理器自动填充） */
export type AuditEntryInput = Omit<AgentAuditEntry, 'id' | 'scope' | 'sessionId' | 'timestamp'>

/** 审计日志查询过滤器 */
export interface AuditQueryFilter {
  scope?: string
  sessionId?: string
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
