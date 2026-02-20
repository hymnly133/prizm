/**
 * Cron Job SQLite 存储层
 * 文件位置：.prizm-data/cron_jobs.db
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from '../PathProviderCore'
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import type { CronJob, CronRunLog } from '@prizm/shared'
import type { CreateCronJobInput, UpdateCronJobInput, CronRunLogFilter } from './types'

const log = createLogger('CronStore')

const CRON_DB = 'cron_jobs.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), CRON_DB)
}

function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.pragma('busy_timeout = 5000')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope TEXT NOT NULL,
      schedule TEXT NOT NULL,
      timezone TEXT,
      task_prompt TEXT NOT NULL,
      task_context TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'isolated',
      model TEXT,
      timeout_ms INTEGER,
      max_retries INTEGER DEFAULT 0,
      linked_schedule_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_run_at INTEGER,
      last_run_status TEXT,
      next_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cron_scope ON cron_jobs(scope);
    CREATE INDEX IF NOT EXISTS idx_cron_status ON cron_jobs(status);

    CREATE TABLE IF NOT EXISTS cron_run_log (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runlog_job ON cron_run_log(job_id);
    CREATE INDEX IF NOT EXISTS idx_runlog_started ON cron_run_log(started_at);
  `)
  return _db
}

export function initCronStore(): void {
  getDb()
  log.info('Cron store initialized at', getDbPath())
}

export function closeCronStore(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

function rowToJob(row: Record<string, unknown>): CronJob {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
    scope: row.scope as string,
    schedule: row.schedule as string,
    timezone: (row.timezone as string) || undefined,
    taskPrompt: row.task_prompt as string,
    taskContext: (row.task_context as string) || undefined,
    executionMode: (row.execution_mode as 'isolated' | 'main') || 'isolated',
    model: (row.model as string) || undefined,
    timeoutMs: (row.timeout_ms as number) || undefined,
    maxRetries: (row.max_retries as number) || 0,
    linkedScheduleId: (row.linked_schedule_id as string) || undefined,
    status: row.status as CronJob['status'],
    lastRunAt: (row.last_run_at as number) || undefined,
    lastRunStatus: (row.last_run_status as string) || undefined,
    nextRunAt: (row.next_run_at as number) || undefined,
    runCount: (row.run_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

export function createJob(input: CreateCronJobInput): CronJob {
  const db = getDb()
  const now = Date.now()
  const id = genUniqueId()

  db.prepare(`
    INSERT INTO cron_jobs (id, name, description, scope, schedule, timezone, task_prompt, task_context,
      execution_mode, model, timeout_ms, max_retries, linked_schedule_id, status, run_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
  `).run(
    id,
    input.name,
    input.description ?? null,
    input.scope,
    input.schedule,
    input.timezone ?? null,
    input.taskPrompt,
    input.taskContext ?? null,
    input.executionMode ?? 'isolated',
    input.model ?? null,
    input.timeoutMs ?? null,
    input.maxRetries ?? 0,
    input.linkedScheduleId ?? null,
    now,
    now
  )

  return getJobById(id)!
}

export function getJobById(id: string): CronJob | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToJob(row) : null
}

export function listJobs(scope?: string, status?: string): CronJob[] {
  const db = getDb()
  let sql = 'SELECT * FROM cron_jobs WHERE 1=1'
  const params: unknown[] = []

  if (scope) {
    sql += ' AND scope = ?'
    params.push(scope)
  }
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToJob)
}

export function listActiveJobs(): CronJob[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM cron_jobs WHERE status = ?').all('active') as Record<string, unknown>[]
  return rows.map(rowToJob)
}

export function updateJob(id: string, input: UpdateCronJobInput): CronJob | null {
  const db = getDb()
  const existing = getJobById(id)
  if (!existing) return null

  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const params: unknown[] = [now]

  if (input.name != null) { sets.push('name = ?'); params.push(input.name) }
  if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description ?? null) }
  if (input.schedule != null) { sets.push('schedule = ?'); params.push(input.schedule) }
  if (input.timezone !== undefined) { sets.push('timezone = ?'); params.push(input.timezone ?? null) }
  if (input.taskPrompt != null) { sets.push('task_prompt = ?'); params.push(input.taskPrompt) }
  if (input.taskContext !== undefined) { sets.push('task_context = ?'); params.push(input.taskContext ?? null) }
  if (input.executionMode != null) { sets.push('execution_mode = ?'); params.push(input.executionMode) }
  if (input.model !== undefined) { sets.push('model = ?'); params.push(input.model ?? null) }
  if (input.timeoutMs !== undefined) { sets.push('timeout_ms = ?'); params.push(input.timeoutMs ?? null) }
  if (input.maxRetries !== undefined) { sets.push('max_retries = ?'); params.push(input.maxRetries ?? 0) }
  if (input.linkedScheduleId !== undefined) { sets.push('linked_schedule_id = ?'); params.push(input.linkedScheduleId ?? null) }

  params.push(id)
  db.prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getJobById(id)
}

export function setJobStatus(id: string, status: CronJob['status']): void {
  const db = getDb()
  db.prepare('UPDATE cron_jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
}

export function recordJobRun(id: string, sessionId: string | undefined, status: string, nextRunAt?: number): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    UPDATE cron_jobs SET last_run_at = ?, last_run_status = ?, run_count = run_count + 1,
      next_run_at = ?, updated_at = ? WHERE id = ?
  `).run(now, status, nextRunAt ?? null, now, id)
}

export function deleteJob(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  return result.changes > 0
}

export function insertRunLog(jobId: string, sessionId?: string): string {
  const db = getDb()
  const id = genUniqueId()
  const now = Date.now()
  db.prepare(`
    INSERT INTO cron_run_log (id, job_id, session_id, status, started_at) VALUES (?, ?, ?, 'running', ?)
  `).run(id, jobId, sessionId ?? null, now)
  return id
}

export function completeRunLog(logId: string, status: string, error?: string): void {
  const db = getDb()
  const now = Date.now()
  const row = db.prepare('SELECT started_at FROM cron_run_log WHERE id = ?').get(logId) as { started_at: number } | undefined
  const durationMs = row ? now - row.started_at : 0
  db.prepare(`
    UPDATE cron_run_log SET status = ?, finished_at = ?, error = ?, duration_ms = ? WHERE id = ?
  `).run(status, now, error ?? null, durationMs, logId)
}

export function getRunLogs(filter: CronRunLogFilter): CronRunLog[] {
  const db = getDb()
  let sql = 'SELECT * FROM cron_run_log WHERE 1=1'
  const params: unknown[] = []

  if (filter.jobId) { sql += ' AND job_id = ?'; params.push(filter.jobId) }
  if (filter.status) { sql += ' AND status = ?'; params.push(filter.status) }
  sql += ' ORDER BY started_at DESC'
  if (filter.limit) { sql += ' LIMIT ?'; params.push(filter.limit) }
  if (filter.offset) { sql += ' OFFSET ?'; params.push(filter.offset) }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    sessionId: (r.session_id as string) || undefined,
    status: r.status as CronRunLog['status'],
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number) || undefined,
    error: (r.error as string) || undefined,
    durationMs: (r.duration_ms as number) || undefined
  }))
}

/** Prune old run logs (keep last N days) */
export function pruneRunLogs(retentionDays = 90): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 86_400_000
  const result = db.prepare('DELETE FROM cron_run_log WHERE started_at < ?').run(cutoff)
  return result.changes
}
