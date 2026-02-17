/**
 * Prizm 配置管理
 * 从环境变量读取，支持 PRIZM_ 前缀覆盖默认值
 */

import path from 'path'

export interface PrizmConfig {
  /** 服务端口 */
  port: number
  /** 监听地址 */
  host: string
  /** 数据目录（便签、客户端等持久化） */
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

function parsePort(v: string | undefined): number {
  if (!v) return 4127
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 4127 : n
}

function parseBool(v: string | undefined, defaultValue: boolean): boolean {
  if (v === undefined || v === '') return defaultValue
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

let _config: PrizmConfig | null = null

/**
 * 获取当前配置（环境变量覆盖默认值）
 */
export function getConfig(): PrizmConfig {
  if (_config) return _config

  const env = process.env
  _config = {
    port: parsePort(env.PRIZM_PORT),
    host: env.PRIZM_HOST ?? '127.0.0.1',
    dataDir: path.resolve(process.cwd(), env.PRIZM_DATA_DIR ?? '.prizm-data'),
    authEnabled: !parseBool(env.PRIZM_AUTH_DISABLED, false),
    enableCors: parseBool(env.PRIZM_CORS_ENABLED, true),
    enableWebSocket: parseBool(env.PRIZM_WEBSOCKET_ENABLED, true),
    websocketPath: env.PRIZM_WEBSOCKET_PATH ?? '/ws',
    logLevel:
      env.PRIZM_LOG_LEVEL === 'warn' || env.PRIZM_LOG_LEVEL === 'error'
        ? env.PRIZM_LOG_LEVEL
        : 'info',
    mcpScope: env.PRIZM_MCP_SCOPE?.trim() || undefined,

    embeddingEnabled: parseBool(env.PRIZM_EMBEDDING_ENABLED, true),
    embeddingModel: env.PRIZM_EMBEDDING_MODEL?.trim() || 'TaylorAI/bge-micro-v2',
    embeddingCacheDir:
      env.PRIZM_EMBEDDING_CACHE_DIR?.trim() ||
      path.join(path.resolve(process.cwd(), env.PRIZM_DATA_DIR ?? '.prizm-data'), 'models'),
    embeddingDtype: ['q4', 'q8', 'fp16', 'fp32'].includes(env.PRIZM_EMBEDDING_DTYPE ?? '')
      ? (env.PRIZM_EMBEDDING_DTYPE as 'q4' | 'q8' | 'fp16' | 'fp32')
      : 'q8',
    embeddingMaxConcurrency: parseInt(env.PRIZM_EMBEDDING_MAX_CONCURRENCY ?? '1', 10) || 1
  }
  return _config
}

/**
 * 重置配置（用于测试）
 */
export function resetConfig(): void {
  _config = null
}
