/**
 * Embedding 模型管理与调试路由
 *
 * 提供本地 embedding 模型的状态查询、测试调试、基准评测和热重载接口。
 * 所有端点需要认证（通过 authMiddleware 保护）。
 */

import type { Router, Request, Response } from 'express'
import { createLogger } from '../logger'
import { localEmbedding } from '../llm/localEmbedding'
import { runVectorBackfill } from '../llm/EverMemService'

const log = createLogger('EmbeddingRoutes')

// ==================== 向量工具函数（导出供测试使用） ====================

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** 相似度等级 */
export type SimilarityLevel = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'

/** 相似度等级映射（中文标签） */
const SIMILARITY_LEVEL_LABELS: Record<SimilarityLevel, string> = {
  very_high: '极高',
  high: '高',
  medium: '中等',
  low: '低',
  very_low: '极低'
}

/**
 * 校准余弦相似度分数。
 *
 * 小型嵌入模型（如 bge-micro-v2）的余弦相似度基线偏高，无关文本也可能
 * 达到 0.4–0.5。校准将原始分数线性映射到更具区分度的范围：
 *
 *   calibrated = clamp((raw - baseline) / (1 - baseline), 0, 1)
 *
 * baseline 默认 0.4，基于 bge-micro-v2 的实测特征。
 */
export function calibrateSimilarity(raw: number, baseline = 0.4): number {
  const range = 1 - baseline
  if (range <= 0) return raw
  return Math.max(0, Math.min(1, (raw - baseline) / range))
}

/**
 * 根据 **校准后** 的相似度分数返回等级标签。
 *
 * 阈值设计（对应 baseline=0.4 时的原始分数）：
 * - calibrated >= 0.75 → very_high（raw >= 0.85）
 * - calibrated >= 0.50 → high     （raw >= 0.70）
 * - calibrated >= 0.25 → medium   （raw >= 0.55）
 * - calibrated >= 0.10 → low      （raw >= 0.46）
 * - calibrated <  0.10 → very_low （raw <  0.46）
 */
export function getSimilarityLevel(calibratedScore: number): {
  level: SimilarityLevel
  label: string
} {
  if (calibratedScore >= 0.75)
    return { level: 'very_high', label: SIMILARITY_LEVEL_LABELS.very_high }
  if (calibratedScore >= 0.5) return { level: 'high', label: SIMILARITY_LEVEL_LABELS.high }
  if (calibratedScore >= 0.25) return { level: 'medium', label: SIMILARITY_LEVEL_LABELS.medium }
  if (calibratedScore >= 0.1) return { level: 'low', label: SIMILARITY_LEVEL_LABELS.low }
  return { level: 'very_low', label: SIMILARITY_LEVEL_LABELS.very_low }
}

/** 向量统计信息 */
export interface VectorStats {
  mean: number
  std: number
  min: number
  max: number
  norm: number
}

/**
 * 计算向量的统计信息
 */
export function computeVectorStats(vector: number[]): VectorStats {
  const n = vector.length
  if (n === 0) return { mean: 0, std: 0, min: 0, max: 0, norm: 0 }

  let sum = 0
  let sqSum = 0
  let min = Infinity
  let max = -Infinity
  let normSq = 0

  for (let i = 0; i < n; i++) {
    const v = vector[i]
    sum += v
    sqSum += v * v
    normSq += v * v
    if (v < min) min = v
    if (v > max) max = v
  }

  const mean = sum / n
  const variance = sqSum / n - mean * mean
  const std = Math.sqrt(Math.max(0, variance))

  return {
    mean: Math.round(mean * 10000) / 10000,
    std: Math.round(std * 10000) / 10000,
    min: Math.round(min * 10000) / 10000,
    max: Math.round(max * 10000) / 10000,
    norm: Math.round(Math.sqrt(normSq) * 10000) / 10000
  }
}

// ==================== 基准测试语义对 ====================

/**
 * 基准测试期望类型：
 * - high: 应相似（同语言同义改写）
 * - low: 应不同（不同主题）
 * - cross_lang: 跨语言相似（小模型已知限制，不参与评分）
 * - antonym: 反义/语义对立（嵌入模型已知限制，不参与评分）
 */
export type BenchmarkExpected = 'high' | 'low' | 'cross_lang' | 'antonym'

export interface BenchmarkPair {
  a: string
  b: string
  expected: BenchmarkExpected
  category: string
}

