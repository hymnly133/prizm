/**
 * EverMemService — 统一导出
 *
 * 保持外部 `import { xxx } from './EverMemService'` 路径不变。
 */

// init & lifecycle
export {
  initEverMemService,
  runVectorBackfill,
  registerLocalEmbeddingProvider,
  clearLocalEmbeddingProvider,
  createMemoryExtractionLLMAdapter,
  getMemoryManager,
  getRetrievalManager,
  setRetrievalManagerForTest,
  isMemoryEnabled,
  invalidateScopeManagerCache
} from './init'

export type { LocalEmbeddingFn } from './init'

// extraction pipeline
export {
  addMemoryInteraction,
  addSessionMemoryFromRounds,
  flushSessionBuffer,
  clearSessionBuffers,
  resetSessionAccumulator
} from './extraction'

// search
export {
  listAllUserProfiles,
  searchUserMemories,
  searchScopeMemories,
  searchSessionMemories,
  searchMemories,
  searchMemoriesWithOptions,
  searchUserAndScopeMemories,
  searchThreeLevelMemories
} from './search'
export type { MemorySearchOptions } from './search'

// document memory
export {
  addDocumentToMemory,
  deleteDocumentMemories,
  addDocumentMigrationMemory,
  getDocumentOverview,
  getDocumentMigrationHistory,
  getDocumentAllMemories
} from './documentMemory'

// CRUD, counts, ref stats, dedup
export {
  getAllMemories,
  getMemoryById,
  deleteMemory,
  deleteMemoriesByGroupId,
  deleteMemoriesByGroupPrefix,
  clearAllMemories,
  getMemoryCounts,
  resolveMemoryIds,
  updateMemoryRefStats,
  listDedupLog,
  undoDedupLog
} from './crud'
export type { MemoryCountsByType } from './crud'
