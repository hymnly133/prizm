/**
 * RelationStore 单元测试
 *
 * 使用临时目录 SQLite 验证 CRUD / 查询 / 统计 / 边界
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tempDir: string

vi.mock('../../core/PathProviderCore', () => ({
  getDataDir: () => tempDir
}))

import {
  addRelation,
  addRelations,
  getRelatedMemories,
  deleteRelationsForMemory,
  getRelationStats,
  closeRelationStore
} from './relationStore'

describe('RelationStore', () => {
  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `prizm-relstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    closeRelationStore()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ─── addRelation ───

  describe('addRelation', () => {
    it('should add a single relation and return it', () => {
      const rel = addRelation('mem-a', 'mem-b', 'references', 0.9)
      expect(rel).toMatchObject({
        sourceId: 'mem-a',
        targetId: 'mem-b',
        relationType: 'references',
        confidence: 0.9
      })
      expect(rel.id).toBeTruthy()
      expect(rel.createdAt).toBeTruthy()
    })

    it('should default confidence to 1.0', () => {
      const rel = addRelation('mem-a', 'mem-b', 'related_to')
      expect(rel.confidence).toBe(1.0)
    })

    it('should store different relation types', () => {
      addRelation('m1', 'm2', 'references')
      addRelation('m1', 'm3', 'contradicts')
      addRelation('m1', 'm4', 'derived_from')
      addRelation('m1', 'm5', 'extends')
      addRelation('m1', 'm6', 'related_to')

      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(5)
      expect(Object.keys(stats.byType)).toHaveLength(5)
    })

    it('should generate unique IDs for each relation', () => {
      const r1 = addRelation('a', 'b', 'references')
      const r2 = addRelation('a', 'c', 'references')
      expect(r1.id).not.toBe(r2.id)
    })

    it('should set createdAt as ISO string', () => {
      const rel = addRelation('x', 'y', 'related_to')
      expect(() => new Date(rel.createdAt)).not.toThrow()
    })
  })

  // ─── addRelations (batch) ───

  describe('addRelations', () => {
    it('should batch insert multiple relations', () => {
      const count = addRelations([
        { sourceId: 'a', targetId: 'b', relationType: 'references' },
        { sourceId: 'a', targetId: 'c', relationType: 'extends', confidence: 0.7 },
        { sourceId: 'b', targetId: 'c', relationType: 'related_to' }
      ])
      expect(count).toBe(3)
    })

    it('should handle empty array', () => {
      const count = addRelations([])
      expect(count).toBe(0)
    })

    it('should handle single element array', () => {
      const count = addRelations([
        { sourceId: 'x', targetId: 'y', relationType: 'references' }
      ])
      expect(count).toBe(1)
    })

    it('should handle large batch', () => {
      const batch = Array.from({ length: 100 }, (_, i) => ({
        sourceId: `src-${i}`,
        targetId: `tgt-${i}`,
        relationType: 'related_to' as const,
        confidence: Math.random()
      }))
      const count = addRelations(batch)
      expect(count).toBe(100)

      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(100)
    })

    it('should use default confidence 1.0 when not specified', () => {
      addRelations([{ sourceId: 'a', targetId: 'b', relationType: 'references' }])
      const related = getRelatedMemories('a')
      expect(related[0].confidence).toBe(1.0)
    })
  })

  // ─── getRelatedMemories ───

  describe('getRelatedMemories', () => {
    beforeEach(() => {
      addRelation('a', 'b', 'references', 0.9)
      addRelation('a', 'c', 'extends', 0.8)
      addRelation('d', 'a', 'derived_from', 0.7)
    })

    it('should return outgoing relations', () => {
      const related = getRelatedMemories('a')
      const outgoing = related.filter((r) => r.direction === 'outgoing')
      expect(outgoing).toHaveLength(2)
      expect(outgoing.map((r) => r.memoryId).sort()).toEqual(['b', 'c'])
    })

    it('should return incoming relations', () => {
      const related = getRelatedMemories('a')
      const incoming = related.filter((r) => r.direction === 'incoming')
      expect(incoming).toHaveLength(1)
      expect(incoming[0].memoryId).toBe('d')
    })

    it('should combine outgoing and incoming', () => {
      const related = getRelatedMemories('a')
      expect(related).toHaveLength(3)
    })

    it('should filter by relation type', () => {
      const related = getRelatedMemories('a', { relationType: 'references' })
      expect(related).toHaveLength(1)
      expect(related[0].relationType).toBe('references')
    })

    it('should filter by relation type (incoming)', () => {
      const related = getRelatedMemories('a', { relationType: 'derived_from' })
      expect(related).toHaveLength(1)
      expect(related[0].direction).toBe('incoming')
    })

    it('should respect limit', () => {
      addRelations(
        Array.from({ length: 30 }, (_, i) => ({
          sourceId: 'big',
          targetId: `t-${i}`,
          relationType: 'related_to' as const
        }))
      )

      const related = getRelatedMemories('big', { limit: 5 })
      expect(related.length).toBeLessThanOrEqual(5)
    })

    it('should return empty for unknown memory', () => {
      const related = getRelatedMemories('unknown-id')
      expect(related).toEqual([])
    })

    it('should include confidence scores', () => {
      const related = getRelatedMemories('a')
      for (const r of related) {
        expect(typeof r.confidence).toBe('number')
        expect(r.confidence).toBeGreaterThanOrEqual(0)
        expect(r.confidence).toBeLessThanOrEqual(1)
      }
    })

    it('should include direction field', () => {
      const related = getRelatedMemories('a')
      for (const r of related) {
        expect(['outgoing', 'incoming']).toContain(r.direction)
      }
    })
  })

  // ─── deleteRelationsForMemory ───

  describe('deleteRelationsForMemory', () => {
    it('should delete all relations for a memory (source and target)', () => {
      addRelation('a', 'b', 'references')
      addRelation('c', 'a', 'derived_from')
      addRelation('d', 'e', 'related_to')

      const deleted = deleteRelationsForMemory('a')
      expect(deleted).toBe(2)

      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(1)
    })

    it('should return 0 for unknown memory', () => {
      addRelation('x', 'y', 'related_to')
      const deleted = deleteRelationsForMemory('nonexistent')
      expect(deleted).toBe(0)
    })

    it('should not affect unrelated records', () => {
      addRelation('a', 'b', 'references')
      addRelation('c', 'd', 'extends')

      deleteRelationsForMemory('a')

      const related = getRelatedMemories('c')
      expect(related).toHaveLength(1)
    })

    it('should delete both directions', () => {
      addRelation('x', 'y', 'references')
      addRelation('z', 'x', 'extends')

      deleteRelationsForMemory('x')

      expect(getRelatedMemories('y')).toHaveLength(0)
      expect(getRelatedMemories('z')).toHaveLength(0)
    })
  })

  // ─── getRelationStats ───

  describe('getRelationStats', () => {
    it('should return 0 for empty store', () => {
      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(0)
      expect(stats.byType).toEqual({})
    })

    it('should group by relation type', () => {
      addRelation('a', 'b', 'references')
      addRelation('a', 'c', 'references')
      addRelation('d', 'e', 'extends')

      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(3)
      expect(stats.byType.references).toBe(2)
      expect(stats.byType.extends).toBe(1)
    })

    it('should reflect deletions', () => {
      addRelation('a', 'b', 'references')
      addRelation('c', 'd', 'extends')

      deleteRelationsForMemory('a')

      const stats = getRelationStats()
      expect(stats.totalRelations).toBe(1)
      expect(stats.byType.references).toBeUndefined()
      expect(stats.byType.extends).toBe(1)
    })
  })
})
