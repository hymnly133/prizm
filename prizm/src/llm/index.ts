/**
 * LLM 提供商工厂与选择逻辑
 * 基于 server-config.json 的 llm.configs，解析为 (配置:模型) 条目列表，下游仅选择条目。
 */

import { getConfig } from '../config'
import { getEffectiveServerConfig, sanitizeServerConfig, autoGenerateName } from '../settings/serverConfigStore'
import type { ServerConfigLLMSanitized, LLMConfigItemSanitized, ModelEntry } from '../settings/serverConfigTypes'
import type { ILLMProvider } from '../adapters/interfaces'
import { resolveModel, getDefaultModelForType } from './aiSdkBridge'
import { getProviderForConfig, clearProviderCache } from './aiSdkBridge'
import { fetchModelsForConfig } from './modelLists'

export type { ModelEntry }

export interface AvailableModel {
  id: string
  label: string
  provider: string
}

/** 供客户端模型选择器：系统默认 + 解析后的 (配置:模型) 条目列表 */
export interface AgentModelsResponse {
  defaultModel?: string
  configs: LLMConfigItemSanitized[]
  entries: ModelEntry[]
}

function getLLMConfig(): ServerConfigLLMSanitized | undefined {
  const config = getEffectiveServerConfig(getConfig().dataDir)
  const sanitized = sanitizeServerConfig(config)
  return sanitized.llm
}

/** 根据系统默认模型返回 LLM 提供商（用于摘要、记忆等未指定 model 的调用） */
export function getLLMProvider(): ILLMProvider | null {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  if (!llm?.configs?.length) return null
  const resolved = resolveModel(undefined, llm)
  if (!resolved) return null
  return getProviderForConfig(resolved.config)
}

/**
 * 根据 model 字符串（configId:modelId）解析出配置与 modelId，返回对应的 provider。
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
  const configName = resolved.config.name ?? autoGenerateName(resolved.config)
  return {
    provider,
    config: { id: resolved.config.id, name: configName },
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
  const resolved = resolveModel(undefined, llm)
  if (!resolved) return 'unknown'
  return resolved.config.name ?? autoGenerateName(resolved.config)
}

/** 解析后的 model 显示名（ConfigName: modelId） */
export function getModelDisplayName(modelStr: string | undefined): string {
  const resolved = getProviderForModel(modelStr)
  if (!resolved) return modelStr ?? 'unknown'
  return `${resolved.config.name} · ${resolved.modelId}`
}

/**
 * 返回系统默认模型 + 解析后的 (配置:模型) 条目列表，供下游仅选择条目。
 */
export async function getAvailableModels(): Promise<AgentModelsResponse> {
  const llm = getEffectiveServerConfig(getConfig().dataDir).llm
  const sanitized = getLLMConfig()
  const configs = sanitized?.configs?.filter((c) => c.configured) ?? []
  const entries: ModelEntry[] = []

  if (!llm?.configs) {
    return { defaultModel: undefined, configs: [], entries: [] }
  }

  const configsWithKey = llm.configs.filter((c) => c.apiKey?.trim())
  const fetched = await Promise.all(configsWithKey.map((c) => fetchModelsForConfig(c)))

  for (let i = 0; i < configsWithKey.length; i++) {
    const config = configsWithKey[i]!
    const apiModels = fetched[i]!
    const configName = config.name ?? autoGenerateName(config)
    const seen = new Set<string>()
    for (const m of apiModels) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      entries.push({
        configId: config.id,
        configName,
        modelId: m.id,
        label: `${configName}: ${m.label}`
      })
    }
  }

  return {
    defaultModel: llm.defaultModel,
    configs,
    entries
  }
}

export { resolveModel, getDefaultModelForType } from './aiSdkBridge'
export { clearModelCache } from './modelLists'
