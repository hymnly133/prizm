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

/**
 * 文档记忆设置：文档内容通过记忆系统抽取三层记忆（总览 + 原子事实 + 迁移）
 * 替代原 DocumentSummarySettings
 */
export interface DocumentMemorySettings {
  enabled?: boolean
  /** 最小字符数才触发记忆抽取，默认 500 */
  minLen?: number
}

/** @deprecated 已替换为 DocumentMemorySettings，保留兼容 */
export type DocumentSummarySettings = DocumentMemorySettings

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

/** Agent LLM 相关设置（文档记忆、对话摘要、默认模型、记忆、上下文窗口） */
export interface AgentLLMSettings {
  /** 文档记忆配置（原 documentSummary） */
  documentSummary?: DocumentMemorySettings
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

/** 自定义命令全局设置 */
export interface CommandsSettings {
  /** 全局开关，默认 true */
  enabled?: boolean
  /** 自动导入配置 */
  autoImport?: {
    /** 自动导入 .cursor/commands/ */
    cursor?: boolean
    /** 自动导入 .claude/commands/ */
    claudeCode?: boolean
  }
}

/** Skills 全局设置 */
export interface SkillsSettings {
  /** 全局开关，默认 true */
  enabled?: boolean
  /** 自动激活，默认 true */
  autoActivate?: boolean
  /** 最大同时激活数，默认 3 */
  maxActiveSkills?: number
  /** per-skill 覆盖 */
  skillOverrides?: SkillOverride[]
}

/** 单个 skill 的覆盖配置 */
export interface SkillOverride {
  name: string
  enabled?: boolean
  autoActivate?: boolean
}

/** 终端设置 */
export interface TerminalSettings {
  /** 用户选择的默认 shell（留空则自动检测） */
  defaultShell?: string
}

/** Rules 全局设置 */
export interface RulesSettings {
  /** 全局开关，默认 true */
  enabled?: boolean
  /** token 预算，默认 8000 */
  maxTokens?: number
  /** 自动发现项目规则文件，默认 true */
  autoDiscover?: boolean
  /** 可选限制来源 */
  enabledSources?: string[]
}

/** 统一 Agent 工具设置 */
export interface AgentToolsSettings {
  builtin?: BuiltinToolsSettings
  /** Agent LLM 设置：摘要、默认模型、记忆 */
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  /** 自定义命令设置 */
  commands?: CommandsSettings
  /** Skills 设置 */
  skills?: SkillsSettings
  /** Rules 设置 */
  rules?: RulesSettings
  /** 终端设置 */
  terminal?: TerminalSettings
  updatedAt?: number
}
