import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity,
  calibrateSimilarity,
  getSimilarityLevel,
  computeVectorStats,
  BENCHMARK_PAIRS
} from './embedding'
import type { SimilarityLevel } from './embedding'

describe('cosineSimilarity', () => {
  it('相同向量的相似度应为 1', () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5]
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 6)
  })

  it('正交向量的相似度应为 0', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6)
  })

  it('反向向量的相似度应为 -1', () => {
    const a = [1, 2, 3]
    const b = [-1, -2, -3]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6)
  })

  it('已知向量对的相似度计算正确', () => {
    const a = [1, 0, 0, 1]
    const b = [1, 1, 0, 0]
    // dot = 1, normA = sqrt(2), normB = sqrt(2), sim = 1/2 = 0.5
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 6)
  })

  it('空向量返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('零向量返回 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it('长度不匹配返回 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('归一化向量的余弦相似度等于点积', () => {
    const norm = (v: number[]) => {
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
      return v.map((x) => x / n)
    }
    const a = norm([3, 4])
    const b = norm([1, 0])
    const dotProduct = a[0] * b[0] + a[1] * b[1]
    expect(cosineSimilarity(a, b)).toBeCloseTo(dotProduct, 6)
  })
})

describe('calibrateSimilarity', () => {
  it('原始分数 1.0 校准后仍为 1.0', () => {
    expect(calibrateSimilarity(1.0)).toBeCloseTo(1.0, 6)
  })

  it('原始分数等于 baseline 时校准为 0', () => {
    expect(calibrateSimilarity(0.4, 0.4)).toBeCloseTo(0, 6)
  })

  it('原始分数低于 baseline 时 clamp 到 0', () => {
    expect(calibrateSimilarity(0.2, 0.4)).toBe(0)
    expect(calibrateSimilarity(-0.5, 0.4)).toBe(0)
  })

  it('原始分数超过 1.0 时 clamp 到 1', () => {
    expect(calibrateSimilarity(1.5, 0.4)).toBe(1)
  })

  it('默认 baseline=0.4 的线性映射正确', () => {
    // 0.7 → (0.7 - 0.4) / 0.6 = 0.5
    expect(calibrateSimilarity(0.7)).toBeCloseTo(0.5, 6)
    // 0.55 → (0.55 - 0.4) / 0.6 = 0.25
    expect(calibrateSimilarity(0.55)).toBeCloseTo(0.25, 6)
  })

  it('自定义 baseline 正确', () => {
    // baseline=0.5, 0.75 → (0.75 - 0.5) / 0.5 = 0.5
    expect(calibrateSimilarity(0.75, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('baseline=0 时等于原始分数（无校准）', () => {
    expect(calibrateSimilarity(0.6, 0)).toBeCloseTo(0.6, 6)
  })

  it('实测用例：不同主题中文对 raw=0.7392 校准后应低于 0.60', () => {
    const calibrated = calibrateSimilarity(0.7392)
    expect(calibrated).toBeLessThan(0.6)
  })

  it('实测用例：跨语言对 raw=0.5403 校准后为正值但低于统一阈值 0.60', () => {
    const calibrated = calibrateSimilarity(0.5403)
    expect(calibrated).toBeGreaterThan(0)
    expect(calibrated).toBeLessThan(0.6)
  })
})

describe('getSimilarityLevel（基于校准分数）', () => {
  const cases: Array<{ score: number; expectedLevel: SimilarityLevel; expectedLabel: string }> = [
    { score: 0.9, expectedLevel: 'very_high', expectedLabel: '极高' },
    { score: 0.75, expectedLevel: 'very_high', expectedLabel: '极高' },
    { score: 0.74, expectedLevel: 'high', expectedLabel: '高' },
    { score: 0.5, expectedLevel: 'high', expectedLabel: '高' },
    { score: 0.49, expectedLevel: 'medium', expectedLabel: '中等' },
    { score: 0.25, expectedLevel: 'medium', expectedLabel: '中等' },
    { score: 0.24, expectedLevel: 'low', expectedLabel: '低' },
    { score: 0.1, expectedLevel: 'low', expectedLabel: '低' },
    { score: 0.09, expectedLevel: 'very_low', expectedLabel: '极低' },
    { score: 0.0, expectedLevel: 'very_low', expectedLabel: '极低' }
  ]

  for (const { score, expectedLevel, expectedLabel } of cases) {
    it(`calibrated=${score} → level=${expectedLevel}, label=${expectedLabel}`, () => {
      const result = getSimilarityLevel(score)
      expect(result.level).toBe(expectedLevel)
      expect(result.label).toBe(expectedLabel)
    })
  }
})

describe('computeVectorStats', () => {
  it('计算简单向量的统计信息', () => {
    const vec = [1, 2, 3, 4, 5]
    const stats = computeVectorStats(vec)

    expect(stats.mean).toBeCloseTo(3, 3)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(5)
    expect(stats.norm).toBeCloseTo(Math.sqrt(1 + 4 + 9 + 16 + 25), 3)
    expect(stats.std).toBeGreaterThan(0)
  })

  it('所有元素相同时 std 为 0', () => {
    const vec = [0.5, 0.5, 0.5, 0.5]
    const stats = computeVectorStats(vec)

    expect(stats.mean).toBeCloseTo(0.5, 3)
    expect(stats.std).toBeCloseTo(0, 3)
    expect(stats.min).toBeCloseTo(0.5, 3)
    expect(stats.max).toBeCloseTo(0.5, 3)
  })

  it('空向量返回全零', () => {
    const stats = computeVectorStats([])
    expect(stats.mean).toBe(0)
    expect(stats.std).toBe(0)
    expect(stats.min).toBe(0)
    expect(stats.max).toBe(0)
    expect(stats.norm).toBe(0)
  })

  it('归一化向量的 norm 接近 1', () => {
    const raw = [0.3, -0.2, 0.5, 0.1, -0.4]
    const n = Math.sqrt(raw.reduce((s, v) => s + v * v, 0))
    const normed = raw.map((v) => v / n)
    const stats = computeVectorStats(normed)

    expect(stats.norm).toBeCloseTo(1.0, 3)
  })

  it('包含负值的向量统计正确', () => {
    const vec = [-3, -1, 0, 1, 3]
    const stats = computeVectorStats(vec)

    expect(stats.mean).toBeCloseTo(0, 3)
    expect(stats.min).toBe(-3)
    expect(stats.max).toBe(3)
  })
})

describe('BENCHMARK_PAIRS', () => {
  it('应包含足够数量的测试对', () => {
    expect(BENCHMARK_PAIRS.length).toBeGreaterThanOrEqual(8)
  })

  it('应同时包含 high、low、cross_lang 和 antonym 期望', () => {
    const highCount = BENCHMARK_PAIRS.filter((p) => p.expected === 'high').length
    const lowCount = BENCHMARK_PAIRS.filter((p) => p.expected === 'low').length
    const crossLangCount = BENCHMARK_PAIRS.filter((p) => p.expected === 'cross_lang').length
    const antonymCount = BENCHMARK_PAIRS.filter((p) => p.expected === 'antonym').length
    expect(highCount).toBeGreaterThanOrEqual(3)
    expect(lowCount).toBeGreaterThanOrEqual(3)
    expect(crossLangCount).toBeGreaterThanOrEqual(1)
    expect(antonymCount).toBeGreaterThanOrEqual(1)
  })

  it('每对都有完整字段', () => {
    for (const pair of BENCHMARK_PAIRS) {
      expect(pair.a).toBeTruthy()
      expect(pair.b).toBeTruthy()
      expect(['high', 'low', 'cross_lang', 'antonym']).toContain(pair.expected)
      expect(pair.category).toBeTruthy()
    }
  })

  it('跨语言对应归类为跨语言', () => {
    const crossLangPairs = BENCHMARK_PAIRS.filter((p) => p.expected === 'cross_lang')
    for (const pair of crossLangPairs) {
      expect(pair.category).toBe('跨语言')
    }
  })

  it('反义词对应归类为语义对立', () => {
    const antonymPairs = BENCHMARK_PAIRS.filter((p) => p.expected === 'antonym')
    for (const pair of antonymPairs) {
      expect(pair.category).toBe('语义对立')
    }
  })
})
