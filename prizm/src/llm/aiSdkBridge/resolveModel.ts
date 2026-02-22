/**
 * 解析请求中的 model 字符串，得到 configId 与 modelId
 * 支持格式：modelId（使用默认配置）或 configId:modelId
 */

import type { ServerConfigLLM, LLMConfigItem } from '../../settings/serverConfigTypes'

export interface ResolvedModel {
  config: LLMConfigItem
  modelId: string
}

/**
 * 从 llm 配置中解析 model 字符串
 * @param modelStr 请求中的 model，如 "gpt-4o" 或 "cfg-xxx:gpt-4o"
 * @param llm 当前 server-config 的 llm
 * @returns 解析结果，若无有效配置则 null
 */
export function resolveModel(
  modelStr: string | undefined,
  llm: ServerConfigLLM | undefined
): ResolvedModel | null {
  if (!llm?.configs?.length) return null

  const defaultConfig = llm.defaultConfigId
    ? llm.configs.find((c) => c.id === llm.defaultConfigId)
    : llm.configs[0]
  if (!defaultConfig?.apiKey?.trim()) return null

  if (!modelStr || !modelStr.trim()) {
    const modelId = defaultConfig.defaultModel?.trim() || getDefaultModelForType(defaultConfig.type)
    return { config: defaultConfig, modelId }
  }

  const trimmed = modelStr.trim()
  const colonIndex = trimmed.indexOf(':')
  if (colonIndex > 0) {
    const configId = trimmed.slice(0, colonIndex).trim()
    const modelId = trimmed.slice(colonIndex + 1).trim()
    if (!modelId) return null
    const config = llm.configs.find((c) => c.id === configId && c.apiKey?.trim())
    if (!config) return null
    return { config, modelId }
  }

  return {
    config: defaultConfig,
    modelId: trimmed
  }
}

export function getDefaultModelForType(type: string): string {
  switch (type) {
    case 'openai_compatible':
      return 'gpt-4o-mini'
    case 'anthropic':
      return 'claude-sonnet-4-20250514'
    case 'google':
      return 'gemini-2.0-flash'
    default:
      return 'gpt-4o-mini'
  }
}
