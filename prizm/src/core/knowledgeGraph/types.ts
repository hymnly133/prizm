/**
 * 知识图谱基座 — 类型定义
 *
 * 轻量实体关系索引，不引入图数据库，使用 SQLite 关系表存储。
 */

/** 记忆间的关系类型 */
export type MemoryRelationType =
  | 'references'
  | 'derived_from'
  | 'contradicts'
  | 'extends'
  | 'related_to'

/** 记忆关系记录 */
export interface MemoryRelation {
  id: string
  sourceId: string
  targetId: string
  relationType: MemoryRelationType
  confidence: number
  createdAt: string
}

/** 关联查询结果 */
export interface RelatedMemory {
  memoryId: string
  relationType: MemoryRelationType
  confidence: number
  direction: 'outgoing' | 'incoming'
}
