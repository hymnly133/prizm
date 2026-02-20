/**
 * 知识图谱基座 — 统一导出
 */

export type { MemoryRelation, MemoryRelationType, RelatedMemory } from './types'
export {
  addRelation,
  addRelations,
  getRelatedMemories,
  deleteRelationsForMemory,
  getRelationStats,
  closeRelationStore
} from './relationStore'
export { detectRelations, registerRelationDetectorHook } from './relationDetector'
