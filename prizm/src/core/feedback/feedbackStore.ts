/**
 * 反馈系统 SQLite 存储层
 * 文件位置：.prizm-data/feedback.db
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from '../PathProviderCore'
import { createLogger } from '../../logger'
import type { FeedbackRecord, FeedbackQueryFilter, FeedbackStatsRow } from './types'
import type { FeedbackEntry } from '@prizm/shared'

const log = createLogger('FeedbackStore')

const FEEDBACK_DB = 'feedback.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), FEEDBACK_DB)
}

function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.pragma('busy_timeout = 5000')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      session_id TEXT,
      rating TEXT NOT NULL,
      comment TEXT,
      client_id TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_scope ON feedback(scope);
    CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(scope, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_upsert ON feedback(scope, target_type, target_id, client_id);
  `)
  return _db
}

export function initFeedbackStore(): void {
  getDb()
  log.info('Feedback store initialized at', getDbPath())
}

export function closeFeedbackStore(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function upsertFeedback(record: FeedbackRecord): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO feedback
      (id, scope, target_type, target_id, session_id, rating, comment, client_id, metadata, created_at, updated_at)
    VALUES
      (@id, @scope, @targetType, @targetId, @sessionId, @rating, @comment, @clientId, @metadata, @createdAt, @updatedAt)
    ON CONFLICT(scope, target_type, target_id, client_id)
    DO UPDATE SET
      rating = @rating,
      comment = @comment,
      metadata = @metadata,
      updated_at = @updatedAt
    `
  ).run({
    id: record.id,
    scope: record.scope,
    targetType: record.targetType,
    targetId: record.targetId,
    sessionId: record.sessionId ?? null,
    rating: record.rating,
    comment: record.comment ?? null,
    clientId: record.clientId ?? null,
    metadata: record.metadata ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  })
}

export function getFeedbackById(id: string): FeedbackEntry | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToEntry(row) : undefined
}

export function getFeedbackForTarget(
  scope: string,
  targetType: string,
  targetId: string
): FeedbackEntry[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM feedback WHERE scope = ? AND target_type = ? AND target_id = ? ORDER BY created_at DESC')
    .all(scope, targetType, targetId) as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

export function queryFeedback(filter?: FeedbackQueryFilter): FeedbackEntry[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.scope) {
    conditions.push('scope = @scope')
    params.scope = filter.scope
  }
  if (filter?.targetType) {
    conditions.push('target_type = @targetType')
    params.targetType = filter.targetType
  }
  if (filter?.targetId) {
    conditions.push('target_id = @targetId')
    params.targetId = filter.targetId
  }
  if (filter?.sessionId) {
    conditions.push('session_id = @sessionId')
    params.sessionId = filter.sessionId
  }
  if (filter?.rating) {
    conditions.push('rating = @rating')
    params.rating = filter.rating
  }
  if (filter?.since) {
    conditions.push('created_at >= @since')
    params.since = filter.since
  }
  if (filter?.until) {
    conditions.push('created_at <= @until')
    params.until = filter.until
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const safeLimit = Math.max(1, Math.min(Number(filter?.limit) || 100, 500))
  const safeOffset = Math.max(0, Number(filter?.offset) || 0)
  params._limit = safeLimit
  params._offset = safeOffset

  const rows = db
    .prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT @_limit OFFSET @_offset`)
    .all(params) as Array<Record<string, unknown>>

  return rows.map(rowToEntry)
}

export function getStats(filter?: { scope?: string; targetType?: string; sessionId?: string }): FeedbackStatsRow {
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.scope) {
    conditions.push('scope = @scope')
    params.scope = filter.scope
  }
  if (filter?.targetType) {
    conditions.push('target_type = @targetType')
    params.targetType = filter.targetType
  }
  if (filter?.sessionId) {
    conditions.push('session_id = @sessionId')
    params.sessionId = filter.sessionId
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN rating = 'like' THEN 1 ELSE 0 END) as like_count,
        SUM(CASE WHEN rating = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
        SUM(CASE WHEN rating = 'dislike' THEN 1 ELSE 0 END) as dislike_count
      FROM feedback ${where}`
    )
    .get(params) as { total: number; like_count: number; neutral_count: number; dislike_count: number } | undefined

  return {
    total: row?.total ?? 0,
    like: row?.like_count ?? 0,
    neutral: row?.neutral_count ?? 0,
    dislike: row?.dislike_count ?? 0
  }
}

export function updateFeedback(
  id: string,
  updates: { rating?: string; comment?: string }
): boolean {
  const db = getDb()
  const sets: string[] = ['updated_at = @updatedAt']
  const params: Record<string, unknown> = { id, updatedAt: Date.now() }

  if (updates.rating !== undefined) {
    sets.push('rating = @rating')
    params.rating = updates.rating
  }
  if (updates.comment !== undefined) {
    sets.push('comment = @comment')
    params.comment = updates.comment
  }

  const r = db
    .prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = @id`)
    .run(params)
  return r.changes > 0
}

export function deleteFeedback(id: string): boolean {
  const db = getDb()
  const r = db.prepare('DELETE FROM feedback WHERE id = ?').run(id)
  return r.changes > 0
}

export function pruneOldFeedback(retentionDays = 365): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const r = db.prepare('DELETE FROM feedback WHERE created_at < ?').run(cutoff)
  return r.changes
}

function rowToEntry(row: Record<string, unknown>): FeedbackEntry {
  return {
    id: row.id as string,
    scope: row.scope as string,
    targetType: row.target_type as FeedbackEntry['targetType'],
    targetId: row.target_id as string,
    sessionId: (row.session_id as string) || undefined,
    rating: row.rating as FeedbackEntry['rating'],
    comment: (row.comment as string) || undefined,
    clientId: (row.client_id as string) || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}
