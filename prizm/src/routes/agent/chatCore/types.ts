/**
 * chatCore — 类型定义
 */

import type { LLMStreamChunk } from '../../../adapters/interfaces'
import type {
  AgentMessage,
  ChatImageAttachment,
  MemoryIdsByLayer,
  MemoryItem,
  MemoryRefs,
  MessagePart,
  OperationActor
} from '@prizm/shared'

export interface ChatCoreOptions {
  scope: string
  sessionId: string
  content: string
  /** 图片附件列表，用于视觉模型多模态输入 */
  images?: ChatImageAttachment[]
  model?: string
  fileRefPaths?: string[]
  /** Run 引用 ID 列表；管理会话下会据此自动 grant 对应 run/步骤工作区路径 */
  runRefIds?: string[]
  signal?: AbortSignal
  mcpEnabled?: boolean
  includeScopeContext?: boolean
  /** BG 前置系统消息（systemInstructions / context / expectedOutputFormat 拼接后） */
  systemPreamble?: string
  /** 工作流管理会话：当前工作流 YAML，注入 perTurn（cache 友好） */
  workflowEditContext?: string
  /** 跳过记忆注入（BG 可按 memoryPolicy 控制） */
  skipMemory?: boolean
  /** 跳过 checkpoint 创建（BG 默认跳过） */
  skipCheckpoint?: boolean
  /** 跳过对话摘要（BG 默认跳过） */
  skipSummary?: boolean
  /** 跳过 P1 每轮记忆抽取 */
  skipPerRoundExtract?: boolean
  /** 跳过 P2 叙述性批量抽取 */
  skipNarrativeBatchExtract?: boolean
  /** 跳过 Slash 命令处理 */
  skipSlashCommands?: boolean
  /** 跳过 chatStatus 状态管理 */
  skipChatStatus?: boolean
  /** A/B 滑动窗口覆盖 */
  fullContextTurns?: number
  cachedContextTurns?: number
  /** 操作者身份（SSE 路由传 user actor，BG 传 system actor） */
  actor?: OperationActor
  /** 启用深度思考 */
  thinking?: boolean
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
