/**
 * 本地 Embedding 模型服务
 *
 * 基于 @huggingface/transformers (Transformers.js) 提供本地向量推理，
 * 默认使用 TaylorAI/bge-micro-v2（384 维，~17M 参数）。
 *
 * 功能：
 * - 单例模型加载 + Promise 锁防重入
 * - 完善的生命周期管理（idle → loading → ready → error / disposing）
 * - 推理统计（调用次数、延迟分布、错误追踪）
 * - 并发推理队列控制
 * - 通过 registerLocalEmbeddingProvider 注入 EverMemService
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../logger'
import { getConfig } from '../config'
import { registerLocalEmbeddingProvider, clearLocalEmbeddingProvider } from './EverMemService'

const log = createLogger('LocalEmbedding')

// ==================== 内置模型路径解析 ====================

/**
 * 解析内置模型的 assets 目录。
 * tsup ESM 打包后运行于 dist/cli.js 或 dist/index.js，
 * 内置模型在同级 ../assets/models/。
 */
function resolveBundledModelsDir(): string | null {
  const candidates: string[] = []

  // 1. 基于 import.meta.url（打包后 dist/*.js → ../assets/models）
  try {
    const distDir = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(path.resolve(distDir, '../assets/models'))
  } catch {
    // import.meta.url 不可用（测试环境等）
  }

  // 2. 基于 cwd（开发模式 / 直接运行）
  candidates.push(path.resolve(process.cwd(), 'assets/models'))

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

/** 检查某个目录下是否存在指定模型的关键文件 */
function modelExistsIn(baseDir: string, modelName: string): boolean {
  const modelDir = path.join(baseDir, modelName)
  return (
    fs.existsSync(path.join(modelDir, 'config.json')) &&
    fs.existsSync(path.join(modelDir, 'tokenizer.json'))
  )
}

// ==================== 类型定义 ====================

/** 模型生命周期状态 */
export type EmbeddingState = 'idle' | 'loading' | 'ready' | 'error' | 'disposing'

/** 推理统计信息 */
export interface EmbeddingStats {
  totalCalls: number
  totalErrors: number
  totalCharsProcessed: number
  avgLatencyMs: number
  p95LatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  lastError: { message: string; timestamp: number } | null
  modelLoadTimeMs: number
}

/** 完整状态信息（含配置） */
export interface EmbeddingStatus {
  state: EmbeddingState
  modelName: string
  dimension: number
  enabled: boolean
  dtype: string
  /** 模型加载来源：'bundled' | 'cache' | 'download' */
  source: string
  stats: EmbeddingStats
  cacheDir: string
  /** 模型专属内存估算（加载前后 heapUsed 差值），单位 MB */
  modelMemoryMb: number
  /** Node.js 进程 RSS，单位 MB */
  processMemoryMb: number
  upSinceMs: number | null
}

// ==================== 核心服务类 ====================

/** 延迟滑动窗口大小 */
const LATENCY_WINDOW_SIZE = 200

export class LocalEmbeddingService {
  private state: EmbeddingState = 'idle'
  private pipeline: unknown = null
  private modelName: string = ''
  private cacheDir: string = ''
  /** 实际加载时使用的 cache_dir（可能是内置 assets 目录） */
  private effectiveCacheDir: string = ''
  /** 是否仅使用本地文件（从内置 assets 加载时为 true，禁止联网） */
  private localFilesOnly: boolean = false
  private dtype: string = 'q8'
  private dimension: number = 0
  private maxConcurrency: number = 1

  private loadPromise: Promise<void> | null = null
  private readyTimestamp: number | null = null
  /** 模型加载后的内存增量（heapUsed 差值），字节 */
  private modelMemoryBytes: number = 0

  // 并发推理控制
  private activeInferences: number = 0
  private inferenceQueue: Array<{
    resolve: () => void
    reject: (err: Error) => void
  }> = []

  // 统计
  private stats: EmbeddingStats = {
    totalCalls: 0,
    totalErrors: 0,
    totalCharsProcessed: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    minLatencyMs: Infinity,
    maxLatencyMs: 0,
    lastError: null,
    modelLoadTimeMs: 0
  }
  private latencyWindow: number[] = []
  private latencySum: number = 0

  /**
   * 初始化本地 embedding 模型。
   * 加载失败不抛出异常，仅记录错误（服务可继续用 mock embedding）。
   */
  async init(): Promise<void> {
    const config = getConfig()

    if (!config.embeddingEnabled) {
      log.info('Local embedding disabled by config (PRIZM_EMBEDDING_ENABLED=false)')
      return
    }

    this.modelName = config.embeddingModel
    this.cacheDir = config.embeddingCacheDir
    // reset() 可能已设置新 dtype，保留之；否则用 config
    if (!this.dtype) this.dtype = config.embeddingDtype
    this.maxConcurrency = config.embeddingMaxConcurrency

    // 确保用户缓存目录存在
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      log.info(`Created model cache dir: ${this.cacheDir}`)
    }

    // 解析模型加载源：用户缓存 → 内置 assets → 联网下载
    this.resolveModelSource()

    // 注册 embedding provider（立即注册，即使模型尚未加载完成）
    // 调用时如果模型还没 ready，会等待加载完成
    registerLocalEmbeddingProvider(async (text: string) => {
      return this.embed(text)
    })

    // 异步加载模型（不阻塞）
    try {
      await this.loadModel()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to load embedding model "${this.modelName}":`, msg)
      log.warn('Memories will be saved without vectors until embedding is available.')
      clearLocalEmbeddingProvider()
    }
  }

  /**
   * 解析模型加载源，按优先级：
   * 1. 用户缓存目录已有模型 → 直接使用（不联网）
   * 2. 内置 assets 有模型 → 从内置加载（local_files_only，不联网）
   * 3. 都没有 → 用用户缓存目录（首次加载会联网下载）
   */
  private resolveModelSource(): void {
    // 1. 用户缓存已有模型
    if (modelExistsIn(this.cacheDir, this.modelName)) {
      this.effectiveCacheDir = this.cacheDir
      this.localFilesOnly = false
      log.info(`Model found in cache: ${path.join(this.cacheDir, this.modelName)}`)
      return
    }

    // 2. 内置 assets 有模型
    const bundledDir = resolveBundledModelsDir()
    if (bundledDir && modelExistsIn(bundledDir, this.modelName)) {
      this.effectiveCacheDir = bundledDir
      this.localFilesOnly = true
      log.info(`Using bundled model: ${path.join(bundledDir, this.modelName)}`)
      return
    }

    // 3. 都没有，使用用户缓存目录（会触发联网下载）
    this.effectiveCacheDir = this.cacheDir
    this.localFilesOnly = false
    log.info(`Model not found locally, will attempt download to: ${this.cacheDir}`)
  }

  /**
   * 加载模型（带 Promise 锁防重入）
   */
  private async loadModel(): Promise<void> {
    if (this.state === 'ready') return
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this._doLoadModel()
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async _doLoadModel(): Promise<void> {
    this.state = 'loading'
    const startTime = Date.now()

    const source = this.localFilesOnly ? 'bundled' : 'cache/download'
    log.info(
      `Loading embedding model: ${this.modelName} ` +
        `(dtype=${this.dtype}, source=${source}, dir=${this.effectiveCacheDir})`
    )

    // 加载超时保护（120 秒）
    const LOAD_TIMEOUT_MS = 120_000

    // 记录加载前的堆内存
    if (global.gc) global.gc()
    const heapBefore = process.memoryUsage().heapUsed

    const loadTask = (async () => {
      // 动态导入 @huggingface/transformers（ESM 模块）
      const { pipeline } = await import('@huggingface/transformers')

      const extractor = await pipeline('feature-extraction', this.modelName, {
        dtype: this.dtype as 'q4' | 'q8' | 'fp16' | 'fp32',
        cache_dir: this.effectiveCacheDir,
        local_files_only: this.localFilesOnly
      })

      return extractor
    })()

    const timeoutTask = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`Model load timeout after ${LOAD_TIMEOUT_MS}ms`)),
        LOAD_TIMEOUT_MS
      )
    })

    try {
      const extractor = await Promise.race([loadTask, timeoutTask])
      this.pipeline = extractor

      // 执行预热推理以获取维度信息
      const warmupResult = await (extractor as CallableFunction)('warmup', {
        pooling: 'mean',
        normalize: true
      })
      this.dimension = warmupResult.dims?.[1] ?? warmupResult.data?.length ?? 384

      // 记录模型专属内存（加载前后 heapUsed 差值）
      const heapAfter = process.memoryUsage().heapUsed
      this.modelMemoryBytes = Math.max(0, heapAfter - heapBefore)

      this.stats.modelLoadTimeMs = Date.now() - startTime
      this.state = 'ready'
      this.readyTimestamp = Date.now()

      const modelMb = Math.round((this.modelMemoryBytes / 1024 / 1024) * 100) / 100
      log.info(
        `Embedding model ready: ${this.modelName} ` +
          `(dim=${this.dimension}, dtype=${this.dtype}, ` +
          `memory≈${modelMb}MB, load=${this.stats.modelLoadTimeMs}ms)`
      )
    } catch (err) {
      this.state = 'error'
      this.stats.lastError = {
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      }
      throw err
    }
  }

  /**
   * 对单条文本生成 embedding 向量。
   * 如果模型尚在加载中，等待加载完成后执行。
   */
  async embed(text: string): Promise<number[]> {
    // 如果模型还在加载，等待
    if (this.state === 'loading' && this.loadPromise) {
      await this.loadPromise
    }

    if (this.state !== 'ready' || !this.pipeline) {
      throw new Error(`Embedding model not ready (state: ${this.state})`)
    }

    // 并发队列控制
    await this.acquireSlot()

    const startTime = performance.now()
    try {
      const result = await (this.pipeline as CallableFunction)(text, {
        pooling: 'mean',
        normalize: true
      })

      const vector = Array.from(result.data as Float32Array)
      const latencyMs = performance.now() - startTime

      // 更新统计
      this.recordLatency(latencyMs)
      this.stats.totalCalls++
      this.stats.totalCharsProcessed += text.length

      return vector
    } catch (err) {
      this.stats.totalErrors++
      this.stats.lastError = {
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      }
      throw err
    } finally {
      this.releaseSlot()
    }
  }

  /**
   * 批量嵌入多条文本
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      results.push(await this.embed(text))
    }
    return results
  }

  /**
   * 释放模型资源
   */
  async dispose(): Promise<void> {
    if (this.state === 'disposing' || this.state === 'idle') return

    this.state = 'disposing'
    log.info('Disposing embedding model...')

    try {
      // 清除 EverMemService 注册
      clearLocalEmbeddingProvider()

      // 尝试释放 pipeline 资源
      if (
        this.pipeline &&
        typeof (this.pipeline as { dispose?: () => Promise<void> }).dispose === 'function'
      ) {
        await (this.pipeline as { dispose: () => Promise<void> }).dispose()
      }
    } catch (err) {
      log.warn('Error during embedding model dispose:', err)
    } finally {
      this.pipeline = null
      this.state = 'idle'
      this.readyTimestamp = null
      this.dimension = 0

      // 拒绝所有排队中的推理请求，防止 Promise 永远挂起
      const pending = this.inferenceQueue.splice(0)
      for (const p of pending) {
        p.reject(new Error('Embedding model disposed'))
      }
      this.activeInferences = 0

      log.info('Embedding model disposed')
    }
  }

  /**
   * 重置：释放旧模型 + 重新加载（热重载）
   */
  async reset(newDtype?: 'q4' | 'q8' | 'fp16' | 'fp32'): Promise<void> {
    log.info(`Resetting embedding model...${newDtype ? ` (new dtype=${newDtype})` : ''}`)
    await this.dispose()
    this.resetStats()
    if (newDtype) {
      this.dtype = newDtype
    }
    await this.init()
  }

  /**
   * 获取完整的状态和统计信息
   */
  getStatus(): EmbeddingStatus {
    const config = getConfig()
    const memUsage = process.memoryUsage()

    return {
      state: this.state,
      modelName: this.modelName || config.embeddingModel,
      dimension: this.dimension,
      enabled: config.embeddingEnabled,
      dtype: this.dtype || config.embeddingDtype,
      source: this.localFilesOnly
        ? 'bundled'
        : this.effectiveCacheDir === this.cacheDir
        ? 'cache'
        : 'unknown',
      stats: { ...this.stats },
      cacheDir: this.effectiveCacheDir || this.cacheDir || config.embeddingCacheDir,
      modelMemoryMb: Math.round((this.modelMemoryBytes / 1024 / 1024) * 100) / 100,
      processMemoryMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      upSinceMs: this.readyTimestamp
    }
  }

  /**
   * 获取当前状态枚举（轻量级，供 /health 使用）
   */
  getState(): EmbeddingState {
    return this.state
  }

  /**
   * 获取模型维度
   */
  getDimension(): number {
    return this.dimension
  }

  /**
   * 获取模型名称
   */
  getModelName(): string {
    return this.modelName || getConfig().embeddingModel
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 获取推理槽位（并发控制）
   */
  private acquireSlot(): Promise<void> {
    if (this.activeInferences < this.maxConcurrency) {
      this.activeInferences++
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      this.inferenceQueue.push({ resolve, reject })
    })
  }

  /**
   * 释放推理槽位
   */
  private releaseSlot(): void {
    this.activeInferences--
    if (this.inferenceQueue.length > 0) {
      const next = this.inferenceQueue.shift()!
      this.activeInferences++
      next.resolve()
    }
  }

  /**
   * 记录推理延迟并更新统计
   */
  private recordLatency(ms: number): void {
    // 滑动窗口
    this.latencyWindow.push(ms)
    this.latencySum += ms
    if (this.latencyWindow.length > LATENCY_WINDOW_SIZE) {
      this.latencySum -= this.latencyWindow.shift()!
    }

    // 更新统计
    this.stats.avgLatencyMs = Math.round((this.latencySum / this.latencyWindow.length) * 100) / 100

    // P95
    if (this.latencyWindow.length >= 5) {
      const sorted = [...this.latencyWindow].sort((a, b) => a - b)
      const idx = Math.floor(sorted.length * 0.95)
      this.stats.p95LatencyMs = Math.round(sorted[idx] * 100) / 100
    }

    // Min / Max
    if (ms < this.stats.minLatencyMs) this.stats.minLatencyMs = Math.round(ms * 100) / 100
    if (ms > this.stats.maxLatencyMs) this.stats.maxLatencyMs = Math.round(ms * 100) / 100
  }

  /**
   * 重置统计数据
   */
  private resetStats(): void {
    this.stats = {
      totalCalls: 0,
      totalErrors: 0,
      totalCharsProcessed: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: 0,
      lastError: null,
      modelLoadTimeMs: 0
    }
    this.latencyWindow = []
    this.latencySum = 0
  }
}

// ==================== 导出单例 ====================

/** 全局本地 embedding 服务实例 */
export const localEmbedding = new LocalEmbeddingService()
