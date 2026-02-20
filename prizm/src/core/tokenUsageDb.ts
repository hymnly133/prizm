/**
 * Token 使用记录 SQLite 存储层
 * 统一存储所有 token 使用记录，支持按 scope / category / session 过滤和聚合查询。
 * 文件位置：.prizm-data/token_usage.db
 */

import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir, ensureDataDir } from './PathProviderCore'
import type { TokenUsageRecord, TokenUsageCategory } from '../types'
import { createLogger } from '../logger'

const log = createLogger('tokenUsageDb')

const TOKEN_USAGE_DB = 'token_usage.db'

let _db: Database.Database | null = null

function getDbPath(): string {
  return path.join(getDataDir(), TOKEN_USAGE_DB)
}

/** 获取（或创建）数据库实例 */
function getDb(): Database.Database {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(getDbPath())
  _db.pragma('journal_mode = WAL')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      data_scope TEXT NOT NULL DEFAULT 'default',
      session_id TEXT,
      timestamp INTEGER NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tu_scope ON token_usage(data_scope);
    CREATE INDEX IF NOT EXISTS idx_tu_category ON token_usage(category);
    CREATE INDEX IF NOT EXISTS idx_tu_session ON token_usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_tu_timestamp ON token_usage(timestamp);
  `)
  // 迁移：为已有表添加 cached_input_tokens 列
  try {
    _db.exec(`ALTER TABLE token_usage ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0`)
  } catch {
    // 列已存在，忽略
  }
  return _db
}

/** 初始化数据库（建表+索引），在服务启动时调用 */
export function initTokenUsageDb(): void {
  getDb()
  log.info('Token usage DB initialized at', getDbPath())
}

/** 关闭数据库连接（服务关闭时调用） */
export function closeTokenUsageDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** 插入一条 token 使用记录 */
export function insertTokenUsage(record: TokenUsageRecord): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO token_usage
      (id, category, data_scope, session_id, timestamp, model, input_tokens, output_tokens, total_tokens, cached_input_tokens)
    VALUES
      (@id, @category, @dataScope, @sessionId, @timestamp, @model, @inputTokens, @outputTokens, @totalTokens, @cachedInputTokens)
  `)
  stmt.run({
    id: record.id,
    category: record.category,
    dataScope: record.dataScope,
    sessionId: record.sessionId ?? null,
    timestamp: record.timestamp,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    cachedInputTokens: record.cachedInputTokens ?? 0
  })
}

export interface TokenUsageFilter {
  dataScope?: string
  /** 类别过滤，支持前缀匹配如 'memory:' */
  category?: string
  sessionId?: string
  /** 起始时间戳（包含），用于时间范围过滤 */
  from?: number
  /** 结束时间戳（包含），用于时间范围过滤 */
  to?: number
  limit?: number
  offset?: number
}

