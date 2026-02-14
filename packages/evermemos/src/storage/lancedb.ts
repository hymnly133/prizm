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
    } catch (e) {
      // Table might not exist, create it
      // LanceDB infers schema from first batch
      table = await db.createTable(collectionName, items)
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
}
