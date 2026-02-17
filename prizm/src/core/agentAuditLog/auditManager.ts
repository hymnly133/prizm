/**
 * Agent 审计日志管理器 - 核心逻辑
 * 提供日志记录和查询的高层 API
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '../../logger'
import * as auditStore from './auditStore'
import type { AgentAuditEntry, AuditEntryInput, AuditQueryFilter } from './types'

const log = createLogger('AuditManager')

/** 数据留存清理间隔：每天一次 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

let _pruneTimer: ReturnType<typeof setInterval> | null = null

/** 初始化审计管理器 */
export function init(): void {
  auditStore.initAuditStore()
  pruneOldEntries()
  if (!_pruneTimer) {
    _pruneTimer = setInterval(pruneOldEntries, PRUNE_INTERVAL_MS)
    if (_pruneTimer.unref) _pruneTimer.unref()
  }
}

/** 关闭审计管理器 */
export function shutdown(): void {
  if (_pruneTimer) {
    clearInterval(_pruneTimer)
    _pruneTimer = null
  }
  auditStore.closeAuditStore()
}

/**
 * 记录一条审计日志。
 * scope/sessionId/timestamp 由调用方显式传入（非自动填充），保持灵活性。
 */
export function record(scope: string, sessionId: string, input: AuditEntryInput): AgentAuditEntry {
  const entry: AgentAuditEntry = {
    id: randomUUID(),
    scope,
    sessionId,
    timestamp: Date.now(),
    ...input
  }
  auditStore.insertEntry(entry)
  return entry
}

/** 查询审计日志 */
export function query(filter?: AuditQueryFilter): AgentAuditEntry[] {
  return auditStore.queryEntries(filter)
}

/** 查询指定资源的操作历史 */
export function getResourceHistory(
  scope: string,
  resourceType: string,
  resourceId: string,
  limit?: number
): AgentAuditEntry[] {
  return auditStore.getResourceHistory(scope, resourceType, resourceId, limit)
}

/** 获取会话的审计日志条数 */
export function countSessionEntries(scope: string, sessionId: string): number {
  return auditStore.countSessionEntries(scope, sessionId)
}

/** 清理过期审计日志 */
export function pruneOldEntries(retentionDays = 90): void {
  try {
    const count = auditStore.pruneOldEntries(retentionDays)
    if (count > 0) {
      log.info('Pruned %d audit entries older than %d days', count, retentionDays)
    }
  } catch (err) {
    log.warn('Failed to prune audit entries:', err)
  }
}
