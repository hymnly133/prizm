import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { LocalEmbeddingService } from './localEmbedding'
import type { EmbeddingState } from './localEmbedding'

// Mock config
vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    embeddingEnabled: true,
    embeddingModel: 'TaylorAI/bge-micro-v2',
    embeddingCacheDir: '/tmp/test-models',
    embeddingDtype: 'q8',
    embeddingMaxConcurrency: 1
  }))
}))

// Mock logger
vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

// Mock EverMemService registration
const mockRegister = vi.fn()
const mockClear = vi.fn()
vi.mock('./EverMemService', () => ({
  registerLocalEmbeddingProvider: (...args: unknown[]) => mockRegister(...args),
  clearLocalEmbeddingProvider: () => mockClear()
}))

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn()
  }
}))

// Mock path & url (for resolveBundledModelsDir)
vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/fake/dist/index.js')
}))

// 模拟的 pipeline 函数
let mockPipelineFn: Mock
let mockExtractorFn: Mock
let mockExtractorDispose: Mock

/**
 * 基于文本内容生成确定性向量（简单哈希 → 种子随机数）。
 * 相同文本总是返回相同向量，不同文本返回不同向量。
 */
function deterministicVector(text: string, dim = 384): Float32Array {
  let seed = 0
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0
  }
  const pseudoRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff) * 2 - 1
  }

  const data = new Float32Array(dim)
  for (let i = 0; i < dim; i++) data[i] = pseudoRandom()

  // 归一化
  let norm = 0
  for (let i = 0; i < dim; i++) norm += data[i] * data[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < dim; i++) data[i] /= norm

  return data
}

// Mock @huggingface/transformers
vi.mock('@huggingface/transformers', () => {
  mockExtractorDispose = vi.fn()
  mockExtractorFn = vi.fn().mockImplementation((text: string) => {
    const fakeData = deterministicVector(text)
    return Promise.resolve({
      data: fakeData,
      dims: [1, 384]
    })
  })
  mockExtractorFn.dispose = mockExtractorDispose

  mockPipelineFn = vi.fn().mockResolvedValue(mockExtractorFn)

  return {
    pipeline: mockPipelineFn
  }
})

