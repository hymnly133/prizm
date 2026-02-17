/**
 * 资源锁定 SQLite 存储层
 * 文件位置：.prizm-data/resource_locks.db
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from '../PathProviderCore'
import { createLogger } from '../../logger'
import type { ResourceLock, ResourceReadRecord, LockableResourceType } from './types'

const log = createLogger('LockStore')

const LOCK_DB = 'resource_locks.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), LOCK_DB)
}

function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.pragma('busy_timeout = 5000')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      fence_token INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      acquired_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      ttl_ms INTEGER NOT NULL DEFAULT 300000,
      metadata TEXT,
      UNIQUE(scope, resource_type, resource_id)
    );
    CREATE INDEX IF NOT EXISTS idx_locks_session ON resource_locks(session_id);
    CREATE INDEX IF NOT EXISTS idx_locks_scope ON resource_locks(scope);

    CREATE TABLE IF NOT EXISTS resource_read_log (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      read_version INTEGER NOT NULL DEFAULT 0,
      read_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reads_resource ON resource_read_log(scope, resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_reads_session ON resource_read_log(session_id);

    CREATE TABLE IF NOT EXISTS fence_counter (
      scope TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(scope, resource_type, resource_id)
    );
  `)
  return _db
}

/** 在事务中执行操作 */
export function runInTransaction<T>(fn: () => T): T {
  const db = getDb()
  return db.transaction(fn)()
}

/** 初始化数据库 */
export function initLockStore(): void {
  getDb()
  log.info('Lock store initialized at', getDbPath())
}

/** 关闭数据库 */
export function closeLockStore(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** 获取下一个 fence token（单调递增） */
export function nextFenceToken(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO fence_counter (scope, resource_type, resource_id, counter)
    VALUES (@scope, @resourceType, @resourceId, 1)
    ON CONFLICT(scope, resource_type, resource_id) DO UPDATE SET counter = counter + 1
  `)
  stmt.run({ scope, resourceType, resourceId })
  const row = db
    .prepare(
      `SELECT counter FROM fence_counter WHERE scope = ? AND resource_type = ? AND resource_id = ?`
    )
    .get(scope, resourceType, resourceId) as { counter: number } | undefined
  return row?.counter ?? 1
}

/** 插入或替换锁记录 */
export function upsertLock(lock: ResourceLock): void {
  const db = getDb()
  db.prepare(
    `
    INSERT OR REPLACE INTO resource_locks
      (id, resource_type, resource_id, scope, session_id, fence_token, reason, acquired_at, last_heartbeat, ttl_ms, metadata)
    VALUES
      (@id, @resourceType, @resourceId, @scope, @sessionId, @fenceToken, @reason, @acquiredAt, @lastHeartbeat, @ttlMs, @metadata)
  `
  ).run({
    id: lock.id,
    resourceType: lock.resourceType,
    resourceId: lock.resourceId,
    scope: lock.scope,
    sessionId: lock.sessionId,
    fenceToken: lock.fenceToken,
    reason: lock.reason ?? null,
    acquiredAt: lock.acquiredAt,
    lastHeartbeat: lock.lastHeartbeat,
    ttlMs: lock.ttlMs,
    metadata: lock.metadata ?? null
  })
}

/** 读取锁（含过期判断用字段） */
export function getLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): ResourceLock | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT * FROM resource_locks WHERE scope = ? AND resource_type = ? AND resource_id = ?`
    )
    .get(scope, resourceType, resourceId) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToLock(row)
}

/** 删除锁 */
export function deleteLock(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string
): boolean {
  const db = getDb()
  const r = db
    .prepare(`DELETE FROM resource_locks WHERE scope = ? AND resource_type = ? AND resource_id = ?`)
    .run(scope, resourceType, resourceId)
  return r.changes > 0
}

/** 删除指定会话的所有锁 */
export function deleteSessionLocks(scope: string, sessionId: string): number {
  const db = getDb()
  const r = db
    .prepare(`DELETE FROM resource_locks WHERE scope = ? AND session_id = ?`)
    .run(scope, sessionId)
  return r.changes
}

