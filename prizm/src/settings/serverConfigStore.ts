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
  if (legacy.xiaomimimo?.apiKey?.trim()) {
    configs.push({
      id: genUniqueId(),
      name: '小米 MiMo',
      type: 'openai_compatible',
      apiKey: legacy.xiaomimimo.apiKey.trim(),
      baseUrl: 'https://api.xiaomimimo.com/v1',
      defaultModel: legacy.xiaomimimo.model?.trim() || 'mimo-v2-flash'
    })
  }
  if (legacy.zhipu?.apiKey?.trim()) {
    configs.push({
      id: genUniqueId(),
      name: '智谱',
      type: 'openai_compatible',
      apiKey: legacy.zhipu.apiKey.trim(),
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: legacy.zhipu.model?.trim() || 'glm-4-flash'
    })
  }
  if (legacy.openai?.apiKey?.trim()) {
    configs.push({
      id: genUniqueId(),
      name: 'OpenAI',
      type: 'openai_compatible',
      apiKey: legacy.openai.apiKey.trim(),
      baseUrl: legacy.openai.baseUrl?.trim(),
      defaultModel: legacy.openai.model?.trim() || 'gpt-4o-mini'
    })
  }
  return {
    defaultConfigId: configs[0]?.id,
    configs
  }
}

function normalizeLlm(llm: unknown): ServerConfigLLM | undefined {
  if (!llm || typeof llm !== 'object') return undefined
  if (isLegacyLlm(llm)) {
    return migrateLegacyLlmToNew(llm)
  }
  const o = llm as ServerConfigLLM
  if (!Array.isArray(o.configs)) return undefined
  return {
    defaultConfigId: o.defaultConfigId,
    configs: o.configs
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
      ? {
          defaultConfigId:
            partial.llm.defaultConfigId !== undefined
              ? partial.llm.defaultConfigId
              : current.llm?.defaultConfigId,
          configs: Array.isArray(partial.llm.configs)
            ? partial.llm.configs.filter((c) => c?.id && c?.name && c?.type)
            : current.llm?.configs ?? []
        }
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
      defaultConfigId: config.llm.defaultConfigId,
      configs: config.llm.configs.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        baseUrl: c.baseUrl,
        defaultModel: c.defaultModel,
        configured: !!c.apiKey?.trim()
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
