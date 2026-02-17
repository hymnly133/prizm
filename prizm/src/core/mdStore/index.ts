/**
 * Markdown 单文件存储 V3 - 双层架构
 * Layer 0: 通用文件读写（readFileByPath, writeFileByPath, listDirectory, moveFile）
 * Layer 1: Prizm 知识库（readDocuments, writeDocuments, readTodoLists, writeTodoLists）
 *   - 标题驱动文件名，frontmatter 存元数据
 *   - 用户内容：scope 根及任意子目录，按 prizm_type 过滤
 *   - 系统内容：.prizm/ 下固定子目录
 *
 * Barrel: re-exports from submodules for backward compatibility.
 */

export { sanitizeFileName } from './utils'

export {
  validateRelativePath,
  isSystemPath,
  readFileByPath,
  writeFileByPath,
  listDirectory,
  mkdirByPath,
  moveFile,
  deleteByPath,
  statByPath
} from './fileOps'

export {
  readDocuments,
  writeDocuments,
  writeSingleDocument,
  deleteSingleDocument,
  readSingleDocumentById,
  readLegacyNotes
} from './documentStore'

export {
  readTodoLists,
  writeTodoLists,
  readSingleTodoListById,
  writeSingleTodoList,
  deleteSingleTodoList
} from './todoStore'

export { readClipboard, writeClipboard } from './clipboardStore'

export {
  readAgentSessions,
  writeAgentSessions,
  readSessionSummary,
  writeSessionSummary,
  readSessionMemories,
  appendSessionMemories,
  deleteSessionDir,
  ensureSessionWorkspace
} from './sessionStore'

export { readSessionActivities, appendSessionActivities } from './tokenUsageStore'
