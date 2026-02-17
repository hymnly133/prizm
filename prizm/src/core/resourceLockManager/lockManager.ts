/**
 * 资源锁定管理器 - 核心逻辑
 * Fencing Token 模式防止过期锁持有者脏写
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '../../logger'
import * as lockStore from './lockStore'
import type {
  LockableResourceType,
  ResourceLock,
  AcquireLockResult,
  ResourceStatus,
  ResourceReadRecord
} from './types'
import { DEFAULT_LOCK_TTL_MS } from './types'

const log = createLogger('LockManager')

/** 定期清理间隔：60 秒 */
const CLEANUP_INTERVAL_MS = 60_000
/** 读取记录清理间隔：每天一次 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

let _cleanupTimer: ReturnType<typeof setInterval> | null = null
let _pruneTimer: ReturnType<typeof setInterval> | null = null

/** 初始化锁管理器（建表 + 启动定期清理） */
export function init(): void {
  lockStore.initLockStore()
  cleanupExpired()
  pruneOldReadRecords()
  if (!_cleanupTimer) {
    _cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS)
    if (_cleanupTimer.unref) _cleanupTimer.unref()
  }
  if (!_pruneTimer) {
    _pruneTimer = setInterval(() => pruneOldReadRecords(), PRUNE_INTERVAL_MS)
    if (_pruneTimer.unref) _pruneTimer.unref()
  }
}

/** 关闭锁管理器 */
export function shutdown(): void {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer)
    _cleanupTimer = null
  }
  if (_pruneTimer) {
    clearInterval(_pruneTimer)
    _pruneTimer = null
  }
  lockStore.closeLockStore()
}

/** 最大 TTL 限制：1 小时 */
const MAX_TTL_MS = 3_600_000
/** 最大 reason 长度 */
const MAX_REASON_LENGTH = 500

function validateLockInput(scope: string, resourceId: string, sessionId: string): void {
  if (!scope || typeof scope !== 'string') throw new Error('scope is required')
  if (!resourceId || typeof resourceId !== 'string') throw new Error('resourceId is required')
  if (!sessionId || typeof sessionId !== 'string') throw new Error('sessionId is required')
}

/**
 * 获取独占锁。
 * - 如果资源未锁定或锁已过期，则获取成功
 * - 如果已被同一 session 锁定，刷新心跳并返回当前锁
 * - 如果已被其他 session 锁定，返回失败及占用者信息
 */
export function acquireLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string,
  reason?: string,
  ttlMs?: number
): AcquireLockResult {
  validateLockInput(scope, resourceId, sessionId)
  const effectiveTtl = Math.max(1, Math.min(ttlMs ?? DEFAULT_LOCK_TTL_MS, MAX_TTL_MS))
  const sanitizedReason = reason ? reason.slice(0, MAX_REASON_LENGTH) : undefined

  // 整个获取锁流程在 SQLite 事务中执行，防止并发请求导致重复获取
  return lockStore.runInTransaction(() => {
    const existing = lockStore.getLock(scope, resourceType, resourceId)

    if (existing) {
      // 同一 session 重入：刷新心跳
      if (existing.sessionId === sessionId) {
        lockStore.updateHeartbeat(scope, resourceType, resourceId, sessionId)
        const refreshed = lockStore.getLock(scope, resourceType, resourceId)
        return { success: true, lock: refreshed ?? existing }
      }

      // 检查是否过期
      const now = Date.now()
      if (now < existing.lastHeartbeat + existing.ttlMs) {
        // 锁仍有效，拒绝
        return {
          success: false,
          heldBy: {
            sessionId: existing.sessionId,
            acquiredAt: existing.acquiredAt,
            reason: existing.reason
          }
        }
      }

      // 锁已过期，清理并重新获取
      lockStore.deleteLock(scope, resourceType, resourceId)
      log.info(
        'Expired lock cleaned for %s:%s (was held by %s)',
        resourceType,
        resourceId,
        existing.sessionId
      )
    }

    // 获取新的 fence token
    const fenceToken = lockStore.nextFenceToken(scope, resourceType, resourceId)
    const now = Date.now()

    const lock: ResourceLock = {
      id: randomUUID(),
      resourceType,
      resourceId,
      scope,
      sessionId,
      fenceToken,
      reason: sanitizedReason,
      acquiredAt: now,
      lastHeartbeat: now,
      ttlMs: effectiveTtl
    }

    lockStore.upsertLock(lock)
    log.info(
      'Lock acquired: %s:%s by session %s (fence=%d)',
      resourceType,
      resourceId,
      sessionId,
      fenceToken
    )
    return { success: true, lock }
  })
}