export const BENCHMARK_PAIRS: BenchmarkPair[] = [
  // 高相似度 — 同义改写
  { a: '今天天气很好', b: '今天的天气非常棒', expected: 'high', category: '同义改写' },
  { a: '我喜欢读书', b: '阅读是我的爱好', expected: 'high', category: '同义改写' },
  { a: 'I love programming', b: 'Coding is my passion', expected: 'high', category: '同义改写' },
  // 跨语言 — 小模型跨语言能力不足，不参与通过率计算，仅供参考
  { a: 'How to learn programming', b: '如何学习编程', expected: 'cross_lang', category: '跨语言' },
  { a: 'The weather is nice today', b: '今天天气不错', expected: 'cross_lang', category: '跨语言' },
  // 低相似度 — 完全不同主题
  { a: '今天天气很好', b: '量子力学的基本原理', expected: 'low', category: '不同主题' },
  { a: '我喜欢吃苹果', b: 'The stock market crashed today', expected: 'low', category: '不同主题' },
  { a: '如何做红烧肉', b: 'Machine learning algorithms', expected: 'low', category: '不同主题' },
  // 反义/对立 — 嵌入模型已知限制：共享大量词汇/结构导致分数虚高
  // 标记为 antonym，不计入通过率，仅供参考
  { a: '这个产品非常好用', b: '这个产品太难用了', expected: 'antonym', category: '语义对立' },
  { a: 'I am very happy', b: 'I am extremely sad', expected: 'antonym', category: '语义对立' }
]

const round4 = (v: number) => Math.round(v * 10000) / 10000

