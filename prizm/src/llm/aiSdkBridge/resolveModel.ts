/**
 * 解析请求中的 model 字符串，得到 config 与 modelId
 * 格式：configId:modelId；空时使用 llm.defaultModel，再回退到首配置 + 类型默认模型
 */

import type { ServerConfigLLM, LLMConfigItem } from '../../settings/serverConfigTypes'

export interface ResolvedModel {
  config: LLMConfigItem
  modelId: string
}

/**
 * 从 llm 配置中解析 model 字符串
 * @param modelStr 请求中的 model，如 "configId:gpt-4o"；空则用 llm.defaultModel
 * @param llm 当前 server-config 的 llm
 * @returns 解析结果，若无有效配置则 null
 */
export function resolveModel(
  modelStr: string | undefined,
  llm: ServerConfigLLM | undefined
): ResolvedModel | null {
  if (!llm?.configs?.length) return null

  const firstConfigWithKey = llm.configs.find((c) => c.apiKey?.trim())
  if (!firstConfigWithKey) return null

  const trimmed = modelStr?.trim()
  if (!trimmed) {
    if (llm.defaultModel?.trim()) {
      const resolved = parseConfigModel(llm.defaultModel.trim(), llm)
      if (resolved) return resolved
    }
    const modelId = getDefaultModelForType(firstConfigWithKey.type)
    return { config: firstConfigWithKey, modelId }
  }

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
    config: firstConfigWithKey,
    modelId: trimmed
  }
}

function parseConfigModel(
  str: string,
  llm: ServerConfigLLM
): ResolvedModel | null {
  const colonIndex = str.indexOf(':')
  if (colonIndex <= 0) return null
  const configId = str.slice(0, colonIndex).trim()
  const modelId = str.slice(colonIndex + 1).trim()
  if (!modelId) return null
  const config = llm.configs.find((c) => c.id === configId && c.apiKey?.trim())
  if (!config) return null
  return { config, modelId }
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
