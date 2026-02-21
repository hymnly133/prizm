/**
 * 核心层接口定义
 *
 * 定义核心模块依赖的抽象接口，避免 core → routes 的反向依赖。
 * 具体实现由 server.ts 在启动时注入。
 */

import type { IAgentAdapter, LLMStreamChunk } from '../adapters/interfaces'
import type {
  AgentMessage,
  MemoryItem,
  MemoryRefs,
  MessagePart,
  OperationActor,
  SessionMemoryPolicy
} from '@prizm/shared'

// ─── ChatCore 相关类型 ───

export interface ChatCoreOptions {
  scope: string
  sessionId: string
  content: string
  model?: string
  fileRefPaths?: string[]
  signal?: AbortSignal
  mcpEnabled?: boolean
  includeScopeContext?: boolean
  systemPreamble?: string
  workflowEditContext?: string
  skipMemory?: boolean
  skipCheckpoint?: boolean
  skipSummary?: boolean
  skipPerRoundExtract?: boolean
  skipNarrativeBatchExtract?: boolean
  skipSlashCommands?: boolean
  skipChatStatus?: boolean
  fullContextTurns?: number
  cachedContextTurns?: number
  actor?: OperationActor
}

export type ChatCoreChunkHandler = (chunk: LLMStreamChunk) => void

export interface ChatCoreReadyInfo {
  injectedMemories: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null
}
export type ChatCoreReadyHandler = (info: ChatCoreReadyInfo) => void

export interface ChatCoreResult {
  appendedMsg: AgentMessage
  parts: MessagePart[]
  reasoning: string
  usage?: {
    totalTokens?: number
    totalInputTokens?: number
    totalOutputTokens?: number
  }
  memoryRefs: MemoryRefs
  injectedMemories: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null
  stopped: boolean
  commandResult?: string
}

/**
 * 对话核心服务接口
 *
 * 被 BgSessionManager、WorkflowRunner 等核心模块消费，
 * 由 routes/agent/chatCore.ts 的 chatCore 函数实现。
 */
export interface IChatService {
  execute(
    adapter: IAgentAdapter,
    options: ChatCoreOptions,
    onChunk: ChatCoreChunkHandler,
    onReady?: ChatCoreReadyHandler
  ): Promise<ChatCoreResult>
}
