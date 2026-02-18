/**
 * 操作审计日志管理器 - 核心逻辑
 * 支持 Agent 和 User 双来源审计
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '../../logger'
import * as auditStore from './auditStore'
import type { AgentAuditEntry, AuditEntryInput, AuditQueryFilter, AuditActorType } from './types'

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

/** Actor 参数用于 record() */
export interface RecordActorInfo {
  actorType: AuditActorType
  sessionId?: string
  clientId?: string
}

/**
 * 记录一条审计日志。
 * 支持两种调用签名：
 *   - record(scope, sessionId, input)          — 兼容旧 Agent 路径
 *   - record(scope, actor, input)              — 新统一路径（支持 user/system）
 */
export function record(
  scope: string,
  sessionIdOrActor: string | RecordActorInfo,
  input: AuditEntryInput
): AgentAuditEntry {
  let actorType: AuditActorType
  let sessionId: string | undefined
  let clientId: string | undefined

  if (typeof sessionIdOrActor === 'string') {
    actorType = 'agent'
    sessionId = sessionIdOrActor
  } else {
    actorType = sessionIdOrActor.actorType
    sessionId = sessionIdOrActor.sessionId
    clientId = sessionIdOrActor.clientId
  }

  const entry: AgentAuditEntry = {
    id: randomUUID(),
    scope,
    actorType,
    sessionId,
    clientId,
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
