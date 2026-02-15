/**
 * Agent 工具统一设置类型
 * 内置工具 + MCP 服务器 + LLM 摘要配置 + 记忆模块
 */

import type { McpServerConfig } from '../mcp-client/types'
import type { MemorySettings } from '@prizm/shared'

export type { MemorySettings }

/** 内置工具：Tavily 联网搜索 */
export interface TavilySettings {
  apiKey?: string
  enabled?: boolean
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
}

/** 文档摘要：超长文档异步生成 LLM 摘要 */
export interface DocumentSummarySettings {
  enabled?: boolean
  /** 最小字符数才触发摘要，默认 500 */
  minLen?: number
  /** 使用的模型 ID，空则用默认 provider 默认模型 */
  model?: string
}

/** 对话摘要：根据用户输入生成动宾短语，用于会话列表标题 */
export interface ConversationSummarySettings {
  enabled?: boolean
  /** 使用的模型 ID，空则用默认 provider 默认模型 */
  model?: string
}

/** 上下文窗口 A/B 压缩：完全上下文轮数 A、缓存轮数 B，满 A+B 时将最老 B 轮压缩为 Session 记忆 */
export interface ContextWindowSettings {
  /** 完全上下文轮数（最新 A 轮保持原始发送） */
  fullContextTurns?: number
  /** 缓存轮数（每 B 轮压缩为一段 Session 记忆） */
  cachedContextTurns?: number
}

/** Agent LLM 相关设置（文档摘要、对话摘要、默认模型、记忆、上下文窗口） */
export interface AgentLLMSettings {
  /** 文档摘要配置 */
  documentSummary?: DocumentSummarySettings
  /** 对话摘要配置（会话列表标题） */
  conversationSummary?: ConversationSummarySettings
  /** 默认对话模型，客户端可覆盖 */
  defaultModel?: string
  /** 记忆模块配置 */
  memory?: MemorySettings
  /** 上下文窗口 A/B 压缩配置 */
  contextWindow?: ContextWindowSettings
}

/** 内置工具集合（可扩展） */
export interface BuiltinToolsSettings {
  tavily?: TavilySettings
}

/** 统一 Agent 工具设置 */
export interface AgentToolsSettings {
  builtin?: BuiltinToolsSettings
  /** Agent LLM 设置：摘要、默认模型、记忆 */
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  updatedAt?: number
}
