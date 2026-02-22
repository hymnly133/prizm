/**
 * 服务端可视化配置类型
 * 持久化到 .prizm-data/server-config.json
 */

export interface ServerConfigServer {
  port?: number
  host?: string
  authDisabled?: boolean
  logLevel?: 'info' | 'warn' | 'error'
  mcpScope?: string
  corsEnabled?: boolean
  websocketEnabled?: boolean
  websocketPath?: string
}

export interface ServerConfigEmbedding {
  enabled?: boolean
  model?: string
  cacheDir?: string
  dtype?: 'q4' | 'q8' | 'fp16' | 'fp32'
  maxConcurrency?: number
}

export interface ServerConfigAgent {
  scopeContextMaxChars?: number
}

/** LLM 提供商类型：OpenAI 兼容 / Anthropic / Google */
export type LLMProviderType = 'openai_compatible' | 'anthropic' | 'google'

/** 单条 LLM 配置（用户可添加多条，在配置间切换） */
export interface LLMConfigItem {
  id: string
  name: string
  type: LLMProviderType
  apiKey?: string
  /** 仅 openai_compatible 使用 */
  baseUrl?: string
  defaultModel?: string
}

export interface ServerConfigLLM {
  defaultConfigId?: string
  configs: LLMConfigItem[]
}

export interface ServerConfigSkills {
  skillKitApiUrl?: string
  githubToken?: string
}

export interface ServerConfig {
  server?: ServerConfigServer
  embedding?: ServerConfigEmbedding
  agent?: ServerConfigAgent
  llm?: ServerConfigLLM
  skills?: ServerConfigSkills
  updatedAt?: number
}

/** 脱敏后的单条 LLM 配置（API Key 不返回原文） */
export interface LLMConfigItemSanitized extends Omit<LLMConfigItem, 'apiKey'> {
  configured?: boolean
}

export interface ServerConfigLLMSanitized {
  defaultConfigId?: string
  configs: LLMConfigItemSanitized[]
}

export interface ServerConfigSkillsSanitized {
  skillKitApiUrl?: string
  configured?: boolean
}

export interface ServerConfigSanitized extends Omit<ServerConfig, 'llm' | 'skills'> {
  llm?: ServerConfigLLMSanitized
  skills?: ServerConfigSkillsSanitized
}
