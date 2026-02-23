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

/** 单条 LLM 配置（用户仅填 type / baseUrl / apiKey；name 可选，缺省时服务端自动生成） */
export interface LLMConfigItem {
  id: string
  name?: string
  type: LLMProviderType
  apiKey?: string
  /** 仅 openai_compatible 使用 */
  baseUrl?: string
  /** 用户手动输入的模型列表，每行一个：modelId 或 "modelId 显示名" 或 "modelId, 显示名"，会与接口/预设列表合并 */
  customModelList?: string
}

export interface ServerConfigLLM {
  /** 系统默认模型，格式 "configId:modelId" */
  defaultModel?: string
  /** 浏览器节点使用的模型，格式 "configId:modelId"。未设置时使用系统默认。 */
  browserModel?: string
  configs?: LLMConfigItem[]
  /** PATCH 时可选：仅更新单条配置，不传 configs 则只合并此条并保留其他配置的 apiKey */
  updateConfig?: LLMConfigItem
}

/** 解析后的 (配置:模型) 条目，API 返回，不持久化 */
export interface ModelEntry {
  configId: string
  configName: string
  modelId: string
  label: string
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
  defaultModel?: string
  browserModel?: string
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