/** 构建过滤条件（共享逻辑） */
function buildFilterConditions(filter?: Omit<TokenUsageFilter, 'limit' | 'offset'>): {
  where: string
  params: Record<string, unknown>
} {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (filter?.dataScope) {
    conditions.push('data_scope = @dataScope')
    params.dataScope = filter.dataScope
  }
  if (filter?.category) {
    if (filter.category.endsWith(':')) {
      conditions.push('category LIKE @categoryPrefix')
      params.categoryPrefix = `${filter.category}%`
    } else {
      conditions.push('category = @category')
      params.category = filter.category
    }
  }
  if (filter?.sessionId) {
    conditions.push('session_id = @sessionId')
    params.sessionId = filter.sessionId
  }
  if (filter?.from != null) {
    conditions.push('timestamp >= @fromTs')
    params.fromTs = filter.from
  }
  if (filter?.to != null) {
    conditions.push('timestamp <= @toTs')
    params.toTs = filter.to
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

/** 查询 token 使用记录（支持过滤+分页） */
export function queryTokenUsage(filter?: TokenUsageFilter): TokenUsageRecord[] {
  const db = getDb()
  const { where, params } = buildFilterConditions(filter)
  const safeLimit = filter?.limit ? Math.max(0, Math.floor(Number(filter.limit) || 0)) : 0
  const safeOffset = filter?.offset ? Math.max(0, Math.floor(Number(filter.offset) || 0)) : 0
  const limit = safeLimit > 0 ? `LIMIT ${safeLimit}` : ''
  const offset = safeOffset > 0 ? `OFFSET ${safeOffset}` : ''

  const rows = db
    .prepare(`SELECT * FROM token_usage ${where} ORDER BY timestamp DESC ${limit} ${offset}`)
    .all(params) as Array<Record<string, unknown>>

  return rows.map(rowToRecord)
}

export interface TokenUsageBucketStat {
  input: number
  output: number
  total: number
  cached: number
  count: number
}

export interface TokenUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCachedInputTokens: number
  count: number
  byCategory: Record<string, TokenUsageBucketStat>
  byDataScope: Record<string, TokenUsageBucketStat>
  byModel: Record<string, TokenUsageBucketStat>
}

/** 聚合统计（支持过滤） */
export function aggregateTokenUsage(
  filter?: Omit<TokenUsageFilter, 'limit' | 'offset'>
): TokenUsageSummary {
  const db = getDb()
  const { where, params } = buildFilterConditions(filter)

  const totalRow = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) AS totalInput,
        COALESCE(SUM(output_tokens), 0) AS totalOutput,
        COALESCE(SUM(total_tokens), 0) AS totalAll,
        COALESCE(SUM(cached_input_tokens), 0) AS totalCached,
        COUNT(*) AS cnt
      FROM token_usage ${where}`
    )
    .get(params) as {
    totalInput: number
    totalOutput: number
    totalAll: number
    totalCached: number
    cnt: number
  }

  const byCategoryRows = db
    .prepare(
      `SELECT category,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output,
        SUM(total_tokens) AS total, SUM(cached_input_tokens) AS cached, COUNT(*) AS count
      FROM token_usage ${where}
      GROUP BY category`
    )
    .all(params) as Array<{
    category: string
    input: number
    output: number
    total: number
    cached: number
    count: number
  }>

  const byDataScopeRows = db
    .prepare(
      `SELECT data_scope,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output,
        SUM(total_tokens) AS total, SUM(cached_input_tokens) AS cached, COUNT(*) AS count
      FROM token_usage ${where}
      GROUP BY data_scope`
    )
    .all(params) as Array<{
    data_scope: string
    input: number
    output: number
    total: number
    cached: number
    count: number
  }>

  const byModelRows = db
    .prepare(
      `SELECT model,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output,
        SUM(total_tokens) AS total, SUM(cached_input_tokens) AS cached, COUNT(*) AS count
      FROM token_usage ${where}
      GROUP BY model`
    )
    .all(params) as Array<{
    model: string
    input: number
    output: number
    total: number
    cached: number
    count: number
  }>

  const byCategory: Record<string, TokenUsageBucketStat> = {}
  for (const r of byCategoryRows) {
    byCategory[r.category] = {
      input: r.input,
      output: r.output,
      total: r.total,
      cached: r.cached,
      count: r.count
    }
  }

  const byDataScope: Record<string, TokenUsageBucketStat> = {}
  for (const r of byDataScopeRows) {
    byDataScope[r.data_scope] = {
      input: r.input,
      output: r.output,
      total: r.total,
      cached: r.cached,
      count: r.count
    }
  }

  const byModel: Record<string, TokenUsageBucketStat> = {}
  for (const r of byModelRows) {
    byModel[r.model || '(unknown)'] = {
      input: r.input,
      output: r.output,
      total: r.total,
      cached: r.cached,
      count: r.count
    }
  }

  return {
    totalInputTokens: totalRow.totalInput,
    totalOutputTokens: totalRow.totalOutput,
    totalTokens: totalRow.totalAll,
    totalCachedInputTokens: totalRow.totalCached,
    count: totalRow.cnt,
    byCategory,
    byDataScope,
    byModel
  }
}

function rowToRecord(row: Record<string, unknown>): TokenUsageRecord {
  const cached = row.cached_input_tokens as number | undefined
  return {
    id: row.id as string,
    category: row.category as TokenUsageCategory,
    dataScope: row.data_scope as string,
    sessionId: (row.session_id as string) || undefined,
    timestamp: row.timestamp as number,
    model: row.model as string,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    totalTokens: row.total_tokens as number,
    ...(cached ? { cachedInputTokens: cached } : {})
  }
}
