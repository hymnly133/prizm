/**
 * @deprecated 直接导入，保持外部引用路径兼容。
 * 实际实现已拆分到 chatCore/ 目录。
 */
export { chatCore } from './chatCore/chatCore'
export type {
  ChatCoreOptions,
  ChatCoreChunkHandler,
  ChatCoreReadyInfo,
  ChatCoreReadyHandler,
  ChatCoreResult
} from './chatCore/types'
