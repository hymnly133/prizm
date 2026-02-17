/**
 * Embedding 模型管理与调试路由
 *
 * 提供本地 embedding 模型的状态查询、测试调试和热重载接口。
 * 所有端点需要认证（通过 authMiddleware 保护）。
 */

import type { Router, Request, Response } from 'express'
import { createLogger } from '../logger'
import { localEmbedding } from '../llm/localEmbedding'
import { runVectorBackfill } from '../llm/EverMemService'

const log = createLogger('EmbeddingRoutes')

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
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
   * Response: { vector: number[], dimension: number, latencyMs: number, similarity?: number }
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

      const result: {
        dimension: number
        latencyMs: number
        vectorPreview: number[]
        vectorFull?: number[]
        similarity?: number
        compareLatencyMs?: number
      } = {
        dimension: vector.length,
        latencyMs,
        vectorPreview: vector.slice(0, 10).map((v) => Math.round(v * 10000) / 10000)
      }

      // 如果文本较短（<= 100 字符），返回完整向量
      if (text.length <= 100) {
        result.vectorFull = vector.map((v) => Math.round(v * 10000) / 10000)
      }

      // 比较相似度
      if (compareWith && typeof compareWith === 'string') {
        const cmpStart = performance.now()
        const cmpVector = await localEmbedding.embed(compareWith)
        result.compareLatencyMs = Math.round((performance.now() - cmpStart) * 100) / 100
        result.similarity = Math.round(cosineSimilarity(vector, cmpVector) * 10000) / 10000
      }

      res.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Embedding test failed:', msg)
      res.status(500).json({ error: `Embedding test failed: ${msg}` })
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
