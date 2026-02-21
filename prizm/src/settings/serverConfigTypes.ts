/**
 * 服务端可视化配置类型
 * 持久化到 .prizm-data/server-config.json，环境变量可覆盖
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

export interface LLMProviderConfig {
  apiKey?: string
  model?: string
}

export interface OpenAILLMConfig extends LLMProviderConfig {
  baseUrl?: string
}

export interface ServerConfigLLM {
  xiaomimimo?: LLMProviderConfig
  zhipu?: LLMProviderConfig
  openai?: OpenAILLMConfig
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

/** 脱敏后的 LLM 配置（API Key 不返回原文） */
export interface LLMProviderConfigSanitized extends Omit<LLMProviderConfig, 'apiKey'> {
  configured?: boolean
}

export interface OpenAILLMConfigSanitized extends Omit<OpenAILLMConfig, 'apiKey'> {
  configured?: boolean
}

export interface ServerConfigLLMSanitized {
  xiaomimimo?: LLMProviderConfigSanitized
  zhipu?: LLMProviderConfigSanitized
  openai?: OpenAILLMConfigSanitized
}

export interface ServerConfigSkillsSanitized {
  skillKitApiUrl?: string
  configured?: boolean
}

export interface ServerConfigSanitized extends Omit<ServerConfig, 'llm' | 'skills'> {
  llm?: ServerConfigLLMSanitized
  skills?: ServerConfigSkillsSanitized
}
