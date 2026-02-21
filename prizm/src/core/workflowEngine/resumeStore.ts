/**
 * Workflow Resume Store — SQLite 持久化
 *
 * 存储工作流运行状态（workflow_runs）和任务运行（task_runs）。
 * 工作流定义已迁移至文件系统（workflowDefStore.ts）。
 * 文件位置：.prizm-data/workflow_runs.db
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from '../PathProviderCore'
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepResult,
  WorkflowDefRecord,
  TaskRun,
  TaskRunStatus
} from '@prizm/shared'

const log = createLogger('WorkflowResumeStore')

const WF_DB = 'workflow_runs.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), WF_DB)
}

function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.pragma('busy_timeout = 5000')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step_index INTEGER NOT NULL DEFAULT 0,
      step_results_json TEXT NOT NULL DEFAULT '{}',
      args_json TEXT,
      resume_token TEXT,
      trigger_type TEXT,
      linked_schedule_id TEXT,
      linked_todo_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wfrun_scope ON workflow_runs(scope);
    CREATE INDEX IF NOT EXISTS idx_wfrun_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_wfrun_name ON workflow_runs(workflow_name);

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT,
      input_json TEXT NOT NULL,
      output TEXT,
      structured_data TEXT,
      artifacts_json TEXT,
      error TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      parent_session_id TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_taskrun_scope ON task_runs(scope);
    CREATE INDEX IF NOT EXISTS idx_taskrun_status ON task_runs(status);
  `)
  // 一次性迁移：为 workflow_runs 增加 error_detail 列（若不存在）
  const tableInfo = _db.prepare('PRAGMA table_info(workflow_runs)').all() as { name: string }[]
  if (!tableInfo.some((c) => c.name === 'error_detail')) {
    _db.exec('ALTER TABLE workflow_runs ADD COLUMN error_detail TEXT')
  }
  return _db
}

export function initResumeStore(): void {
  getDb()
  log.info('Workflow resume store initialized at', getDbPath())
}

export function closeResumeStore(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// ─── WorkflowRun CRUD ───

function rowToRun(row: Record<string, unknown>): WorkflowRun {
  let stepResults: Record<string, WorkflowStepResult> = {}
  try {
    stepResults = JSON.parse((row.step_results_json as string) || '{}')
  } catch { /* keep empty */ }

  let args: Record<string, unknown> | undefined
  if (row.args_json) {
    try { args = JSON.parse(row.args_json as string) } catch { /* ignore */ }
  }

  return {
    id: row.id as string,
    workflowName: row.workflow_name as string,
    scope: row.scope as string,
    status: row.status as WorkflowRunStatus,
    currentStepIndex: row.current_step_index as number,
    stepResults,
    resumeToken: (row.resume_token as string) || undefined,
    args,
    triggerType: (row.trigger_type as WorkflowRun['triggerType']) || undefined,
    linkedScheduleId: (row.linked_schedule_id as string) || undefined,
    linkedTodoId: (row.linked_todo_id as string) || undefined,
    error: (row.error as string) || undefined,
    errorDetail: (row.error_detail as string) || undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

export function createRun(
  workflowName: string,
  scope: string,
  options?: {
    args?: Record<string, unknown>
    triggerType?: string
    linkedScheduleId?: string
    linkedTodoId?: string
  }
): WorkflowRun {
  const db = getDb()
  const now = Date.now()
  const id = genUniqueId()

  db.prepare(`
    INSERT INTO workflow_runs
      (id, workflow_name, scope, status, current_step_index, step_results_json,
       args_json, trigger_type, linked_schedule_id, linked_todo_id, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, '{}', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workflowName,
    scope,
    options?.args ? JSON.stringify(options.args) : null,
    options?.triggerType ?? 'manual',
    options?.linkedScheduleId ?? null,
    options?.linkedTodoId ?? null,
    now,
    now
  )

  return getRunById(id)!
}

export function getRunById(id: string): WorkflowRun | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : null
}

export function listRuns(scope?: string, status?: WorkflowRunStatus, limit = 50, offset = 0): WorkflowRun[] {
  const db = getDb()
  let sql = 'SELECT * FROM workflow_runs WHERE 1=1'
  const params: unknown[] = []

  if (scope) { sql += ' AND scope = ?'; params.push(scope) }
  if (status) { sql += ' AND status = ?'; params.push(status) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToRun)
}

export function updateRunStatus(
  id: string,
  status: WorkflowRunStatus,
  error?: string,
  errorDetail?: string
): void {
  const db = getDb()
  db.prepare(`
    UPDATE workflow_runs SET status = ?, error = ?, error_detail = ?, updated_at = ? WHERE id = ?
  `).run(status, error ?? null, errorDetail ?? null, Date.now(), id)
}

export function updateRunStep(
  id: string,
  currentStepIndex: number,
  stepResults: Record<string, WorkflowStepResult>,
  resumeToken?: string
): void {
  const db = getDb()
  db.prepare(`
    UPDATE workflow_runs
    SET current_step_index = ?, step_results_json = ?, resume_token = ?, updated_at = ?
    WHERE id = ?
  `).run(currentStepIndex, JSON.stringify(stepResults), resumeToken ?? null, Date.now(), id)
}

export function getRunByResumeToken(token: string): WorkflowRun | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM workflow_runs WHERE resume_token = ?').get(token) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : null
}

export function deleteRun(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM workflow_runs WHERE id = ?').run(id)
  return result.changes > 0
}

export function pruneRuns(retentionDays = 90): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 86_400_000
  const result = db.prepare(
    "DELETE FROM workflow_runs WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled')"
  ).run(cutoff)
  return result.changes
}

// ─── WorkflowDef 迁移辅助 ───

/**
 * 从 SQLite 读取旧的 workflow_defs 数据（供一次性迁移使用）。
 * 读取后调用 dropLegacyDefTable() 删除表。
 */
export function readLegacyDefs(): WorkflowDefRecord[] {
  const db = getDb()
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_defs'"
    ).get()
    if (!tableExists) return []

    const rows = db.prepare('SELECT * FROM workflow_defs ORDER BY updated_at DESC').all() as Record<string, unknown>[]
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      scope: row.scope as string,
      yamlContent: row.yaml_content as string,
      description: (row.description as string) || undefined,
      triggersJson: (row.triggers_json as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }))
  } catch {
    return []
  }
}

/** 删除旧的 workflow_defs 表（迁移完成后调用） */
export function dropLegacyDefTable(): void {
  const db = getDb()
  try {
    db.exec('DROP TABLE IF EXISTS workflow_defs')
    log.info('Dropped legacy workflow_defs table')
  } catch (err) {
    log.warn('Failed to drop legacy workflow_defs table:', err)
  }
}

// ─── TaskRun CRUD ───

function rowToTaskRun(row: Record<string, unknown>): TaskRun {
  let input: TaskRun['input'] = { prompt: '' }
  try { input = JSON.parse((row.input_json as string) || '{}') } catch { /* keep default */ }

  let artifacts: string[] | undefined
  if (row.artifacts_json) {
    try { artifacts = JSON.parse(row.artifacts_json as string) } catch { /* ignore */ }
  }

  return {
    id: row.id as string,
    scope: row.scope as string,
    label: (row.label as string) || undefined,
    status: row.status as TaskRunStatus,
    sessionId: (row.session_id as string) || undefined,
    input,
    output: (row.output as string) || undefined,
    structuredData: (row.structured_data as string) || undefined,
    artifacts,
    error: (row.error as string) || undefined,
    triggerType: (row.trigger_type as TaskRun['triggerType']) || 'manual',
    parentSessionId: (row.parent_session_id as string) || undefined,
    createdAt: row.created_at as number,
    finishedAt: (row.finished_at as number) || undefined,
    durationMs: (row.duration_ms as number) || undefined
  }
}

export function createTaskRun(
  scope: string,
  input: TaskRun['input'],
  options?: {
    label?: string
    triggerType?: TaskRun['triggerType']
    parentSessionId?: string
  }
): TaskRun {
  const db = getDb()
  const now = Date.now()
  const id = genUniqueId()

  db.prepare(`
    INSERT INTO task_runs
      (id, scope, label, status, input_json, trigger_type, parent_session_id, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    id,
    scope,
    options?.label ?? null,
    JSON.stringify(input),
    options?.triggerType ?? 'manual',
    options?.parentSessionId ?? null,
    now
  )

  return getTaskRun(id)!
}

export function getTaskRun(id: string): TaskRun | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToTaskRun(row) : null
}

export function listTaskRuns(
  scope?: string,
  status?: TaskRunStatus,
  options?: { parentSessionId?: string; limit?: number; offset?: number }
): TaskRun[] {
  const db = getDb()
  let sql = 'SELECT * FROM task_runs WHERE 1=1'
  const params: unknown[] = []

  if (scope) { sql += ' AND scope = ?'; params.push(scope) }
  if (status) { sql += ' AND status = ?'; params.push(status) }
  if (options?.parentSessionId) { sql += ' AND parent_session_id = ?'; params.push(options.parentSessionId) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(options?.limit ?? 50, options?.offset ?? 0)

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map(rowToTaskRun)
}

export function updateTaskRun(
  id: string,
  update: Partial<Pick<TaskRun, 'status' | 'sessionId' | 'output' | 'structuredData' | 'artifacts' | 'error' | 'finishedAt' | 'durationMs'>>
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []

  if (update.status !== undefined) { sets.push('status = ?'); params.push(update.status) }
  if (update.sessionId !== undefined) { sets.push('session_id = ?'); params.push(update.sessionId) }
  if (update.output !== undefined) { sets.push('output = ?'); params.push(update.output) }
  if (update.structuredData !== undefined) { sets.push('structured_data = ?'); params.push(update.structuredData) }
  if (update.artifacts !== undefined) { sets.push('artifacts_json = ?'); params.push(JSON.stringify(update.artifacts)) }
  if (update.error !== undefined) { sets.push('error = ?'); params.push(update.error) }
  if (update.finishedAt !== undefined) { sets.push('finished_at = ?'); params.push(update.finishedAt) }
  if (update.durationMs !== undefined) { sets.push('duration_ms = ?'); params.push(update.durationMs) }

  if (sets.length === 0) return
  params.push(id)
  db.prepare(`UPDATE task_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteTaskRun(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM task_runs WHERE id = ?').run(id)
  return result.changes > 0
}

export function pruneTaskRuns(retentionDays = 90): number {
  const db = getDb()
  const cutoff = Date.now() - retentionDays * 86_400_000
  const result = db.prepare(
    "DELETE FROM task_runs WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled', 'timeout')"
  ).run(cutoff)
  return result.changes
}

// ─── Stale Record Recovery ───

const STALE_ERROR = 'Interrupted by server restart'

/**
 * 服务启动时恢复僵尸 TaskRun。
 * 将 running/pending 状态的记录标记为 failed，因为进程重启后内存中的执行上下文已丢失。
 */
export function recoverStaleTaskRuns(): number {
  const db = getDb()
  const now = Date.now()
  const result = db.prepare(`
    UPDATE task_runs
    SET status = 'failed', error = ?, finished_at = ?
    WHERE status IN ('running', 'pending')
  `).run(STALE_ERROR, now)
  if (result.changes > 0) {
    log.info('Recovered %d stale task runs', result.changes)
  }
  return result.changes
}

/**
 * 服务启动时恢复僵尸 WorkflowRun。
 * 将 running/pending 状态的记录标记为 failed（paused 状态保留，可手动恢复）。
 */
export function recoverStaleWorkflowRuns(): number {
  const db = getDb()
  const now = Date.now()
  const result = db.prepare(`
    UPDATE workflow_runs
    SET status = 'failed', error = ?, updated_at = ?
    WHERE status IN ('running', 'pending')
  `).run(STALE_ERROR, now)
  if (result.changes > 0) {
    log.info('Recovered %d stale workflow runs', result.changes)
  }
  return result.changes
}

/**
 * 清理超长时间仍处于 running/pending 的僵尸 TaskRun 记录。
 * 用于运行时定时巡检，防止 prune 永远无法清理卡死记录。
 */
export function recoverStaleTaskRunsByAge(maxAgeDays = 7): number {
  const db = getDb()
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  const now = Date.now()
  const result = db.prepare(`
    UPDATE task_runs
    SET status = 'failed', error = 'Stale task: exceeded max age', finished_at = ?
    WHERE status IN ('running', 'pending') AND created_at < ?
  `).run(now, cutoff)
  if (result.changes > 0) {
    log.info('Recovered %d age-stale task runs (>%d days)', result.changes, maxAgeDays)
  }
  return result.changes
}

/**
 * 清理超长时间仍处于 running/pending 的僵尸 WorkflowRun 记录。
 */
export function recoverStaleWorkflowRunsByAge(maxAgeDays = 7): number {
  const db = getDb()
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  const now = Date.now()
  const result = db.prepare(`
    UPDATE workflow_runs
    SET status = 'failed', error = 'Stale workflow: exceeded max age', updated_at = ?
    WHERE status IN ('running', 'pending') AND created_at < ?
  `).run(now, cutoff)
  if (result.changes > 0) {
    log.info('Recovered %d age-stale workflow runs (>%d days)', result.changes, maxAgeDays)
  }
  return result.changes
}
