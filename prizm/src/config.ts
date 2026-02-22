/**
 * Prizm 配置管理
 * 合并顺序：默认值 ← server-config.json ← 环境变量（env 覆盖文件）
 * dataDir 仅来自环境变量，用于定位 server-config.json
 */

import path from 'path'
import { loadServerConfig } from './settings/serverConfigStore'

export interface PrizmConfig {
  /** 服务端口 */
  port: number
  /** 监听地址 */
  host: string
  /** 数据目录（便签、客户端等持久化，仅来自 env） */
  dataDir: string
  /** 是否启用鉴权 */
  authEnabled: boolean
  /** 是否启用 CORS */
  enableCors: boolean
  /** 是否启用 WebSocket */
  enableWebSocket: boolean
  /** WebSocket 路径 */
  websocketPath: string
  /** 日志级别 */
  logLevel: 'info' | 'warn' | 'error'
  /** MCP 默认 scope，连接时未传 ?scope= 时使用。环境变量 PRIZM_MCP_SCOPE */
  mcpScope?: string

  // ---- Embedding 相关 ----

  /** 是否启用本地 embedding 模型（默认 true） */
  embeddingEnabled: boolean
  /** Embedding 模型名称（HuggingFace Hub ID） */
  embeddingModel: string
  /** 模型缓存目录（默认 {dataDir}/models） */
  embeddingCacheDir: string
  /** 量化类型（默认 q8，可选 q4 / fp16 / fp32） */
  embeddingDtype: 'q4' | 'q8' | 'fp16' | 'fp32'
  /** 最大并发推理数（默认 1，ONNX Runtime 非线程安全） */
  embeddingMaxConcurrency: number
}

function parsePort(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
}

function parseBool(v: string | undefined, defaultValue: boolean): boolean {
  if (v === undefined || v === '') return defaultValue
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

let _config: PrizmConfig | null = null

/**
 * 获取当前配置（server-config.json 与环境变量合并，env 优先）
 */
export function getConfig(): PrizmConfig {
  if (_config) return _config

  const env = process.env
  const dataDirFromEnv = path.resolve(process.cwd(), env.PRIZM_DATA_DIR ?? '.prizm-data')
  const fileConfig = loadServerConfig(dataDirFromEnv)
  const s = fileConfig.server
  const e = fileConfig.embedding

  _config = {
    port: parsePort(env.PRIZM_PORT) ?? s?.port ?? 4127,
    host: (env.PRIZM_HOST?.trim() || s?.host) ?? '127.0.0.1',
    dataDir: dataDirFromEnv,
    authEnabled:
      env.PRIZM_AUTH_DISABLED !== undefined
        ? !parseBool(env.PRIZM_AUTH_DISABLED, false)
        : s?.authDisabled === true
        ? false
        : true,
    enableCors:
      env.PRIZM_CORS_ENABLED !== undefined
        ? parseBool(env.PRIZM_CORS_ENABLED, true)
        : s?.corsEnabled ?? true,
    enableWebSocket:
      env.PRIZM_WEBSOCKET_ENABLED !== undefined
        ? parseBool(env.PRIZM_WEBSOCKET_ENABLED, true)
        : s?.websocketEnabled ?? true,
    websocketPath: (env.PRIZM_WEBSOCKET_PATH?.trim() || s?.websocketPath) ?? '/ws',
    logLevel:
      env.PRIZM_LOG_LEVEL === 'warn' || env.PRIZM_LOG_LEVEL === 'error'
        ? env.PRIZM_LOG_LEVEL
        : s?.logLevel ?? 'info',
    mcpScope: env.PRIZM_MCP_SCOPE?.trim() || s?.mcpScope?.trim() || undefined,

    embeddingEnabled:
      env.PRIZM_EMBEDDING_ENABLED !== undefined
        ? parseBool(env.PRIZM_EMBEDDING_ENABLED, true)
        : e?.enabled ?? true,
    embeddingModel:
      env.PRIZM_EMBEDDING_MODEL?.trim() || e?.model?.trim() || 'TaylorAI/bge-micro-v2',
    embeddingCacheDir:
      env.PRIZM_EMBEDDING_CACHE_DIR?.trim() ||
      e?.cacheDir?.trim() ||
      path.join(dataDirFromEnv, 'models'),
    embeddingDtype: ['q4', 'q8', 'fp16', 'fp32'].includes(env.PRIZM_EMBEDDING_DTYPE ?? '')
      ? (env.PRIZM_EMBEDDING_DTYPE as 'q4' | 'q8' | 'fp16' | 'fp32')
      : e?.dtype ?? 'q8',
    embeddingMaxConcurrency:
      (parseInt(env.PRIZM_EMBEDDING_MAX_CONCURRENCY ?? '', 10) || e?.maxConcurrency) ?? 1
  }
  if (_config.embeddingMaxConcurrency < 1) _config.embeddingMaxConcurrency = 1
  return _config
}

/**
 * 重置配置（用于测试）
 */
export function resetConfig(): void {
  _config = null
}
