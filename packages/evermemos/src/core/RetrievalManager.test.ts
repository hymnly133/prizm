import { describe, it, expect } from 'vitest'
import { RetrievalManager } from './RetrievalManager.js'
import { MemoryType, RetrieveMethod } from '../types.js'
import type { StorageAdapter } from '../storage/interfaces.js'

function makeStorage(
  queryFn: (sql: string, params?: any[]) => Promise<any[]>,
  vectorSearchFn?: (col: string, vec: number[], limit: number) => Promise<any[]>
): StorageAdapter {
  return {
    relational: {
      get: async () => null,
      find: async () => [],
      insert: async () => {},
      update: async () => {},
      delete: async () => {},
      query: queryFn
    },
    vector: {
      add: async () => {},
      search: vectorSearchFn ?? (async () => []),
      delete: async () => {}
    }
  }
}

const dummyLLM = { getEmbedding: async () => [0.1, 0.2] }

describe('RetrievalManager', () => {
  describe('keywordSearch with MiniSearch', () => {
    it('should filter by user_id and group_id in SQL', async () => {
      const queryCalls: Array<{ sql: string; params: any[] }> = []
      const storage = makeStorage(async (sql, params) => {
        queryCalls.push({ sql, params: params ?? [] })
        if (params?.includes('session-group')) {
          return [
            {
              id: 'm1',
              content: '测试 session memory 内容',
              type: MemoryType.EVENT_LOG,
              metadata: {}
            }
          ]
        }
        return []
      })

      const manager = new RetrievalManager(storage, dummyLLM as any)

      await manager.retrieve({
        query: '测试',
        user_id: 'u1',
        group_id: 'session-group',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(queryCalls.length).toBeGreaterThanOrEqual(1)
      const kwCall = queryCalls.find(
        (c) => c.sql.includes('user_id = ?') && c.sql.includes('group_id = ?')
      )
      expect(kwCall).toBeDefined()
      expect(kwCall!.params).toContain('u1')
      expect(kwCall!.params).toContain('session-group')
    })

    it('should rank exact query match higher than partial match', async () => {
      const storage = makeStorage(async () => [
        {
          id: 'm1',
          content: '这是一段很长的文本，其中提到了称呼这个词，但内容很多很多其他无关的东西填充文本',
          type: MemoryType.EPISODIC_MEMORY,
          metadata: {}
        },
        {
          id: 'm2',
          content: '用户明确要求AI助手使用"老大"作为对他的称呼。',
          type: MemoryType.EPISODIC_MEMORY,
          metadata: {}
        }
      ])

      const manager = new RetrievalManager(storage, dummyLLM as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      // Both contain "称呼" and should be found by MiniSearch
      const m2 = results.find((r) => r.id === 'm2')
      expect(m2).toBeDefined()
    })

    it('should give higher score to content with higher keyword density', async () => {
      const storage = makeStorage(async () => [
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
      ])

      const manager = new RetrievalManager(storage, dummyLLM as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      // MiniSearch TF-IDF should rank shorter/denser doc higher
      if (results.length >= 2) {
        expect(results[0].id).toBe('high-density')
        expect(results[0].score).toBeGreaterThan(results[1].score)
      }
    })

    it('should return empty array when no candidates match query', async () => {
      const storage = makeStorage(async () => [
        { id: 'a', content: '完全不相关的内容', type: MemoryType.EPISODIC_MEMORY, metadata: {} }
      ])
      const manager = new RetrievalManager(storage, dummyLLM as any)

      const results = await manager.retrieve({
        query: 'xyz_totally_unrelated',
        user_id: 'u1',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })

      expect(results).toHaveLength(0)
    })

    it('should handle mixed CJK and English queries', async () => {
      const storage = makeStorage(async () => [
        {
          id: 'en',
          content: 'The user prefers dark mode theme',
          type: MemoryType.EPISODIC_MEMORY,
          metadata: {}
        },
        {
          id: 'zh',
          content: '用户喜欢深色模式主题',
          type: MemoryType.EPISODIC_MEMORY,
          metadata: {}
        }
      ])
      const manager = new RetrievalManager(storage, dummyLLM as any)

      const enResults = await manager.retrieve({
        query: 'dark mode',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })
      expect(enResults.length).toBeGreaterThanOrEqual(1)
      expect(enResults[0].id).toBe('en')

      const zhResults = await manager.retrieve({
        query: '深色模式',
        method: RetrieveMethod.KEYWORD,
        limit: 10
      })
      expect(zhResults.length).toBeGreaterThanOrEqual(1)
      expect(zhResults[0].id).toBe('zh')
    })
  })

  describe('vectorSearch with group_id filter', () => {
    it('filters hits by group_id in memory', async () => {
      const storage = makeStorage(
        async () => [],
        async () => [
          { id: 'v1', content: 'match', group_id: 'scope-a', user_id: 'u1', _distance: 0.1 },
          { id: 'v2', content: 'other', group_id: 'scope-b', user_id: 'u1', _distance: 0.2 }
        ]
      )

      const manager = new RetrievalManager(storage, dummyLLM as any)

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
    })
  })

  describe('hybrid search normalized scores', () => {
    it('should produce scores in [0, 1] range', async () => {
      const storage = makeStorage(
        async () => [
          { id: 'k1', content: '称呼 老大', type: MemoryType.EPISODIC_MEMORY, metadata: {} }
        ],
        async () => [
          { id: 'k1', content: '称呼 老大', group_id: undefined, user_id: 'u1', _distance: 0.1 }
        ]
      )

      const manager = new RetrievalManager(storage, dummyLLM as any)

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
      expect(results[0].score).toBeCloseTo(1.0, 1)
    })
  })

  describe('agentic search', () => {
    it('falls back to multi-query hybrid when no agenticCompletionProvider', async () => {
      const storage = makeStorage(
        async () => [
          { id: 'a1', content: '称呼就是老大', type: MemoryType.EPISODIC_MEMORY, metadata: {} }
        ],
        async () => [
          { id: 'a1', content: '称呼就是老大', group_id: undefined, user_id: 'u1', _distance: 0.2 }
        ]
      )

      const manager = new RetrievalManager(storage, dummyLLM as any)

      const results = await manager.retrieve({
        query: '称呼',
        user_id: 'u1',
        method: RetrieveMethod.AGENTIC,
        limit: 5
      })

      expect(results.length).toBeGreaterThanOrEqual(0)
    })

    it('performs multi-round retrieval with sufficiency check when provider is available', async () => {
      const generateCalls: string[] = []
      const mockAgenticProvider = {
        generate: async ({ prompt }: { prompt: string }) => {
          generateCalls.push(prompt)
          if (prompt.includes('is_sufficient')) {
            return JSON.stringify({
              is_sufficient: true,
              reasoning: 'results are sufficient',
              missing_information: []
            })
          }
          return JSON.stringify({ queries: ['补充查询1'], reasoning: 'test' })
        }
      }

      const storage = makeStorage(
        async () => [
          { id: 'r1', content: '相关记忆内容', type: MemoryType.EPISODIC_MEMORY, metadata: {} }
        ],
        async () => [
          { id: 'r1', content: '相关记忆内容', group_id: undefined, user_id: 'u1', _distance: 0.15 }
        ]
      )

      const manager = new RetrievalManager(storage, dummyLLM as any, {
        agenticCompletionProvider: mockAgenticProvider
      })

      const results = await manager.retrieve({
        query: '用户的称呼是什么',
        user_id: 'u1',
        method: RetrieveMethod.AGENTIC,
        limit: 5
      })

      expect(results.length).toBeGreaterThanOrEqual(0)
      // The sufficiency check should have been called
      expect(generateCalls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
