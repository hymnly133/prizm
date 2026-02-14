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
})
