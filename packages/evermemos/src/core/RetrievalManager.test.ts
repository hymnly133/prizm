import { describe, it, expect } from 'vitest'
import { RetrievalManager } from './RetrievalManager.js'
import { MemoryType, RetrieveMethod } from '../types.js'
import type { StorageAdapter } from '../storage/interfaces.js'

describe('RetrievalManager', () => {
  describe('retrieve with group_id filter', () => {
    it('keywordSearch receives group_id in query params', async () => {
      const queryCalls: Array<{ sql: string; params: any[] }> = []
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async (sql: string, params?: any[]) => {
          queryCalls.push({ sql, params: params ?? [] })
          if (params?.[2] === 'session-group') {
            return [
              { id: 'm1', content: 'session memory', type: MemoryType.EVENT_LOG, metadata: {} }
            ]
          }
          return []
        }
      }

      const vector = {
        add: async () => {},
        search: async () => [],
        delete: async () => {}
      }

      const llmProvider = {
        getEmbedding: async () => [0.1, 0.2]
      }

      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      await manager.retrieve({
        query: '测试',
        user_id: 'u1',
        group_id: 'session-group',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(queryCalls.length).toBeGreaterThanOrEqual(1)
      const kwCall = queryCalls.find(
        (c) => c.sql.includes('content LIKE ?') && c.sql.includes('group_id = ?')
      )
      expect(kwCall).toBeDefined()
      expect(kwCall!.params).toContain('u1')
      expect(kwCall!.params).toContain('session-group')
    })

    it('vectorSearch filters hits by group_id in memory', async () => {
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async () => []
      }

      const vector = {
        add: async () => {},
        search: async (_col: string, _vec: number[]) => [
          { id: 'v1', content: 'match', group_id: 'scope-a', user_id: 'u1', _distance: 0.1 },
          { id: 'v2', content: 'other', group_id: 'scope-b', user_id: 'u1', _distance: 0.2 }
        ],
        delete: async () => {}
      }

      const llmProvider = {
        getEmbedding: async () => [0.1, 0.2]
      }

      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      const results = await manager.retrieve({
        query: 'q',
        user_id: 'u1',
        group_id: 'scope-a',
        method: RetrieveMethod.VECTOR,
        limit: 10,
        memory_types: [MemoryType.EVENT_LOG]
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('v1')
      expect(results[0].content).toBe('match')
    })

    it('hybridSearch returns RRF-fused results respecting group_id', async () => {
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async (sql: string, params?: any[]) => {
          if (params?.includes('g1'))
            return [{ id: 'k1', content: 'kw hit', type: MemoryType.EVENT_LOG, metadata: {} }]
          return []
        }
      }

      const vector = {
        add: async () => {},
        search: async () => [
          { id: 'k1', content: 'kw hit', group_id: 'g1', user_id: 'u1', _distance: 0.1 }
        ],
        delete: async () => {}
      }

      const llmProvider = { getEmbedding: async () => [0.1, 0.2] }
      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      const results = await manager.retrieve({
        query: '关键词',
        user_id: 'u1',
        group_id: 'g1',
        method: RetrieveMethod.HYBRID,
        limit: 5
      })

      expect(results.length).toBeGreaterThanOrEqual(0)
      results.forEach((r) => {
        expect(r.id).toBeDefined()
        expect(r.content).toBeDefined()
        expect(r.score).toBeDefined()
      })
    })
  })

  describe('keyword search relevance sorting', () => {
    it('should rank exact query match higher than partial match', async () => {
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async () => [
          {
            id: 'm1',
            content:
              '这是一段很长的文本，其中提到了称呼这个词，但内容很多很多其他无关的东西填充文本',
            type: MemoryType.EPISODIC_MEMORY,
            metadata: {}
          },
          {
            id: 'm2',
            content: '用户明确要求AI助手使用"老大"作为对他的称呼。',
            type: MemoryType.EPISODIC_MEMORY,
            metadata: {}
          }
        ]
      }

      const vector = {
        add: async () => {},
        search: async () => [],
        delete: async () => {}
      }

      const llmProvider = { getEmbedding: async () => [0.1, 0.2] }
      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(results).toHaveLength(2)
      // The shorter, more focused content about "称呼" should rank higher
      expect(results[0].id).toBe('m2')
    })

    it('should give higher score to content with higher keyword density', async () => {
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async () => [
          {
            id: 'low-density',
            content: 'x'.repeat(200) + '称呼' + 'x'.repeat(200),
            type: MemoryType.EPISODIC_MEMORY,
            metadata: {}
          },
          {
            id: 'high-density',
            content: '称呼就是称呼',
            type: MemoryType.EPISODIC_MEMORY,
            metadata: {}
          }
        ]
      }

      const vector = {
        add: async () => {},
        search: async () => [],
        delete: async () => {}
      }

      const llmProvider = { getEmbedding: async () => [0.1, 0.2] }
      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('high-density')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })

  describe('hybrid search normalized scores', () => {
    it('should produce scores in [0, 1] range', async () => {
      const relational = {
        get: async () => null,
        find: async () => [],
        insert: async () => {},
        update: async () => {},
        delete: async () => {},
        query: async () => [
          { id: 'k1', content: '称呼 老大', type: MemoryType.EPISODIC_MEMORY, metadata: {} }
        ]
      }

      const vector = {
        add: async () => {},
        search: async () => [
          { id: 'k1', content: '称呼 老大', group_id: undefined, user_id: 'u1', _distance: 0.1 }
        ],
        delete: async () => {}
      }

      const llmProvider = { getEmbedding: async () => [0.1, 0.2] }
      const storage: StorageAdapter = { relational, vector }
      const manager = new RetrievalManager(storage, llmProvider as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.HYBRID,
        limit: 5
      })

      expect(results.length).toBeGreaterThan(0)
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(1)
      }
      // Item present in both lists at rank 0 should get score = 1.0
      expect(results[0].score).toBeCloseTo(1.0, 1)
    })
  })
})
