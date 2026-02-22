/**
 * 服务端配置持久化
 * 路径：{dataDir}/server-config.json，dataDir 由调用方传入（仅来自 env），避免循环依赖
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { genUniqueId } from '../id'
import type {
  ServerConfig,
  ServerConfigSanitized,
  ServerConfigLLM,
  ServerConfigLLMSanitized,
  ServerConfigSkills,
  ServerConfigSkillsSanitized,
  LLMConfigItem
} from './serverConfigTypes'

const log = createLogger('ServerConfigStore')
const SERVER_CONFIG_FILE = 'server-config.json'

function getFilePath(dataDir: string): string {
  return path.join(dataDir, SERVER_CONFIG_FILE)
}

function ensureDataDir(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

/** 根据 type + baseUrl 自动生成配置显示名 */
export function autoGenerateName(config: { type: string; baseUrl?: string }): string {
  switch (config.type) {
    case 'anthropic':
      return 'Anthropic'
    case 'google':
      return 'Google'
    case 'openai_compatible': {
      const url = config.baseUrl?.trim()
      if (!url) return 'OpenAI 兼容'
      try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`)
        const host = u.hostname.replace(/^api\./, '')
        return host.split('.')[0]
          ? host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1)
          : 'OpenAI 兼容'
      } catch {
        return 'OpenAI 兼容'
      }
    }
    default:
      return 'OpenAI 兼容'
  }
}

/** 旧版 llm 结构（迁移用） */
interface LegacyLLM {
  xiaomimimo?: { apiKey?: string; model?: string }
  zhipu?: { apiKey?: string; model?: string }
  openai?: { apiKey?: string; model?: string; baseUrl?: string }
}

function isLegacyLlm(llm: unknown): llm is LegacyLLM {
  if (!llm || typeof llm !== 'object') return false
  const o = llm as Record<string, unknown>
  return (
    ('xiaomimimo' in o || 'zhipu' in o || 'openai' in o) &&
    !Array.isArray((o as { configs?: unknown }).configs)
  )
}

function migrateLegacyLlmToNew(legacy: LegacyLLM): ServerConfigLLM {
  const configs: LLMConfigItem[] = []
  let firstDefaultModel: string | undefined
  if (legacy.xiaomimimo?.apiKey?.trim()) {
    const id = genUniqueId()
    const model = legacy.xiaomimimo.model?.trim() || 'mimo-v2-flash'
    if (!firstDefaultModel) firstDefaultModel = `${id}:${model}`
    configs.push({
      id,
      name: '小米 MiMo',
      type: 'openai_compatible',
      apiKey: legacy.xiaomimimo.apiKey.trim(),
      baseUrl: 'https://api.xiaomimimo.com/v1'
    })
  }
  if (legacy.zhipu?.apiKey?.trim()) {
    const id = genUniqueId()
    const model = legacy.zhipu.model?.trim() || 'glm-4-flash'
    if (!firstDefaultModel) firstDefaultModel = `${id}:${model}`
    configs.push({
      id,
      name: '智谱',
      type: 'openai_compatible',
      apiKey: legacy.zhipu.apiKey.trim(),
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4'
    })
  }
  if (legacy.openai?.apiKey?.trim()) {
    const id = genUniqueId()
    const model = legacy.openai.model?.trim() || 'gpt-4o-mini'
    if (!firstDefaultModel) firstDefaultModel = `${id}:${model}`
    configs.push({
      id,
      name: 'OpenAI',
      type: 'openai_compatible',
      apiKey: legacy.openai.apiKey.trim(),
      baseUrl: legacy.openai.baseUrl?.trim()
    })
  }
  return {
    defaultModel: firstDefaultModel,
    configs
  }
}

/** 旧格式：config 上带 defaultModel、顶层带 defaultConfigId */
interface LegacyConfigWithDefaultModel extends LLMConfigItem {
  defaultModel?: string
}

function normalizeLlm(llm: unknown): ServerConfigLLM | undefined {
  if (!llm || typeof llm !== 'object') return undefined
  if (isLegacyLlm(llm)) {
    return migrateLegacyLlmToNew(llm)
  }
  const o = llm as ServerConfigLLM & { defaultConfigId?: string }
  if (!Array.isArray(o.configs)) return undefined

  let defaultModel = o.defaultModel
  if (!defaultModel && o.defaultConfigId) {
    const defaultConfig = o.configs.find((c) => c.id === o.defaultConfigId) as
      | LegacyConfigWithDefaultModel
      | undefined
    if (defaultConfig?.defaultModel?.trim()) {
      defaultModel = `${defaultConfig.id}:${defaultConfig.defaultModel.trim()}`
    }
  }

  const configs: LLMConfigItem[] = o.configs.map((c) => {
    const { defaultModel: _dm, ...rest } = c as LegacyConfigWithDefaultModel
    const item: LLMConfigItem = { ...rest }
    if (!item.name?.trim()) {
      item.name = autoGenerateName({ type: item.type, baseUrl: item.baseUrl })
    }
    return item
  })

  return {
    defaultModel,
    browserModel: o.browserModel,
    configs
  }
}

/**
 * 从磁盘加载 server-config，不依赖 getConfig()
 * @param dataDir 数据目录（仅从 env 解析得到）
 */
export function loadServerConfig(dataDir: string): ServerConfig {
  const filePath = getFilePath(dataDir)
  if (!fs.existsSync(filePath)) {
    return {}
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content) as ServerConfig & { llm?: unknown }
    const llm = normalizeLlm(data.llm)
    return {
      server: data.server ?? {},
      embedding: data.embedding ?? {},
      agent: data.agent ?? {},
      llm,
      skills: data.skills ?? {},
      updatedAt: data.updatedAt
    }
  } catch (err) {
    log.error('Failed to load server-config.json:', err)
    return {}
  }
}

/**
 * 保存部分配置并合并到现有
 * @param dataDir 数据目录
 */
export function saveServerConfig(dataDir: string, partial: Partial<ServerConfig>): void {
  ensureDataDir(dataDir)
  const current = loadServerConfig(dataDir)
  function mergeDefined<T extends Record<string, unknown>>(
    base: T | undefined,
    patch: T | undefined
  ): T {
    const out = { ...(base ?? {}) } as T
    if (!patch) return out
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v
    }
    return out
  }

  const llm: ServerConfigLLM | undefined =
    partial.llm !== undefined
      ? (() => {
          const currentConfigs = current.llm?.configs ?? []
          const byId = new Map(currentConfigs.map((c) => [c.id, c]))

          let configs: LLMConfigItem[]

          const updateOne = (partial.llm as { updateConfig?: LLMConfigItem }).updateConfig
          if (updateOne?.id && updateOne?.type) {
            const existing = byId.get(updateOne.id)
            const apiKey =
              updateOne.apiKey !== undefined && updateOne.apiKey !== ''
                ? updateOne.apiKey
                : existing?.apiKey
            const merged: LLMConfigItem = {
              id: updateOne.id,
              name:
                updateOne.name?.trim() ||
                autoGenerateName({ type: updateOne.type, baseUrl: updateOne.baseUrl }),
              type: updateOne.type,
              baseUrl: updateOne.baseUrl,
              ...(apiKey !== undefined ? { apiKey } : {}),
              ...(updateOne.customModelList !== undefined
                ? { customModelList: updateOne.customModelList }
                : {})
            }
            const next = existing
              ? currentConfigs.map((c) => (c.id === updateOne.id ? merged : c))
              : [...currentConfigs, merged]
            configs = next
          } else if (Array.isArray(partial.llm.configs)) {
            configs = partial.llm.configs
              .filter((c) => c?.id && c?.type)
              .map((c) => {
                const existing = byId.get(c.id)
                const apiKey =
                  c.apiKey !== undefined && c.apiKey !== '' ? c.apiKey : existing?.apiKey
                return {
                  id: c.id,
                  name: c.name?.trim() || autoGenerateName({ type: c.type, baseUrl: c.baseUrl }),
                  type: c.type,
                  baseUrl: c.baseUrl,
                  ...(apiKey !== undefined ? { apiKey } : {}),
                  ...((c as LLMConfigItem).customModelList !== undefined
                    ? { customModelList: (c as LLMConfigItem).customModelList }
                    : {})
                }
              })
          } else {
            configs = currentConfigs
          }

          return {
            defaultModel:
              partial.llm.defaultModel !== undefined
                ? partial.llm.defaultModel
                : current.llm?.defaultModel,
            browserModel:
              partial.llm.browserModel !== undefined
                ? partial.llm.browserModel
                : current.llm?.browserModel,
            configs
          }
        })()
      : current.llm

  const merged: ServerConfig = {
    server: mergeDefined(
      current.server as Record<string, unknown>,
      partial.server as Record<string, unknown>
    ) as ServerConfig['server'],
    embedding: mergeDefined(
      current.embedding as Record<string, unknown>,
      partial.embedding as Record<string, unknown>
    ) as ServerConfig['embedding'],
    agent: mergeDefined(
      current.agent as Record<string, unknown>,
      partial.agent as Record<string, unknown>
    ) as ServerConfig['agent'],
    llm: llm ?? current.llm,
    skills: mergeDefined(
      current.skills as Record<string, unknown>,
      partial.skills as Record<string, unknown>
    ) as ServerConfig['skills'],
    updatedAt: Date.now()
  }
  const filePath = getFilePath(dataDir)
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
  log.info('Server config saved')
}

/**
 * 获取有效配置：文件内容 + 环境变量覆盖（仅 server/agent/skills 部分，LLM 不再用环境变量）
 * dataDir 由调用方传入（通常 getConfig().dataDir）
 */
export function getEffectiveServerConfig(dataDir: string): ServerConfig {
  const file = loadServerConfig(dataDir)
  const env = typeof process !== 'undefined' ? process.env : {}
  return {
    server: file.server,
    embedding: file.embedding,
    agent: {
      scopeContextMaxChars:
        (env.PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS?.trim()
          ? parseInt(env.PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS, 10)
          : undefined) ?? file.agent?.scopeContextMaxChars
    },
    llm: file.llm,
    skills: {
      skillKitApiUrl: env.PRIZM_SKILLKIT_API_URL?.trim() || file.skills?.skillKitApiUrl,
      githubToken: env.GITHUB_TOKEN?.trim() || file.skills?.githubToken
    },
    updatedAt: file.updatedAt
  }
}

/**
 * 脱敏：API Key、Token 不返回原文，仅标记 configured
 */
export function sanitizeServerConfig(config: ServerConfig): ServerConfigSanitized {
  const out: ServerConfigSanitized = { ...config }
  if (config.llm?.configs) {
    out.llm = {
      defaultModel: config.llm.defaultModel,
      browserModel: config.llm.browserModel,
      configs: config.llm.configs.map((c) => ({
        id: c.id,
        name: c.name ?? autoGenerateName({ type: c.type, baseUrl: c.baseUrl }),
        type: c.type,
        baseUrl: c.baseUrl,
        configured: !!c.apiKey?.trim(),
        ...(c.customModelList !== undefined ? { customModelList: c.customModelList } : {})
      }))
    }
  }
  if (config.skills) {
    const skills: ServerConfigSkillsSanitized = {
      skillKitApiUrl: config.skills.skillKitApiUrl,
      configured: !!config.skills.githubToken?.trim()
    }
    out.skills = skills
  }
  return out
}
