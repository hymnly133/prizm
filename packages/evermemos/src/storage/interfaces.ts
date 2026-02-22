export interface VectorStoreAdapter {
  add(collection: string, items: any[]): Promise<void>
  search(collection: string, vector: number[], limit: number, filter?: any): Promise<any[]>
  delete(collection: string, id: string): Promise<void>
  /** 删除整个集合（可选实现） */
  dropCollection?(collection: string): Promise<void>
  /** 列出集合中已有向量的 id（可选实现，用于 backfill 时跳过已存在项） */
  listIds?(collection: string): Promise<string[]>
}

export interface RelationalStoreAdapter {
  get(table: string, id: string): Promise<any>
  find(table: string, query: any): Promise<any[]>
  insert(table: string, item: any): Promise<void>
  update(table: string, id: string, item: any): Promise<void>
  delete(table: string, id: string): Promise<void>
  query(sql: string, params?: any[]): Promise<any[]>
  /** Execute a write statement (INSERT/UPDATE/DELETE) that does not return rows */
  run?(sql: string, params?: any[]): Promise<void>
}

export interface StorageAdapter {
  vector: VectorStoreAdapter
  relational: RelationalStoreAdapter
}
