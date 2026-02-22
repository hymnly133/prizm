/**
 * LLM 提供商工厂与选择逻辑
 * 基于 server-config.json 的 llm.configs，使用 Vercel AI SDK 桥接
 */

import { getConfig } from '../config'
import { getEffectiveServerConfig } from '../settings/serverConfigStore'
import { sanitizeServerConfig } from '../settings/serverConfigStore'
import type { ServerConfigLLMSanitized, LLMConfigItemSanitized } from '../settings/serverConfigTypes'
import type { ILLMProvider } from '../adapters/interfaces'
import { resolveModel, getDefaultModelForType } from './aiSdkBridge'
import { getProviderForConfig, clearProviderCache } from './aiSdkBridge'
import { getPresetModelsForType } from './modelLists'

export interface AvailableModel {
  id: string
  label: string
  provider: string
}

/** 供客户端模型选择器：配置 + 模型列表，model 传参格式为 configId:modelId 或仅 modelId（默认配置） */
export interface AgentModelsResponse {
  configs: LLMConfigItemSanitized[]
  models: Array<{ configId: string; modelId: string; label: string }>
}

function getLLMConfig(): ServerConfigLLMSanitized | undefined {
  const config = getEffectiveServerConfig(getConfig().dataDir)
  const sanitized = sanitizeServerConfig(config)
  return sanitized.llm
}

/** 根据默认配置返回 LLM 提供商（用于摘要、记忆等未指定 model 的调用） */
export function getLLMProvider(): ILLMProvider | null {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  if (!llm?.configs?.length) return null
  const defaultConfig = llm.defaultConfigId
    ? llm.configs.find((c) => c.id === llm.defaultConfigId)
    : llm.configs[0]
  if (!defaultConfig?.apiKey?.trim()) return null
  return getProviderForConfig(defaultConfig)
}

/**
 * 根据 model 字符串解析出配置与 modelId，返回对应的 provider。
 * 供 DefaultAgentAdapter 使用；调用方应传 options.model 为 modelStr，chat 时传 resolved modelId。
 */
export function getProviderForModel(modelStr: string | undefined): {
  provider: ILLMProvider
  config: { id: string; name: string }
  modelId: string
} | null {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  const resolved = resolveModel(modelStr, llm)
  if (!resolved) return null
  const provider = getProviderForConfig(resolved.config)
  return {
    provider,
    config: { id: resolved.config.id, name: resolved.config.name },
    modelId: resolved.modelId
  }
}

/** 重置提供商缓存（配置变更后调用） */
export function resetLLMProvider(): void {
  clearProviderCache()
}

/** 返回当前默认配置名称（用于 token 统计展示） */
export function getLLMProviderName(): string {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  if (!llm?.configs?.length) return 'unknown'
  const defaultConfig = llm.defaultConfigId
    ? llm.configs.find((c) => c.id === llm.defaultConfigId)
    : llm.configs[0]
  return defaultConfig?.name ?? 'unknown'
}

/** 解析后的 model 显示名（configId:modelId 或 modelId） */
export function getModelDisplayName(modelStr: string | undefined): string {
  const resolved = getProviderForModel(modelStr)
  if (!resolved) return modelStr ?? 'unknown'
  return `${resolved.config.name} · ${resolved.modelId}`
}

/**
 * 返回所有已配置的 configs（脱敏）及可用模型列表（含 configId 供前端传参）
 */
export function getAvailableModels(): AgentModelsResponse {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  const sanitized = getLLMConfig()
  const configs = sanitized?.configs?.filter((c) => c.configured) ?? []
  const models: Array<{ configId: string; modelId: string; label: string }> = []

  if (!llm?.configs) {
    return { configs: [], models: [] }
  }

  const configsWithKey = llm.configs.filter((c) => c.apiKey?.trim())
  for (const config of configsWithKey) {
    const preset = getPresetModelsForType(config.type)
    const defaultId = config.defaultModel?.trim() || getDefaultModelForType(config.type)
    const seen = new Set<string>()
    for (const m of preset) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      models.push({ configId: config.id, modelId: m.id, label: m.label })
    }
    if (defaultId && !seen.has(defaultId)) {
      models.push({ configId: config.id, modelId: defaultId, label: defaultId })
    }
  }

  return {
    configs,
    models
  }
}

export { resolveModel, getDefaultModelForType } from './aiSdkBridge'