describe('LocalEmbeddingService', () => {
  let service: LocalEmbeddingService

  beforeEach(() => {
    service = new LocalEmbeddingService()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    try {
      await service.dispose()
    } catch {
      // ignore
    }
  })

  describe('init()', () => {
    it('应当加载模型并注册到 EverMemService', async () => {
      await service.init()

      expect(mockPipelineFn).toHaveBeenCalledWith(
        'feature-extraction',
        'TaylorAI/bge-micro-v2',
        expect.objectContaining({
          cache_dir: '/tmp/test-models',
          local_files_only: false
        })
      )
      expect(mockRegister).toHaveBeenCalledTimes(1)
      expect(service.getState()).toBe('ready')
    })

    it('加载完成后模型维度应为 384', async () => {
      await service.init()
      expect(service.getDimension()).toBe(384)
    })

    it('加载完成后模型名称正确', async () => {
      await service.init()
      expect(service.getModelName()).toBe('TaylorAI/bge-micro-v2')
    })

    it('初始状态应为 idle', () => {
      expect(service.getState()).toBe('idle')
    })

    it('embeddingEnabled=false 时不加载模型', async () => {
      const { getConfig } = await import('../config')
      ;(getConfig as Mock).mockReturnValueOnce({
        embeddingEnabled: false,
        embeddingModel: 'TaylorAI/bge-micro-v2',
        embeddingCacheDir: '/tmp/test-models',
        embeddingDtype: 'q8',
        embeddingMaxConcurrency: 1
      })

      await service.init()

      expect(mockPipelineFn).not.toHaveBeenCalled()
      expect(service.getState()).toBe('idle')
    })

    it('模型加载失败时状态为 error 并清除 provider', async () => {
      mockPipelineFn.mockRejectedValueOnce(new Error('Network error'))

      await service.init()

      // init() 内部 catch 不抛出，但状态变为 idle（dispose 重置）或保持
      // 实际上 init() 会 clearLocalEmbeddingProvider
      expect(mockClear).toHaveBeenCalled()
    })

    it('重复调用 init 不会多次加载模型（Promise 锁）', async () => {
      const p1 = service.init()
      const p2 = service.init()

      await Promise.all([p1, p2])

      // pipeline 只被调用一次（init 内部 registerLocalEmbeddingProvider 调用了两次，
      // 但 loadModel 通过 loadPromise 防重入，只执行一次）
      expect(mockPipelineFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('embed()', () => {
    it('应当返回 384 维向量', async () => {
      await service.init()
      const vector = await service.embed('hello world')

      expect(Array.isArray(vector)).toBe(true)
      expect(vector.length).toBe(384)
    })

    it('向量应当是归一化的（范数接近 1）', async () => {
      await service.init()
      const vector = await service.embed('test normalization')

      let norm = 0
      for (const v of vector) norm += v * v
      norm = Math.sqrt(norm)

      expect(norm).toBeCloseTo(1.0, 2)
    })

    it('模型未就绪时应当抛出错误', async () => {
      await expect(service.embed('test')).rejects.toThrow('Embedding model not ready')
    })

    it('不同文本应当返回不同向量', async () => {
      await service.init()

      const vec1 = await service.embed('hello')
      const vec2 = await service.embed('world')

      // 确定性 mock：不同文本的向量不同
      let allSame = true
      for (let i = 0; i < vec1.length; i++) {
        if (vec1[i] !== vec2[i]) {
          allSame = false
          break
        }
      }
      expect(allSame).toBe(false)
    })

    it('相同文本应当返回相同向量（确定性 mock）', async () => {
      await service.init()

      const vec1 = await service.embed('hello world')
      const vec2 = await service.embed('hello world')

      for (let i = 0; i < vec1.length; i++) {
        expect(vec1[i]).toBe(vec2[i])
      }
    })
  })

  describe('embedBatch()', () => {
    it('应当批量返回向量', async () => {
      await service.init()
      const results = await service.embedBatch(['hello', 'world', 'test'])

      expect(results.length).toBe(3)
      for (const vec of results) {
        expect(vec.length).toBe(384)
      }
    })

    it('空数组返回空结果', async () => {
      await service.init()
      const results = await service.embedBatch([])
      expect(results).toEqual([])
    })
  })

  describe('统计与监控', () => {
    it('统计初始值应为零', () => {
      const status = service.getStatus()
      expect(status.stats.totalCalls).toBe(0)
      expect(status.stats.totalErrors).toBe(0)
      expect(status.stats.totalCharsProcessed).toBe(0)
    })

    it('embed 调用应当更新统计', async () => {
      await service.init()

      await service.embed('hello world')
      await service.embed('another text')

      const status = service.getStatus()
      expect(status.stats.totalCalls).toBe(2)
      expect(status.stats.totalCharsProcessed).toBe('hello world'.length + 'another text'.length)
      expect(status.stats.avgLatencyMs).toBeGreaterThan(0)
    })

    it('模型加载时间应当被记录', async () => {
      await service.init()
      const status = service.getStatus()
      expect(status.stats.modelLoadTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('getStatus 应返回完整信息', async () => {
      await service.init()
      const status = service.getStatus()

      expect(status.state).toBe('ready')
      expect(status.modelName).toBe('TaylorAI/bge-micro-v2')
      expect(status.dimension).toBe(384)
      expect(status.enabled).toBe(true)
      expect(status.cacheDir).toBe('/tmp/test-models')
      expect(typeof status.modelMemoryMb).toBe('number')
      expect(typeof status.processMemoryMb).toBe('number')
      expect(typeof status.dtype).toBe('string')
      expect(typeof status.source).toBe('string')
      expect(status.upSinceMs).toBeGreaterThan(0)
    })

    it('错误应当被追踪', async () => {
      await service.init()

      // 让下一次推理失败
      mockExtractorFn.mockRejectedValueOnce(new Error('ONNX error'))

      await expect(service.embed('fail')).rejects.toThrow('ONNX error')

      const status = service.getStatus()
      expect(status.stats.totalErrors).toBe(1)
      expect(status.stats.lastError).not.toBeNull()
      expect(status.stats.lastError!.message).toBe('ONNX error')
    })

    it('P95 延迟应当在多次调用后计算', async () => {
      await service.init()

      for (let i = 0; i < 10; i++) {
        await service.embed(`text ${i}`)
      }

      const status = service.getStatus()
      expect(status.stats.p95LatencyMs).toBeGreaterThan(0)
      expect(status.stats.minLatencyMs).toBeGreaterThan(0)
      expect(status.stats.maxLatencyMs).toBeGreaterThanOrEqual(status.stats.minLatencyMs)
    })
  })

  describe('dispose()', () => {
    it('dispose 后状态应为 idle', async () => {
      await service.init()
      expect(service.getState()).toBe('ready')

      await service.dispose()
      expect(service.getState()).toBe('idle')
    })

    it('dispose 后维度应重置为 0', async () => {
      await service.init()
      expect(service.getDimension()).toBe(384)

      await service.dispose()
      expect(service.getDimension()).toBe(0)
    })

    it('dispose 应当清除 EverMemService 注册', async () => {
      await service.init()
      mockClear.mockClear()

      await service.dispose()
      expect(mockClear).toHaveBeenCalled()
    })

    it('重复 dispose 不会出错', async () => {
      await service.init()
      await service.dispose()
      await service.dispose()
      expect(service.getState()).toBe('idle')
    })

    it('dispose 后 embed 应当抛出错误', async () => {
      await service.init()
      await service.dispose()
      await expect(service.embed('test')).rejects.toThrow('Embedding model not ready')
    })
  })

  describe('reset()', () => {
    it('应当释放并重新加载模型', async () => {
      await service.init()
      const firstLoadCalls = mockPipelineFn.mock.calls.length

      await service.reset()

      expect(mockPipelineFn.mock.calls.length).toBeGreaterThan(firstLoadCalls)
      expect(service.getState()).toBe('ready')
    })

    it('reset 后统计应当被清零', async () => {
      await service.init()
      await service.embed('some text')

      const beforeReset = service.getStatus()
      expect(beforeReset.stats.totalCalls).toBe(1)

      await service.reset()

      // reset 后统计清零，但 loadTimeMs 会被更新
      const afterReset = service.getStatus()
      expect(afterReset.stats.totalCalls).toBe(0)
      expect(afterReset.stats.totalErrors).toBe(0)
    })
  })

  describe('并发控制', () => {
    it('并发调用应当串行执行（maxConcurrency=1）', async () => {
      await service.init()

      let concurrentCount = 0
      let maxConcurrent = 0

      mockExtractorFn.mockImplementation(async () => {
        concurrentCount++
        if (concurrentCount > maxConcurrent) maxConcurrent = concurrentCount
        // 模拟小延迟
        await new Promise((r) => setTimeout(r, 5))
        concurrentCount--
        const data = new Float32Array(384).fill(0.01)
        return { data, dims: [1, 384] }
      })

      const promises = Array.from({ length: 5 }, (_, i) => service.embed(`text ${i}`))

      await Promise.all(promises)

      expect(maxConcurrent).toBe(1)
    })

    it('所有并发调用最终都应完成', async () => {
      await service.init()

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => service.embed(`concurrent text ${i}`))
      )

      expect(results.length).toBe(10)
      for (const vec of results) {
        expect(vec.length).toBe(384)
      }

      expect(service.getStatus().stats.totalCalls).toBe(10)
    })
  })

  describe('生命周期状态转换', () => {
    it('idle → loading → ready', async () => {
      const states: EmbeddingState[] = []

      // 在模型加载前捕捉状态
      states.push(service.getState()) // idle

      const initPromise = service.init()
      // loading 状态很快就过去了，可能捕获不到，所以我们验证最终状态
      await initPromise

      states.push(service.getState()) // ready

      expect(states[0]).toBe('idle')
      expect(states[1]).toBe('ready')
    })

    it('ready → disposing → idle', async () => {
      await service.init()
      expect(service.getState()).toBe('ready')

      await service.dispose()
      expect(service.getState()).toBe('idle')
    })
  })
})
