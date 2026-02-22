/**
 * 模型列表：仅来自提供商 API 与用户自定义列表，无预设
 */

import type { LLMConfigItem, LLMProviderType } from '../settings/serverConfigTypes'
import { autoGenerateName } from '../settings/serverConfigStore'
import { createLogger } from '../logger'

const log = createLogger('ModelLists')

export interface ModelOption {
  id: string
  label: string
}

// ---------------------------------------------------------------------------
// 缓存（per configId，TTL 5 分钟）
// ---------------------------------------------------------------------------

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  models: ModelOption[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

export function clearModelCache(configId?: string): void {
  if (configId) {
    cache.delete(configId)
  } else {
    cache.clear()
  }
}

// ---------------------------------------------------------------------------
// 从提供商 API 获取模型列表
// ---------------------------------------------------------------------------

function prettifyModelId(id: string): string {
  return id
    .replace(/^models\//, '')
    .split(/[-_]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** 从多种 OpenAI 兼容的模型列表响应中解析出 { id, label } 数组 */
function parseOpenAICompatibleModelList(json: unknown): ModelOption[] {
  if (!json || typeof json !== 'object') return []
  const obj = json as Record<string, unknown>
  // 常见格式: { data: [ { id: "..." } ] } 或 { models: [ { id: "..." } ] }
  let list = obj.data ?? obj.models
  if (!Array.isArray(list)) {
    if (Array.isArray(obj)) list = obj
    else return []
  }
  const result: ModelOption[] = []
  const seen = new Set<string>()
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    const item = m as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? String(item.name).replace(/^models\//, '') : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = typeof item.display_name === 'string' ? item.display_name : typeof item.label === 'string' ? item.label : prettifyModelId(id)
    result.push({ id, label })
  }
  return result
}

async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string
): Promise<ModelOption[]> {
  let url = baseUrl.replace(/\/$/, '')
  url = url.replace(/\/chat\/completions\/?$/i, '')
  if (!url.endsWith('/models')) url += '/models'

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  const json: unknown = await res.json()
  const parsed = parseOpenAICompatibleModelList(json)
  if (parsed.length === 0) throw new Error('unexpected response shape')
  return parsed
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  const json = (await res.json()) as {
    data?: { id: string; display_name?: string }[]
  }
  const data = json.data
  if (!Array.isArray(data)) throw new Error('unexpected response shape')

  return data.map((m) => ({
    id: m.id,
    label: m.display_name || prettifyModelId(m.id)
  }))
}

async function fetchGoogleModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(10_000) }
  )
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  const json = (await res.json()) as {
    models?: { name: string; displayName?: string }[]
  }
  const models = json.models
  if (!Array.isArray(models)) throw new Error('unexpected response shape')

  return models
    .filter((m) => m.name.startsWith('models/gemini'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '')
      return { id, label: m.displayName || prettifyModelId(id) }
    })
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 将额外模型合并进列表（按 id 去重，不覆盖已有项） */
function mergeModelsInto(list: ModelOption[], toAdd: ModelOption[]): ModelOption[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const v of toAdd) {
    if (!byId.has(v.id)) byId.set(v.id, v)
  }
  return Array.from(byId.values())
}

/** 判断是否为有效的模型 id（排除占位、说明等），至少含字母或数字，长度≥2，不含纯说明前缀 */
function isValidModelId(id: string): boolean {
  if (!id || id.length < 2) return false
  const lower = id.toLowerCase()
  if (lower.startsWith('例如') || lower.startsWith('e.g') || lower === 'modelid') return false
  return /[a-z0-9]/i.test(id)
}

/**
 * 解析用户手动输入的模型列表字符串。
 * 每行一个：仅 modelId、或 "modelId, 显示名"、或 "modelId 显示名"（首个空格后为显示名）。
 * 会过滤占位/说明行，只保留形如模型 id 的项。
 */
function parseCustomModelList(raw: string | undefined): ModelOption[] {
  if (!raw?.trim()) return []
  const result: ModelOption[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let id: string
    let label: string
    const commaIdx = trimmed.indexOf(',')
    if (commaIdx >= 0) {
      id = trimmed.slice(0, commaIdx).trim()
      label = trimmed.slice(commaIdx + 1).trim() || prettifyModelId(id)
    } else {
      const spaceIdx = trimmed.search(/\s+/)
      if (spaceIdx >= 0) {
        id = trimmed.slice(0, spaceIdx).trim()
        label = trimmed.slice(spaceIdx).trim() || prettifyModelId(id)
      } else {
        id = trimmed
        label = prettifyModelId(id)
      }
    }
    if (id && isValidModelId(id) && !seen.has(id)) {
      seen.add(id)
      result.push({ id, label })
    }
  }
  return result
}

/**
 * 获取某个 LLM 配置对应的模型列表。
 * 仅来自：1）提供商 API 拉取 2）用户自定义模型列表。无任何预设。
 */
export async function fetchModelsForConfig(config: LLMConfigItem): Promise<ModelOption[]> {
  const apiKey = config.apiKey?.trim()
  const custom = parseCustomModelList(config.customModelList)

  if (!apiKey) {
    return custom
  }

  const cached = cache.get(config.id)
  if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
    return custom.length ? mergeModelsInto(cached.models, custom) : cached.models
  }

  try {
    let models: ModelOption[]
    switch (config.type) {
      case 'openai_compatible': {
        const baseUrl = config.baseUrl?.trim() || 'https://api.openai.com/v1'
        try {
          models = await fetchOpenAICompatibleModels(baseUrl, apiKey)
        } catch (e) {
          log.warn(`OpenAI-compatible models API failed (${baseUrl}): ${e}`)
          models = []
        }
        break
      }
      case 'anthropic':
        models = await fetchAnthropicModels(apiKey)
        break
      case 'google':
        models = await fetchGoogleModels(apiKey)
        break
      default:
        models = []
    }

    if (custom.length) {
      models = mergeModelsInto(models, custom)
    }

    cache.set(config.id, { models, fetchedAt: Date.now() })
    return models
  } catch (err) {
    const configLabel = config.name ?? autoGenerateName(config)
    log.warn(`Failed to fetch models for config "${configLabel}" (${config.type}): ${err}`)
    const stale = cache.get(config.id)
    if (stale) return custom.length ? mergeModelsInto(stale.models, custom) : stale.models
    return custom
  }
}

/** 同步获取模型列表（legacy/测试用），无预设，返回空 */
export function getPresetModelsForType(_type: string): ModelOption[] {
  return []
}
