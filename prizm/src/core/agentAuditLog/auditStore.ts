/**
 * 操作审计日志 SQLite 存储层
 * 文件位置：.prizm-data/agent_audit.db
 * 支持 Agent 和 User 双来源
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from '../PathProviderCore'
import { createLogger } from '../../logger'
import type { AgentAuditEntry, AuditQueryFilter } from './types'

const log = createLogger('AuditStore')

const AUDIT_DB = 'agent_audit.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), AUDIT_DB)
}

function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.pragma('busy_timeout = 5000')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      resource_title TEXT,
      detail TEXT,
      memory_type TEXT,
      document_sub_type TEXT,
      result TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      timestamp INTEGER NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'agent',
      client_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_log(scope);
    CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
  `)
  // 迁移：为旧数据库添加新列（如果不存在）
  migrateSchema(_db)
  return _db
}

/** 安全添加新列（忽略 "duplicate column name" 错误） */
function migrateSchema(db: Database.Database): void {
  const addColumnSafe = (col: string, type: string, defaultValue?: string) => {
    try {
      const def = defaultValue !== undefined ? ` DEFAULT ${defaultValue}` : ''
      db.exec(`ALTER TABLE audit_log ADD COLUMN ${col} ${type}${def}`)
    } catch {
      // 列已存在，忽略
    }
  }
  addColumnSafe('actor_type', 'TEXT NOT NULL', "'agent'")
  addColumnSafe('client_id', 'TEXT', undefined)
  // session_id 可能是 NOT NULL 的旧表，无法直接修改，但新插入可以传 null
}

/** 初始化数据库 */
export function initAuditStore(): void {
  getDb()
  log.info('Audit store initialized at', getDbPath())
}

/** 关闭数据库 */
export function closeAuditStore(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** 插入一条审计日志 */
export function insertEntry(entry: AgentAuditEntry): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO audit_log
      (id, scope, session_id, tool_name, action, resource_type, resource_id, resource_title,
       detail, memory_type, document_sub_type, result, error_message, timestamp,
       actor_type, client_id)
    VALUES
      (@id, @scope, @sessionId, @toolName, @action, @resourceType, @resourceId, @resourceTitle,
       @detail, @memoryType, @documentSubType, @result, @errorMessage, @timestamp,
       @actorType, @clientId)
  `
  ).run({
    id: entry.id,
    scope: entry.scope,
    sessionId: entry.sessionId ?? null,
    toolName: entry.toolName,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    resourceTitle: entry.resourceTitle ?? null,
    detail: entry.detail ?? null,
    memoryType: entry.memoryType ?? null,
    documentSubType: entry.documentSubType ?? null,
    result: entry.result,
    errorMessage: entry.errorMessage ?? null,
    timestamp: entry.timestamp,
    actorType: entry.actorType ?? 'agent',
    clientId: entry.clientId ?? null
  })
}

/** 查询审计日志（支持多维度过滤 + 分页） */
export function queryEntries(filter?: AuditQueryFilter): AgentAuditEntry[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.scope) {
    conditions.push('scope = @scope')
    params.scope = filter.scope
  }
  if (filter?.sessionId) {
    conditions.push('session_id = @sessionId')
    params.sessionId = filter.sessionId
  }
  if (filter?.clientId) {
    conditions.push('client_id = @clientId')
    params.clientId = filter.clientId
  }
  if (filter?.actorType) {
    conditions.push('actor_type = @actorType')
    params.actorType = filter.actorType
  }
  if (filter?.resourceType) {
    conditions.push('resource_type = @resourceType')
    params.resourceType = filter.resourceType
  }
  if (filter?.resourceId) {
    conditions.push('resource_id = @resourceId')
    params.resourceId = filter.resourceId
  }
  if (filter?.action) {
    conditions.push('action = @action')
    params.action = filter.action
  }
  if (filter?.result) {
    conditions.push('result = @result')
    params.result = filter.result
  }
  if (filter?.since) {
    conditions.push('timestamp >= @since')
    params.since = filter.since
  }
  if (filter?.until) {
    conditions.push('timestamp <= @until')
    params.until = filter.until
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const safeLimit = Math.max(1, Math.min(Number(filter?.limit) || 100, 500))
  const safeOffset = Math.max(0, Math.min(Number(filter?.offset) || 0, 100000))
  params._limit = safeLimit
  params._offset = safeOffset

  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT @_limit OFFSET @_offset`
    )
    .all(params) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

/** 查询指定资源的操作历史 */
export function getResourceHistory(
  scope: string,
  resourceType: string,
  resourceId: string,
  limit = 50
): AgentAuditEntry[] {
  const db = getDb()
  const safeLimit = Math.max(1, Math.min(limit, 500))
  const rows = db
    .prepare(
      `SELECT * FROM audit_log WHERE scope = ? AND resource_type = ? AND resource_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(scope, resourceType, resourceId, safeLimit) as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

/** 获取会话的审计日志条数 */
export function countSessionEntries(scope: string, sessionId: string): number {
  const db = getDb()
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM audit_log WHERE scope = ? AND session_id = ?`)
    .get(scope, sessionId) as { cnt: number } | undefined
  return row?.cnt ?? 0
}

/** 删除指定天数之前的审计日志 */
export function pruneOldEntries(retentionDays = 90): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const r = db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff)
  return r.changes
}

function rowToEntry(row: Record<string, unknown>): AgentAuditEntry {
  return {
    id: row.id as string,
    scope: row.scope as string,
    actorType: (row.actor_type as AgentAuditEntry['actorType']) ?? 'agent',
    sessionId: (row.session_id as string) || undefined,
    clientId: (row.client_id as string) || undefined,
    toolName: row.tool_name as string,
    action: row.action as AgentAuditEntry['action'],
    resourceType: row.resource_type as AgentAuditEntry['resourceType'],
    resourceId: (row.resource_id as string) || undefined,
    resourceTitle: (row.resource_title as string) || undefined,
    detail: (row.detail as string) || undefined,
    memoryType: (row.memory_type as string) || undefined,
    documentSubType: (row.document_sub_type as string) || undefined,
    result: row.result as AgentAuditEntry['result'],
    errorMessage: (row.error_message as string) || undefined,
    timestamp: row.timestamp as number
  }
}
