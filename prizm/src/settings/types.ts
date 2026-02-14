/**
 * Agent 工具统一设置类型
 * 内置工具 + MCP 服务器 + LLM 摘要配置
 */

import type { McpServerConfig } from '../mcp-client/types'

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

/** 对话摘要：每 N 次对话生成会话摘要，用于压缩上下文 */
export interface ConversationSummarySettings {
  enabled?: boolean
  /** 每 N 轮 user+assistant 对话后生成摘要，默认 10 */
  interval?: number
  /** 使用的模型 ID，空则用默认 provider 默认模型 */
  model?: string
}

/** Agent LLM 相关设置（文档摘要、对话摘要、默认模型） */
export interface AgentLLMSettings {
  /** 文档摘要配置 */
  documentSummary?: DocumentSummarySettings
  /** 对话摘要配置 */
  conversationSummary?: ConversationSummarySettings
  /** 默认对话模型，客户端可覆盖 */
  defaultModel?: string
}

/** 内置工具集合（可扩展） */
export interface BuiltinToolsSettings {
  tavily?: TavilySettings
}

/** 统一 Agent 工具设置 */
export interface AgentToolsSettings {
  builtin?: BuiltinToolsSettings
  /** Agent LLM 设置：摘要、默认模型 */
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  updatedAt?: number
}
