import Database from 'better-sqlite3'
import { RelationalStoreAdapter } from './interfaces.js'

export class SQLiteAdapter implements RelationalStoreAdapter {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.initTables()
  }

  private static readonly SEARCH_INDEX_TABLE = 'search_index'

  private initTables() {
    // Basic tables for memories
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT,
        user_id TEXT,
        group_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata JSON
      );
      
      CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

      CREATE TABLE IF NOT EXISTS search_index (
        scope TEXT PRIMARY KEY,
        mini_search_blob TEXT NOT NULL,
        by_id_blob TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  /** 读取搜索索引（MiniSearch + byId），供 Prizm 统一搜索使用 */
  async getSearchIndex(
    scope: string
  ): Promise<{ miniSearchBlob: string; byIdBlob: string } | null> {
    const row = await this.get(SQLiteAdapter.SEARCH_INDEX_TABLE, scope)
    if (!row || typeof row.mini_search_blob !== 'string' || typeof row.by_id_blob !== 'string') {
      return null
    }
    return { miniSearchBlob: row.mini_search_blob, byIdBlob: row.by_id_blob }
  }

  /** 写入搜索索引 */
  async setSearchIndex(scope: string, miniSearchBlob: string, byIdBlob: string): Promise<void> {
    const updatedAt = new Date().toISOString()
    const existing = await this.get(SQLiteAdapter.SEARCH_INDEX_TABLE, scope)
    if (existing) {
      await this.update(SQLiteAdapter.SEARCH_INDEX_TABLE, scope, {
        mini_search_blob: miniSearchBlob,
        by_id_blob: byIdBlob,
        updated_at: updatedAt
      })
    } else {
      await this.insert(SQLiteAdapter.SEARCH_INDEX_TABLE, {
        scope,
        mini_search_blob: miniSearchBlob,
        by_id_blob: byIdBlob,
        updated_at: updatedAt
      })
    }
  }

  /** 删除某 scope 的搜索索引缓存 */
  async deleteSearchIndex(scope: string): Promise<void> {
    await this.delete(SQLiteAdapter.SEARCH_INDEX_TABLE, scope)
  }

  async get(table: string, id: string): Promise<any> {
    const stmt = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`)
    const result = stmt.get(id)
    return result ? this.parseResult(result) : null
  }

  async find(table: string, query: any): Promise<any[]> {
    const keys = Object.keys(query)
    const whereClause = keys.map((k) => `${k} = ?`).join(' AND ')
    const sql = `SELECT * FROM ${table} ${whereClause ? 'WHERE ' + whereClause : ''}`
    const stmt = this.db.prepare(sql)
    const results = stmt.all(...Object.values(query))
    return results.map((r) => this.parseResult(r))
  }

  async insert(table: string, item: any): Promise<void> {
    const keys = Object.keys(item)
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    const stmt = this.db.prepare(sql)
    stmt.run(...Object.values(item))
  }

  async update(table: string, id: string, item: any): Promise<void> {
    const keys = Object.keys(item)
    const setClause = keys.map((k) => `${k} = ?`).join(', ')
    const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`
    const stmt = this.db.prepare(sql)
    stmt.run(...Object.values(item), id)
  }

  async delete(table: string, id: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`)
    stmt.run(id)
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const stmt = this.db.prepare(sql)
    return stmt.all(...params).map((r) => this.parseResult(r))
  }

  private parseResult(row: any): any {
    if (row.metadata && typeof row.metadata === 'string') {
      try {
        row.metadata = JSON.parse(row.metadata)
      } catch (e) {
        // ignore
      }
    }
    return row
  }
}