/** 释放锁（仅锁持有者可释放） */
export function releaseLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string
): boolean {
  validateLockInput(scope, resourceId, sessionId)
  const existing = lockStore.getLock(scope, resourceType, resourceId)
  if (!existing) return false
  if (existing.sessionId !== sessionId) return false

  lockStore.deleteLock(scope, resourceType, resourceId)
  log.info('Lock released: %s:%s by session %s', resourceType, resourceId, sessionId)
  return true
}

/** 验证 fence token（写入前调用，确保当前写入者持有最新锁） */
export function validateFence(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  fenceToken: number
): boolean {
  const existing = lockStore.getLock(scope, resourceType, resourceId)
  if (!existing) return false
  return existing.fenceToken === fenceToken
}

/** 心跳续期 */
export function heartbeat(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string
): boolean {
  return lockStore.updateHeartbeat(scope, resourceType, resourceId, sessionId)
}

/** 获取锁（如果存在且未过期） */
export function getLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): ResourceLock | null {
  const lock = lockStore.getLock(scope, resourceType, resourceId)
  if (!lock) return null
  // 检查过期
  const now = Date.now()
  if (now >= lock.lastHeartbeat + lock.ttlMs) {
    lockStore.deleteLock(scope, resourceType, resourceId)
    return null
  }
  return lock
}

/** 更新锁的元数据（如 todo claim 的活跃项） */
export function updateLockMetadata(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string,
  metadata: Record<string, unknown>
): boolean {
  return lockStore.updateLockMetadata(
    scope,
    resourceType,
    resourceId,
    sessionId,
    JSON.stringify(metadata)
  )
}

/** 获取资源完整状态（锁 + 读取历史） */
export function getResourceStatus(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): ResourceStatus {
  const lock = getLock(scope, resourceType, resourceId)
  const recentReads = lockStore.getRecentReads(scope, resourceType, resourceId, 20)
  return { resourceType, resourceId, scope, lock, recentReads }
}

/** 强制释放锁（无论谁持有） */
export function forceReleaseLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): ResourceLock | null {
  const existing = lockStore.getLock(scope, resourceType, resourceId)
  if (!existing) return null
  lockStore.deleteLock(scope, resourceType, resourceId)
  log.info(
    'Lock force-released: %s:%s (was held by %s)',
    resourceType,
    resourceId,
    existing.sessionId
  )
  return existing
}

/** 释放会话持有的所有锁 */
export function releaseSessionLocks(scope: string, sessionId: string): number {
  const count = lockStore.deleteSessionLocks(scope, sessionId)
  if (count > 0) {
    log.info('Released %d locks for session %s in scope %s', count, sessionId, scope)
  }
  return count
}

/** 列出会话持有的所有锁 */
export function listSessionLocks(scope: string, sessionId: string): ResourceLock[] {
  return lockStore.listSessionLocks(scope, sessionId)
}

/** 列出 scope 下所有活跃锁 */
export function listScopeLocks(scope: string): ResourceLock[] {
  return lockStore.listScopeLocks(scope)
}

/** 记录资源读取 */
export function recordRead(
  scope: string,
  sessionId: string,
  resourceType: LockableResourceType,
  resourceId: string,
  version: number
): void {
  const record: ResourceReadRecord = {
    id: randomUUID(),
    scope,
    sessionId,
    resourceType,
    resourceId,
    readVersion: version,
    readAt: Date.now()
  }
  lockStore.insertReadRecord(record)
}

/** 清理过期锁 */
export function cleanupExpired(): void {
  const count = lockStore.deleteExpiredLocks()
  if (count > 0) {
    log.info('Cleaned up %d expired locks', count)
  }
}

/** 清理过期读取记录 */
export function pruneOldReadRecords(retentionDays = 30): void {
  try {
    const count = lockStore.pruneOldReadRecords(retentionDays)
    if (count > 0) {
      log.info('Pruned %d read records older than %d days', count, retentionDays)
    }
  } catch (err) {
    log.warn('Failed to prune read records:', err)
  }
}
