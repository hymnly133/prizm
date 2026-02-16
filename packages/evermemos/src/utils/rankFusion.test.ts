import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion, reciprocalRankFusionMulti } from './rankFusion.js'

describe('reciprocalRankFusion', () => {
  it('should normalize scores to [0, 1] range', () => {
    const list1 = [
      { id: 'a', score: 1 },
      { id: 'b', score: 0.5 }
    ]
    const list2 = [
      { id: 'a', score: 0.9 },
      { id: 'c', score: 0.8 }
    ]

    const result = reciprocalRankFusion(list1, list2)

    for (const doc of result) {
      expect(doc.score).toBeGreaterThanOrEqual(0)
      expect(doc.score).toBeLessThanOrEqual(1)
    }
  })

  it('should give score ~1.0 to item ranked first in both lists', () => {
    const list1 = [{ id: 'a', score: 1 }]
    const list2 = [{ id: 'a', score: 1 }]

    const result = reciprocalRankFusion(list1, list2)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
    expect(result[0].score).toBeCloseTo(1.0, 5)
  })

  it('should give score ~0.5 to item ranked first in only one list', () => {
    const list1 = [{ id: 'a', score: 1 }]
    const list2 = [{ id: 'b', score: 1 }]

    const result = reciprocalRankFusion(list1, list2)
    expect(result).toHaveLength(2)
    // Both items appear in only one list at rank 0: score = (1/(k+1)) / (2/(k+1)) = 0.5
    expect(result[0].score).toBeCloseTo(0.5, 5)
    expect(result[1].score).toBeCloseTo(0.5, 5)
  })

  it('should rank items in both lists higher than items in one list', () => {
    const list1 = [
      { id: 'a', score: 1 },
      { id: 'b', score: 0.5 }
    ]
    const list2 = [{ id: 'a', score: 0.9 }]

    const result = reciprocalRankFusion(list1, list2)
    expect(result[0].id).toBe('a')
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  it('should handle empty lists', () => {
    const result = reciprocalRankFusion([], [])
    expect(result).toHaveLength(0)
  })
})

describe('reciprocalRankFusionMulti', () => {
  it('should normalize scores to [0, 1] range for multiple lists', () => {
    const lists = [
      [
        { id: 'a', score: 1 },
        { id: 'b', score: 0.5 }
      ],
      [{ id: 'a', score: 0.9 }],
      [
        { id: 'a', score: 0.8 },
        { id: 'c', score: 0.7 }
      ]
    ]

    const result = reciprocalRankFusionMulti(lists)

    for (const doc of result) {
      expect(doc.score).toBeGreaterThanOrEqual(0)
      expect(doc.score).toBeLessThanOrEqual(1)
    }
  })

  it('should give score ~1.0 to item ranked first in all lists', () => {
    const lists = [[{ id: 'a', score: 1 }], [{ id: 'a', score: 1 }], [{ id: 'a', score: 1 }]]

    const result = reciprocalRankFusionMulti(lists)
    expect(result).toHaveLength(1)
    expect(result[0].score).toBeCloseTo(1.0, 5)
  })

  it('should handle empty lists array', () => {
    const result = reciprocalRankFusionMulti([])
    expect(result).toHaveLength(0)
  })
})
