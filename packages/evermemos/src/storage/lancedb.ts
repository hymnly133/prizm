import * as lancedb from '@lancedb/lancedb'
import { VectorStoreAdapter } from './interfaces.js'

export class LanceDBAdapter implements VectorStoreAdapter {
  private db: lancedb.Connection | null = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  private async getDb() {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath)
    }
    return this.db
  }

  async add(collectionName: string, items: any[]): Promise<void> {
    const db = await this.getDb()
    let table: lancedb.Table
    try {
      table = await db.openTable(collectionName)
      await table.add(items)
    } catch {
      try {
        table = await db.createTable(collectionName, items)
      } catch (createErr) {
        const msg = createErr instanceof Error ? createErr.message : String(createErr)
        if (msg.includes('already exists')) {
          table = await db.openTable(collectionName)
          await table.add(items)
        } else {
          throw createErr
        }
      }
    }
  }

  async search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: any
  ): Promise<any[]> {
    const db = await this.getDb()
    try {
      const table = await db.openTable(collectionName)
      let query = table.search(vector).limit(limit)
      if (filter) {
        // LanceDB filter string format: "col = val"
        // This is a simplified implementation
        if (typeof filter === 'string') {
          query = query.where(filter)
        }
      }
      return await query.toArray()
    } catch (e) {
      return []
    }
  }

  async delete(collectionName: string, id: string): Promise<void> {
    const db = await this.getDb()
    try {
      const table = await db.openTable(collectionName)
      await table.delete(`id = '${id}'`)
    } catch (e) {
      // ignore if table doesn't exist
    }
  }

  async dropCollection(collectionName: string): Promise<void> {
    const db = await this.getDb()
    try {
      await db.dropTable(collectionName)
    } catch {
      // ignore if table doesn't exist
    }
  }

  /** 列出表中已有向量的 id，用于 backfill 时只补全缺失项 */
  async listIds(collectionName: string): Promise<string[]> {
    const db = await this.getDb()
    const ids: string[] = []
    try {
      const table = await db.openTable(collectionName)
      const query = table.query() as Iterable<unknown> | AsyncIterable<unknown>
      const it = Symbol.asyncIterator in Object(query) ? (query as AsyncIterable<unknown>)[Symbol.asyncIterator]() : null
      if (!it) return []
      for (let next = await it.next(); !next.done; next = await it.next()) {
        const batch = next.value
        const arr = Array.isArray(batch) ? batch : (batch && typeof batch === 'object' && 'toArray' in batch ? (batch as { toArray: () => unknown[] }).toArray() : [batch])
        for (const row of arr) {
          const id = row && typeof row === 'object' && 'id' in row ? (row as { id: unknown }).id : undefined
          if (id != null && id !== '') ids.push(String(id))
        }
      }
    } catch {
      // table does not exist or query not supported → no ids
    }
    return ids
  }
}