export function createEmbeddingRoutes(router: Router): void {
  /**
   * GET /embedding/status
   * 返回 embedding 模型的完整状态和统计信息
   */
  router.get('/embedding/status', (_req: Request, res: Response) => {
    try {
      const status = localEmbedding.getStatus()
      res.json(status)
    } catch (err) {
      log.error('Failed to get embedding status:', err)
      res.status(500).json({ error: 'Failed to get embedding status' })
    }
  })

  /**
   * POST /embedding/test
   * 测试文本嵌入，可选比较两段文本的相似度
   *
   * Body: { text: string, compareWith?: string }
   * Response: 丰富的测试结果（含向量统计、相似度等级、比较向量预览等）
   */
  router.post('/embedding/test', async (req: Request, res: Response) => {
    try {
      const { text, compareWith } = req.body as { text?: string; compareWith?: string }

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Missing required field: text (string)' })
        return
      }

      if (text.length > 10_000) {
        res.status(400).json({ error: 'Text too long (max 10000 characters)' })
        return
      }

      const state = localEmbedding.getState()
      if (state !== 'ready') {
        res.status(503).json({
          error: `Embedding model not ready (state: ${state})`,
          state
        })
        return
      }

      const startTime = performance.now()
      const vector = await localEmbedding.embed(text)
      const latencyMs = Math.round((performance.now() - startTime) * 100) / 100

      const result: Record<string, unknown> = {
        text,
        textLength: text.length,
        dimension: vector.length,
        latencyMs,
        vectorPreview: vector.slice(0, 10).map(round4),
        vectorStats: computeVectorStats(vector)
      }

      // 如果文本较短（<= 100 字符），返回完整向量
      if (text.length <= 100) {
        result.vectorFull = vector.map(round4)
      }

      // 比较相似度
      if (compareWith && typeof compareWith === 'string') {
        const cmpStart = performance.now()
        const cmpVector = await localEmbedding.embed(compareWith)
        const cmpLatency = Math.round((performance.now() - cmpStart) * 100) / 100
        const rawSim = cosineSimilarity(vector, cmpVector)
        const calibrated = calibrateSimilarity(rawSim)
        const simLevel = getSimilarityLevel(calibrated)

        result.compareWith = compareWith
        result.compareTextLength = compareWith.length
        result.compareLatencyMs = cmpLatency
        result.compareVectorPreview = cmpVector.slice(0, 10).map(round4)
        result.compareVectorStats = computeVectorStats(cmpVector)
        result.similarity = round4(rawSim)
        result.calibratedSimilarity = round4(calibrated)
        result.similarityLevel = simLevel.level
        result.similarityLabel = simLevel.label
      }

      res.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Embedding test failed:', msg)
      res.status(500).json({ error: `Embedding test failed: ${msg}` })
    }
  })

  /**
   * POST /embedding/benchmark
   * 运行内置的基准语义对测试，评估模型质量
   *
   * Response: { pairs: BenchmarkPairResult[], summary: BenchmarkSummary }
   */
  router.post('/embedding/benchmark', async (_req: Request, res: Response) => {
    try {
      const state = localEmbedding.getState()
      if (state !== 'ready') {
        res.status(503).json({
          error: `Embedding model not ready (state: ${state})`,
          state
        })
        return
      }

      const totalStart = performance.now()
      const pairResults: Array<{
        textA: string
        textB: string
        category: string
        expected: BenchmarkExpected
        similarity: number
        calibratedSimilarity: number
        similarityLevel: SimilarityLevel
        similarityLabel: string
        pass: boolean | null
      }> = []

      for (const pair of BENCHMARK_PAIRS) {
        const vecA = await localEmbedding.embed(pair.a)
        const vecB = await localEmbedding.embed(pair.b)
        const rawSim = cosineSimilarity(vecA, vecB)
        const calibrated = calibrateSimilarity(rawSim)
        const simLevel = getSimilarityLevel(calibrated)

        // 判断是否通过（统一阈值 0.60）：
        // - expected high：calibrated >= 0.60（同义改写应在此阈值之上）
        // - expected low：calibrated < 0.60（不同主题应在此阈值之下）
        // - expected cross_lang：null（小模型跨语言能力不足，不参与评分）
        // - expected antonym：null（已知模型限制，不参与评分）
        let pass: boolean | null = null
        if (pair.expected === 'high') {
          pass = calibrated >= 0.6
        } else if (pair.expected === 'low') {
          pass = calibrated < 0.6
        }
        // cross_lang / antonym 保持 null

        pairResults.push({
          textA: pair.a,
          textB: pair.b,
          category: pair.category,
          expected: pair.expected,
          similarity: round4(rawSim),
          calibratedSimilarity: round4(calibrated),
          similarityLevel: simLevel.level,
          similarityLabel: simLevel.label,
          pass
        })
      }

      const totalLatencyMs = Math.round((performance.now() - totalStart) * 100) / 100

      // 汇总统计（antonym + cross_lang 不计入通过率）
      const scorablePairs = pairResults.filter((p) => p.pass !== null)
      const highPairs = pairResults.filter((p) => p.expected === 'high')
      const lowPairs = pairResults.filter((p) => p.expected === 'low')
      const crossLangPairs = pairResults.filter((p) => p.expected === 'cross_lang')
      const antonymPairs = pairResults.filter((p) => p.expected === 'antonym')
      const passCount = scorablePairs.filter((p) => p.pass === true).length

      const avgCalibrated = (arr: typeof pairResults) =>
        arr.length === 0
          ? 0
          : round4(arr.reduce((s, p) => s + p.calibratedSimilarity, 0) / arr.length)

      const summary = {
        totalPairs: pairResults.length,
        scorablePairs: scorablePairs.length,
        crossLangPairs: crossLangPairs.length,
        antonymPairs: antonymPairs.length,
        passCount,
        failCount: scorablePairs.length - passCount,
        passRate: scorablePairs.length > 0 ? round4(passCount / scorablePairs.length) : 0,
        /** 统一判定阈值（calibrated） */
        threshold: 0.6,
        avgHighCalibratedSimilarity: avgCalibrated(highPairs),
        avgLowCalibratedSimilarity: avgCalibrated(lowPairs),
        avgCrossLangCalibratedSimilarity: avgCalibrated(crossLangPairs),
        /** 区分度 = 高相似对校准均值 - 低相似对校准均值，越大越好 */
        discrimination: round4(avgCalibrated(highPairs) - avgCalibrated(lowPairs)),
        totalLatencyMs,
        modelName: localEmbedding.getModelName(),
        dimension: localEmbedding.getDimension()
      }

      res.json({ pairs: pairResults, summary })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Embedding benchmark failed:', msg)
      res.status(500).json({ error: `Embedding benchmark failed: ${msg}` })
    }
  })

  /**
   * POST /embedding/reload
   * 释放旧模型并重新加载（热重载）
   *
   * Body: { dtype?: 'q4' | 'q8' | 'fp16' | 'fp32' }
   */
  router.post('/embedding/reload', async (req: Request, res: Response) => {
    try {
      const { dtype } = req.body as { dtype?: string }
      const validDtypes = ['q4', 'q8', 'fp16', 'fp32']
      if (dtype && !validDtypes.includes(dtype)) {
        res.status(400).json({
          error: `Invalid dtype: ${dtype}. Valid: ${validDtypes.join(', ')}`
        })
        return
      }

      log.info(`Embedding model reload requested${dtype ? ` (dtype=${dtype})` : ''}`)
      const prevState = localEmbedding.getState()

      await localEmbedding.reset(dtype as 'q4' | 'q8' | 'fp16' | 'fp32' | undefined)

      const newStatus = localEmbedding.getStatus()
      res.json({
        message: 'Embedding model reloaded',
        previousState: prevState,
        currentState: newStatus.state,
        modelName: newStatus.modelName,
        dimension: newStatus.dimension,
        dtype: newStatus.dtype,
        loadTimeMs: newStatus.stats.modelLoadTimeMs
      })

      // 模型就绪后异步触发向量补全（不阻塞响应）
      if (newStatus.state === 'ready') {
        setTimeout(() => void runVectorBackfill(), 1_000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Embedding reload failed:', msg)
      res.status(500).json({ error: `Embedding reload failed: ${msg}` })
    }
  })
}