/** 更新心跳时间 */
export function updateHeartbeat(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string
): boolean {
  const db = getDb()
  const now = Date.now()
  const r = db
    .prepare(
      `UPDATE resource_locks SET last_heartbeat = ? WHERE scope = ? AND resource_type = ? AND resource_id = ? AND session_id = ?`
    )
    .run(now, scope, resourceType, resourceId, sessionId)
  return r.changes > 0
}

/** 更新锁元数据 */
export function updateLockMetadata(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  sessionId: string,
  metadata: string
): boolean {
  const db = getDb()
  const r = db
    .prepare(
      `UPDATE resource_locks SET metadata = ? WHERE scope = ? AND resource_type = ? AND resource_id = ? AND session_id = ?`
    )
    .run(metadata, scope, resourceType, resourceId, sessionId)
  return r.changes > 0
}

/** 删除所有已过期的锁（lastHeartbeat + ttlMs < now） */
export function deleteExpiredLocks(): number {
  const db = getDb()
  const now = Date.now()
  const r = db.prepare(`DELETE FROM resource_locks WHERE (last_heartbeat + ttl_ms) < ?`).run(now)
  return r.changes
}

/** 列出会话持有的所有锁 */
export function listSessionLocks(scope: string, sessionId: string): ResourceLock[] {
  const db = getDb()
  const rows = db
    .prepare(`SELECT * FROM resource_locks WHERE scope = ? AND session_id = ?`)
    .all(scope, sessionId) as Array<Record<string, unknown>>
  return rows.map(rowToLock)
}

/** 列出 scope 下所有活跃锁 */
export function listScopeLocks(scope: string): ResourceLock[] {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM resource_locks WHERE scope = ?`).all(scope) as Array<
    Record<string, unknown>
  >
  return rows.map(rowToLock)
}

/** 插入读取记录 */
export function insertReadRecord(record: ResourceReadRecord): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO resource_read_log (id, scope, session_id, resource_type, resource_id, read_version, read_at)
    VALUES (@id, @scope, @sessionId, @resourceType, @resourceId, @readVersion, @readAt)
  `
  ).run({
    id: record.id,
    scope: record.scope,
    sessionId: record.sessionId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    readVersion: record.readVersion,
    readAt: record.readAt
  })
}

/** 查询资源的最近读取记录 */
export function getRecentReads(
  scope: string,
  resourceType: LockableResourceType,
  resourceId: string,
  limit = 20
): ResourceReadRecord[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM resource_read_log WHERE scope = ? AND resource_type = ? AND resource_id = ? ORDER BY read_at DESC LIMIT ?`
    )
    .all(scope, resourceType, resourceId, limit) as Array<Record<string, unknown>>
  return rows.map(rowToReadRecord)
}

/** 删除指定天数之前的读取记录 */
export function pruneOldReadRecords(retentionDays = 30): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const r = db.prepare('DELETE FROM resource_read_log WHERE read_at < ?').run(cutoff)
  return r.changes
}

function rowToLock(row: Record<string, unknown>): ResourceLock {
  return {
    id: row.id as string,
    resourceType: row.resource_type as LockableResourceType,
    resourceId: row.resource_id as string,
    scope: row.scope as string,
    sessionId: row.session_id as string,
    fenceToken: row.fence_token as number,
    reason: (row.reason as string) || undefined,
    acquiredAt: row.acquired_at as number,
    lastHeartbeat: row.last_heartbeat as number,
    ttlMs: row.ttl_ms as number,
    metadata: (row.metadata as string) || undefined
  }
}

function rowToReadRecord(row: Record<string, unknown>): ResourceReadRecord {
  return {
    id: row.id as string,
    scope: row.scope as string,
    sessionId: row.session_id as string,
    resourceType: row.resource_type as LockableResourceType,
    resourceId: row.resource_id as string,
    readVersion: row.read_version as number,
    readAt: row.read_at as number
  }
}
