/**
 * Memory Relation Store — SQLite 持久化记忆关系
 */

import Database from 'better-sqlite3'
import path from 'path'
import { createLogger } from '../../logger'
import { getDataDir } from '../../core/PathProviderCore'
import { genUniqueId } from '../../id'
import type { MemoryRelation, MemoryRelationType, RelatedMemory } from './types'

const log = createLogger('RelationStore')

let _db: InstanceType<typeof Database> | null = null

function getDb(): InstanceType<typeof Database> {
  if (_db) return _db
  const dbPath = path.join(getDataDir(), 'memory_relations.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rel_source ON memory_relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON memory_relations(target_id);
    CREATE INDEX IF NOT EXISTS idx_rel_type ON memory_relations(relation_type);
  `)
  log.info('Memory relations DB initialized: %s', dbPath)
  return _db
}

/**
 * 添加一条记忆关系
 */
export function addRelation(
  sourceId: string,
  targetId: string,
  relationType: MemoryRelationType,
  confidence = 1.0
): MemoryRelation {
  const db = getDb()
  const id = genUniqueId()
  const createdAt = new Date().toISOString()

  db.prepare(`
    INSERT OR IGNORE INTO memory_relations (id, source_id, target_id, relation_type, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sourceId, targetId, relationType, confidence, createdAt)

  return { id, sourceId, targetId, relationType, confidence, createdAt }
}

/**
 * 批量添加关系
 */
export function addRelations(
  relations: Array<{
    sourceId: string
    targetId: string
    relationType: MemoryRelationType
    confidence?: number
  }>
): number {
  const db = getDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO memory_relations (id, source_id, target_id, relation_type, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()

  const runAll = db.transaction(() => {
    let count = 0
    for (const r of relations) {
      const result = insert.run(
        genUniqueId(),
        r.sourceId,
        r.targetId,
        r.relationType,
        r.confidence ?? 1.0,
        now
      )
      if (result.changes > 0) count++
    }
    return count
  })

  return runAll()
}

/**
 * 查询与指定记忆 ID 相关的所有记忆
 */
export function getRelatedMemories(
  memoryId: string,
  options?: { relationType?: MemoryRelationType; limit?: number }
): RelatedMemory[] {
  const db = getDb()
  const limit = options?.limit ?? 20
  const results: RelatedMemory[] = []

  let outQuery = 'SELECT target_id, relation_type, confidence FROM memory_relations WHERE source_id = ?'
  let inQuery = 'SELECT source_id, relation_type, confidence FROM memory_relations WHERE target_id = ?'
  const params: unknown[] = [memoryId]

  if (options?.relationType) {
    outQuery += ' AND relation_type = ?'
    inQuery += ' AND relation_type = ?'
    params.push(options.relationType)
  }

  outQuery += ` LIMIT ${limit}`
  inQuery += ` LIMIT ${limit}`

  const outRows = db.prepare(outQuery).all(...params) as Array<{
    target_id: string
    relation_type: string
    confidence: number
  }>
  for (const row of outRows) {
    results.push({
      memoryId: row.target_id,
      relationType: row.relation_type as MemoryRelationType,
      confidence: row.confidence,
      direction: 'outgoing'
    })
  }

  const inRows = db.prepare(inQuery).all(...params) as Array<{
    source_id: string
    relation_type: string
    confidence: number
  }>
  for (const row of inRows) {
    results.push({
      memoryId: row.source_id,
      relationType: row.relation_type as MemoryRelationType,
      confidence: row.confidence,
      direction: 'incoming'
    })
  }

  return results.slice(0, limit)
}

/**
 * 删除与指定记忆 ID 相关的所有关系
 */
export function deleteRelationsForMemory(memoryId: string): number {
  const db = getDb()
  const result = db
    .prepare('DELETE FROM memory_relations WHERE source_id = ? OR target_id = ?')
    .run(memoryId, memoryId)
  return result.changes
}

/**
 * 获取关系统计
 */
export function getRelationStats(): { totalRelations: number; byType: Record<string, number> } {
  const db = getDb()
  const total = (
    db.prepare('SELECT COUNT(*) as cnt FROM memory_relations').get() as { cnt: number }
  ).cnt

  const rows = db
    .prepare('SELECT relation_type, COUNT(*) as cnt FROM memory_relations GROUP BY relation_type')
    .all() as Array<{ relation_type: string; cnt: number }>
  const byType: Record<string, number> = {}
  for (const row of rows) byType[row.relation_type] = row.cnt

  return { totalRelations: total, byType }
}

/**
 * 关闭数据库连接
 */
export function closeRelationStore(): void {
  if (_db) {
    _db.close()
    _db = null
    log.info('Memory relations DB closed')
  }
}
