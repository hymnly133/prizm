import { describe, it, expect, beforeEach } from 'vitest'
import {
  MemoryManager,
  tokenizeForDedup,
  jaccardSimilarity,
  diceCoefficient,
  textSimilarity,
  normalizeForDedup,
  buildBigrams,
  diceCoefficientFromBigrams
} from './MemoryManager.js'
import { MemoryType, RawDataType, type MemCell, type MemoryRoutingContext } from '../types.js'
import type { StorageAdapter } from '../storage/interfaces.js'
import type { IExtractor } from '../extractors/BaseExtractor.js'

function createMockStorage(opts?: {
  vectorSearchResults?: any[]
  /** 模拟已有记忆行（用于文本去重查询） */
  existingMemories?: Array<{ id: string; content: string; type?: string; user_id?: string }>
}): {
  storage: StorageAdapter
  inserts: Array<{ table: string; item: Record<string, unknown> }>
  updates: Array<{ table: string; id: string; item: Record<string, unknown> }>
  deletes: Array<{ table: string; id: string }>
  queryResults: Record<string, any[]>
  setVectorSearchResults: (results: any[]) => void
  setExistingMemories: (
    memories: Array<{ id: string; content: string; type?: string; user_id?: string }>
  ) => void
} {
  const inserts: Array<{ table: string; item: Record<string, unknown> }> = []
  const updates: Array<{ table: string; id: string; item: Record<string, unknown> }> = []
  const deletes: Array<{ table: string; id: string }> = []
  let queryResults: any[] = []
  let vectorSearchResults: any[] = opts?.vectorSearchResults ?? []
  let existingMemories = opts?.existingMemories ?? []

  const relational = {
    get: async () => null,
    find: async () => [],
    insert: async (table: string, item: Record<string, unknown>) => {
      inserts.push({ table, item: { ...item } })
    },
    update: async (table: string, id: string, item: Record<string, unknown>) => {
      updates.push({ table, id, item: { ...item } })
    },
    delete: async (table: string, id: string) => {
      deletes.push({ table, id })
    },
    query: async (sql: string, params?: any[]) => {
      // 文本去重查询：SELECT id, content FROM memories WHERE type = ? AND user_id = ? ...
      if (sql.includes('SELECT id, content FROM memories')) {
        const typeParam = params?.[0]
        const userParam = params?.[1]
        return existingMemories.filter(
          (m) => (!typeParam || m.type === typeParam) && (!userParam || m.user_id === userParam)
        )
      }
      if (params && params[0] === 'group_id_lookup') return queryResults
      return queryResults
    }
  }

  const vector = {
    add: async () => {},
    search: async () => vectorSearchResults,
    delete: async () => {}
  }

  const storage: StorageAdapter = { relational, vector }

  return {
    storage,
    inserts,
    updates,
    deletes,
    get queryResults() {
      return queryResults
    },
    set queryResults(v: any[]) {
      queryResults = v
    },
    setVectorSearchResults: (results: any[]) => {
      vectorSearchResults = results
      ;(storage.vector as any).search = async () => results
    },
    setExistingMemories: (memories) => {
      existingMemories = memories
    }
  }
}

function createMockExtractor(memoryType: MemoryType, content: string): IExtractor {
  return {
    extract: async () =>
      [
        {
          id: `mock-${memoryType}`,
          content,
          user_id: undefined,
          group_id: undefined,
          memory_type: memoryType
        }
      ] as any
  }
}

describe('MemoryManager', () => {
  describe('processMemCell with routing (assistant scene)', () => {
    it('routes Profile to User layer (group_id null), Episodic/Foresight to Scope, EventLog to Session', async () => {
      const { storage, inserts } = createMockStorage()

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.PROFILE,
        createMockExtractor(MemoryType.PROFILE, 'user profile')
      )
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractor(MemoryType.EPISODIC_MEMORY, 'episode')
      )
      manager.registerExtractor(
        MemoryType.FORESIGHT,
        createMockExtractor(MemoryType.FORESIGHT, 'foresight')
      )
      manager.registerExtractor(
        MemoryType.EVENT_LOG,
        createMockExtractor(MemoryType.EVENT_LOG, 'event')
      )

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }
      const routing: MemoryRoutingContext = {
        userId: 'user1',
        scope: 'online',
        sessionId: 'session-abc'
      }

      await manager.processMemCell(memcell, routing)

      expect(inserts).toHaveLength(4)

      const byType = Object.fromEntries(inserts.map((i) => [i.item.type, i.item]))
      expect(byType[MemoryType.PROFILE].group_id).toBeNull()
      expect(byType[MemoryType.EPISODIC_MEMORY].group_id).toBe('online')
      expect(byType[MemoryType.FORESIGHT].group_id).toBe('online')
      expect(byType[MemoryType.EVENT_LOG].group_id).toBe('online:session:session-abc')

      inserts.forEach((i) => {
        expect(i.item.user_id).toBe('user1')
      })
    })
  })

  describe('processMemCell with routing (document scene)', () => {
    it('routes Episodic and EventLog to scope:docs', async () => {
      const { storage, inserts } = createMockStorage()

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractor(MemoryType.EPISODIC_MEMORY, 'doc episode')
      )
      manager.registerExtractor(
        MemoryType.EVENT_LOG,
        createMockExtractor(MemoryType.EVENT_LOG, 'doc fact')
      )

      const memcell: MemCell = {
        original_data: { documentId: 'doc1' },
        type: RawDataType.TEXT,
        text: 'Document content here.',
        user_id: 'user1',
        deleted: false,
        scene: 'document'
      }
      const routing: MemoryRoutingContext = { userId: 'user1', scope: 'online' }

      await manager.processMemCell(memcell, routing)

      expect(inserts).toHaveLength(2)
      const types = inserts.map((i) => i.item.type)
      expect(types).toContain(MemoryType.EPISODIC_MEMORY)
      expect(types).toContain(MemoryType.EVENT_LOG)

      inserts.forEach((i) => {
        expect(i.item.group_id).toBe('online:docs')
        expect(i.item.user_id).toBe('user1')
      })
    })
  })

  describe('processMemCell without routing', () => {
    it('uses memcell group_id when no routing', async () => {
      const { storage, inserts } = createMockStorage()

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractor(MemoryType.EPISODIC_MEMORY, 'ep')
      )

      const memcell: MemCell = {
        original_data: [],
        type: RawDataType.TEXT,
        user_id: 'u1',
        group_id: 'custom-group',
        deleted: false
      }

      await manager.processMemCell(memcell)

      expect(inserts.length).toBeGreaterThanOrEqual(1)
      expect(inserts[0].item.group_id).toBe('custom-group')
    })
  })

  describe('deleteMemoriesByGroupId', () => {
    it('queries by group_id and deletes each row, returns count', async () => {
      const { storage, deletes } = createMockStorage()
      const queryCalls: Array<{ sql: string; params: any[] }> = []
      const relay = storage.relational as any
      const origQuery = relay.query.bind(relay)
      relay.query = async (sql: string, params?: any[]) => {
        queryCalls.push({ sql, params: params ?? [] })
        if (sql.includes('group_id = ?') && params?.[0] === 'scope:s1') {
          return [{ id: 'id1' }, { id: 'id2' }]
        }
        return []
      }

      const manager = new MemoryManager(storage)
      const n = await manager.deleteMemoriesByGroupId('scope:s1')

      expect(n).toBe(2)
      expect(deletes).toHaveLength(2)
      expect(deletes.map((d) => d.id).sort()).toEqual(['id1', 'id2'])
      expect(
        queryCalls.some((q) => q.sql.includes('group_id = ?') && q.params[0] === 'scope:s1')
      ).toBe(true)
    })

    it('returns 0 when query throws', async () => {
      const { storage } = createMockStorage()
      const relay = storage.relational as any
      relay.query = async () => {
        throw new Error('db error')
      }

      const manager = new MemoryManager(storage)
      const n = await manager.deleteMemoriesByGroupId('any')
      expect(n).toBe(0)
    })
  })

  describe('deleteMemoriesByGroupPrefix', () => {
    it('queries by prefix and deletes all matching rows', async () => {
      const { storage, deletes } = createMockStorage()
      const relay = storage.relational as any
      relay.query = async (sql: string, params?: any[]) => {
        if (sql.includes('group_id LIKE ?') && params?.[0] === 'online') {
          return [{ id: 'a1' }, { id: 'a2' }]
        }
        return []
      }

      const manager = new MemoryManager(storage)
      const n = await manager.deleteMemoriesByGroupPrefix('online')

      expect(n).toBe(2)
      expect(deletes).toHaveLength(2)
    })
  })

  describe('listMemories / listMemoriesByGroup', () => {
    it('listMemories returns rows for user_id', async () => {
      const { storage } = createMockStorage()
      const relay = storage.relational as any
      relay.query = async (sql: string, params?: any[]) => {
        if (sql.includes('user_id = ?') && params?.[0] === 'u1')
          return [{ id: 'm1', content: 'c1' }]
        return []
      }

      const manager = new MemoryManager(storage)
      const rows = await manager.listMemories('u1', 10)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('m1')
    })

    it('listMemoriesByGroup returns rows for user_id and group_id', async () => {
      const { storage } = createMockStorage()
      const relay = storage.relational as any
      relay.query = async (sql: string, params?: any[]) => {
        if (sql.includes('group_id = ?') && params?.[1] === 'online')
          return [{ id: 'm2', content: 'c2' }]
        return []
      }

      const manager = new MemoryManager(storage)
      const rows = await manager.listMemoriesByGroup('u1', 'online', 10)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('m2')
    })
  })

  describe('Semantic deduplication', () => {
    function createMockExtractorWithEmbedding(
      memoryType: MemoryType,
      content: string,
      embedding: number[] = [0.1, 0.2, 0.3]
    ): IExtractor {
      return {
        extract: async () =>
          [
            {
              id: `mock-${memoryType}-${Date.now()}`,
              content,
              user_id: undefined,
              group_id: undefined,
              memory_type: memoryType,
              embedding
            }
          ] as any
      }
    }

    function createMockLLMProvider(response: string) {
      return {
        generate: async () => response,
        getEmbedding: async () => [0.1, 0.2, 0.3],
        chat: async function* () {
          yield { text: response }
        }
      } as any
    }

    it('should dedup when vector match + LLM confirms SAME', async () => {
      const { storage, inserts, updates, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([
        { id: 'existing-ep-1', content: 'user wants to be called boss', _distance: 0.1 }
      ])

      const llm = createMockLLMProvider('SAME 两条都描述用户希望被称为老大')
      const manager = new MemoryManager(storage, { llmProvider: llm })
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'user wants nickname boss')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'call me boss' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // No new memory inserted
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(0)
      // Existing memory touched
      expect(
        updates.filter((u) => u.table === 'memories' && u.id === 'existing-ep-1')
      ).toHaveLength(1)
      // Dedup log written
      expect(inserts.filter((i) => i.table === 'dedup_log')).toHaveLength(1)
      const logEntry = inserts.find((i) => i.table === 'dedup_log')!.item
      expect(logEntry.kept_memory_id).toBe('existing-ep-1')
      expect(logEntry.llm_reasoning).toContain('SAME')
      // Not reported as created
      expect(created.filter((c) => c.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(0)
    })

    it('should NOT dedup when LLM says DIFF (even if vector close)', async () => {
      const { storage, inserts, updates, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([
        { id: 'existing-ep-2', content: 'user likes coffee', _distance: 0.3 }
      ])

      const llm = createMockLLMProvider('DIFF 新记忆涉及用户的新项目需求')
      const manager = new MemoryManager(storage, { llmProvider: llm })
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'user started new project')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'new project' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // New memory inserted (LLM rejected dedup)
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(1)
      // No dedup log
      expect(inserts.filter((i) => i.table === 'dedup_log')).toHaveLength(0)
      // No touch
      expect(updates.filter((u) => u.table === 'memories')).toHaveLength(0)
      // Reported as created
      expect(created.filter((c) => c.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(1)
    })

    it('should dedup Foresight with LLM confirmation', async () => {
      const { storage, inserts, updates, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([
        { id: 'existing-fs-1', content: 'user may need workspace help', _distance: 0.15 }
      ])

      const llm = createMockLLMProvider('SAME 都在预测用户需要工作区帮助')
      const manager = new MemoryManager(storage, { llmProvider: llm })
      manager.registerExtractor(
        MemoryType.FORESIGHT,
        createMockExtractorWithEmbedding(
          MemoryType.FORESIGHT,
          'user will need workspace assistance'
        )
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'help me' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      expect(inserts.filter((i) => i.item.type === MemoryType.FORESIGHT)).toHaveLength(0)
      expect(inserts.filter((i) => i.table === 'dedup_log')).toHaveLength(1)
      expect(created.filter((c) => c.type === MemoryType.FORESIGHT)).toHaveLength(0)
    })

    it('should fallback to vector-only dedup when no llmProvider', async () => {
      const { storage, inserts, updates, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([{ id: 'existing-ep-3', content: 'existing content', _distance: 0.1 }])

      // No llmProvider
      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'similar content')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'hi' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // Dedup still works (vector-only)
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(0)
      // Dedup log records both scores
      const logEntry = inserts.find((i) => i.table === 'dedup_log')?.item
      expect(logEntry?.llm_reasoning).toContain('vector-dist')
      expect(logEntry?.llm_reasoning).toContain('no-llm')
      expect(logEntry?.vector_distance).toBe(0.1)
      expect(logEntry?.text_similarity).toBe(-1)
    })

    it('should insert normally when distance above threshold', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([{ id: 'far-away', _distance: 0.9 }])

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'new topic')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'new topic' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(1)
      expect(inserts.filter((i) => i.table === 'dedup_log')).toHaveLength(0)
    })

    it('should insert normally when vector search empty (first memory)', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([])

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.FORESIGHT,
        createMockExtractorWithEmbedding(MemoryType.FORESIGHT, 'first prediction')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'first' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })
      expect(inserts.filter((i) => i.item.type === MemoryType.FORESIGHT)).toHaveLength(1)
    })

    it('should NOT dedup EventLog (append-only)', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([{ id: 'existing-event', _distance: 0.05 }])

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EVENT_LOG,
        createMockExtractorWithEmbedding(MemoryType.EVENT_LOG, 'some fact')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'something' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, {
        userId: 'user1',
        scope: 'online',
        sessionId: 'sess1'
      })

      expect(inserts.filter((i) => i.item.type === MemoryType.EVENT_LOG)).toHaveLength(1)
    })

    it('should handle vector search errors gracefully', async () => {
      const { storage, inserts } = createMockStorage()
      ;(storage.vector as any).search = async () => {
        throw new Error('LanceDB not ready')
      }

      const manager = new MemoryManager(storage)
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'episode')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'hi' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(1)
    })

    it('should dedup PROFILE when vector match + LLM confirms SAME', async () => {
      const { storage, inserts, updates, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([
        { id: 'existing-profile-1', content: '用户希望被称为老大', _distance: 0.08 }
      ])

      const llm = createMockLLMProvider('SAME 两条都描述用户希望被称为老大')
      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractAll: async () => ({
          profile: {
            user_profiles: [{ summary: '用户希望被称呼为"老大"' }]
          }
        })
      } as any

      const manager = new MemoryManager(storage, {
        llmProvider: llm,
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: '叫我老大' },
          { role: 'assistant', content: '好的，老大！' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should NOT be inserted (deduped)
      expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
      // Existing memory touched
      expect(
        updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-1')
      ).toHaveLength(1)
      // Dedup log written
      const dedupLogs = inserts.filter((i) => i.table === 'dedup_log')
      expect(dedupLogs).toHaveLength(1)
      expect(dedupLogs[0].item.kept_memory_id).toBe('existing-profile-1')
      expect(dedupLogs[0].item.new_memory_type).toBe(MemoryType.PROFILE)
      // Not reported as created
      expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(0)
    })

    it('should insert PROFILE when no vector match (first profile)', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([])

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractAll: async () => ({
          profile: {
            user_profiles: [{ summary: '用户喜欢周杰伦的音乐' }]
          }
        })
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: '我很喜欢周杰伦' },
          { role: 'assistant', content: '我也很喜欢！' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should be inserted
      const profileInserts = inserts.filter((i) => i.item.type === MemoryType.PROFILE)
      expect(profileInserts).toHaveLength(1)
      expect(profileInserts[0].item.content).toBe('用户喜欢周杰伦的音乐')
      // Reported as created
      expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
    })

    it('should NOT dedup PROFILE when LLM says DIFF', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([
        { id: 'existing-profile-2', content: '用户希望被称为老大', _distance: 0.3 }
      ])

      const llm = createMockLLMProvider('DIFF 新记忆是关于用户的音乐偏好，与称呼无关')
      const embeddingProvider = { getEmbedding: async () => [0.4, 0.5, 0.6] }
      const mockUnifiedExtractor = {
        extractAll: async () => ({
          profile: {
            user_profiles: [{ summary: '用户喜欢听摇滚乐' }]
          }
        })
      } as any

      const manager = new MemoryManager(storage, {
        llmProvider: llm,
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: '我喜欢听摇滚乐' },
          { role: 'assistant', content: '不错的品味！' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should be inserted (LLM rejected dedup)
      expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(1)
      // No dedup log
      expect(inserts.filter((i) => i.table === 'dedup_log')).toHaveLength(0)
      // Reported as created
      expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
    })

    it('should handle LLM error gracefully and fallback to vector-only', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([{ id: 'existing-ep-4', content: 'existing', _distance: 0.1 }])

      const errorLLM = {
        generate: async () => {
          throw new Error('LLM timeout')
        },
        getEmbedding: async () => [0.1],
        chat: async function* () {}
      } as any

      const manager = new MemoryManager(storage, { llmProvider: errorLLM })
      manager.registerExtractor(
        MemoryType.EPISODIC_MEMORY,
        createMockExtractorWithEmbedding(MemoryType.EPISODIC_MEMORY, 'content')
      )

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: 'hi' }],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      await manager.processMemCell(memcell, { userId: 'user1', scope: 'online' })

      // LLM failed, should fallback to similarity-only dedup (still deduped)
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(0)
      const logEntry = inserts.find((i) => i.table === 'dedup_log')?.item
      expect(logEntry?.llm_reasoning).toContain('vector-dist')
      expect(logEntry?.llm_reasoning).toContain('llm-fallback')
    })
  })

  describe('undoDedup', () => {
    it('should re-insert suppressed memory and mark log as rolled back', async () => {
      const { storage, inserts, updates } = createMockStorage()

      // Mock: query dedup_log returns an entry
      const origQuery = (storage.relational as any).query
      ;(storage.relational as any).query = async (sql: string, params?: any[]) => {
        if (sql.includes('dedup_log') && params?.[0] === 'log-1') {
          return [
            {
              id: 'log-1',
              kept_memory_id: 'kept-1',
              new_memory_content: 'suppressed content',
              new_memory_type: 'foresight',
              new_memory_metadata: JSON.stringify({ content: 'suppressed content' }),
              kept_memory_content: 'existing content',
              vector_distance: 0.1,
              llm_reasoning: 'SAME both about nickname',
              user_id: 'user1',
              group_id: 'online',
              created_at: '2026-02-16T00:00:00Z',
              rolled_back: 0
            }
          ]
        }
        return origQuery(sql, params)
      }

      const manager = new MemoryManager(storage)
      const restoredId = await manager.undoDedup('log-1')

      expect(restoredId).not.toBeNull()
      // Memory re-inserted
      const memInserts = inserts.filter((i) => i.table === 'memories')
      expect(memInserts).toHaveLength(1)
      expect(memInserts[0].item.content).toBe('suppressed content')
      expect(memInserts[0].item.type).toBe('foresight')
      // Log marked as rolled back
      const logUpdates = updates.filter((u) => u.table === 'dedup_log' && u.id === 'log-1')
      expect(logUpdates).toHaveLength(1)
      expect(logUpdates[0].item.rolled_back).toBe(1)
    })

    it('should return null for non-existent or already rolled-back log', async () => {
      const { storage } = createMockStorage()
      ;(storage.relational as any).query = async () => []

      const manager = new MemoryManager(storage)
      const result = await manager.undoDedup('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('Text-based dedup (jieba + Dice)', () => {
    describe('diceCoefficient (language-agnostic)', () => {
      it('should return 1 for identical strings', () => {
        expect(diceCoefficient('hello world', 'hello world')).toBe(1)
        expect(diceCoefficient('用户希望被称为老大', '用户希望被称为老大')).toBe(1)
      })

      it('should return 0 for completely different strings', () => {
        expect(diceCoefficient('abc', 'xyz')).toBe(0)
      })

      it('should handle Chinese near-duplicates well', () => {
        // 核心场景：Profile 重复
        const sim = diceCoefficient('用户希望被称为老大', '用户希望被称呼为老大')
        expect(sim).toBeGreaterThan(0.8) // Dice 对此场景效果很好
      })

      it('should distinguish different Chinese content', () => {
        const sim = diceCoefficient('用户希望被称为老大', '用户倾向于使用受管理文档进行工作')
        expect(sim).toBeLessThan(0.2)
      })

      it('should handle English near-duplicates', () => {
        const sim = diceCoefficient('User wants to be called boss', 'User wishes to be called boss')
        expect(sim).toBeGreaterThan(0.7)
      })

      it('should handle empty and very short strings', () => {
        expect(diceCoefficient('', '')).toBe(1)
        expect(diceCoefficient('a', '')).toBe(0)
        expect(diceCoefficient('a', 'a')).toBe(1)
        expect(diceCoefficient('a', 'b')).toBe(0)
      })

      it('should ignore punctuation and case', () => {
        const sim = diceCoefficient('Hello, World!', 'hello world')
        expect(sim).toBe(1)
      })
    })

    describe('textSimilarity (combined Dice + Jaccard)', () => {
      it('should return max of Dice and Jaccard', () => {
        // Dice 和 Jaccard 都应 > 0，取 max
        const sim = textSimilarity('用户希望被称为老大', '用户希望被称呼为老大')
        expect(sim).toBeGreaterThan(0.7)
      })

      it('should handle English-only text via Dice', () => {
        const sim = textSimilarity('I love programming', 'I love coding')
        expect(sim).toBeGreaterThan(0.3)
      })

      it('should return 0 for completely unrelated text', () => {
        const sim = textSimilarity('苹果手机', 'quantum physics')
        expect(sim).toBeLessThan(0.1)
      })
    })

    describe('tokenizeForDedup', () => {
      it('should tokenize Chinese text and remove stop words', () => {
        const tokens = tokenizeForDedup('用户希望被称为老大')
        expect(tokens.size).toBeGreaterThan(0)
        expect(tokens.has('用户')).toBe(true)
        expect(tokens.has('老大')).toBe(true)
        // 停用词 "的" 不应出现
        expect(tokens.has('的')).toBe(false)
      })

      it('should handle empty/whitespace-only text', () => {
        expect(tokenizeForDedup('').size).toBe(0)
        expect(tokenizeForDedup('   ').size).toBe(0)
      })

      it('should handle English text', () => {
        const tokens = tokenizeForDedup('User wants to be called boss')
        expect(tokens.has('user')).toBe(true)
        expect(tokens.has('boss')).toBe(true)
        // 停用词 "to", "be" 不应出现
        expect(tokens.has('to')).toBe(false)
        expect(tokens.has('be')).toBe(false)
      })
    })

    describe('jaccardSimilarity', () => {
      it('should return 1 for identical sets', () => {
        const a = new Set(['用户', '老大', '称为'])
        expect(jaccardSimilarity(a, a)).toBe(1)
      })

      it('should return 0 for disjoint sets', () => {
        const a = new Set(['用户', '老大'])
        const b = new Set(['文档', '工作'])
        expect(jaccardSimilarity(a, b)).toBe(0)
      })

      it('should compute correct similarity for overlapping sets', () => {
        const a = new Set(['用户', '希望', '称为', '老大'])
        const b = new Set(['用户', '希望', '称呼', '老大'])
        // intersection = {用户, 希望, 老大} = 3
        // union = {用户, 希望, 称为, 称呼, 老大} = 5
        expect(jaccardSimilarity(a, b)).toBeCloseTo(3 / 5, 5)
      })

      it('should handle empty sets', () => {
        expect(jaccardSimilarity(new Set(), new Set())).toBe(1)
        expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0)
      })
    })

    describe('Profile text dedup via unified extractor', () => {
      function createMockLLMProvider(response: string) {
        return {
          generate: async () => response,
          getEmbedding: async () => [0.1, 0.2, 0.3],
          chat: async function* () {
            yield { text: response }
          }
        } as any
      }

      it('should dedup Profile via text similarity + LLM confirmation', async () => {
        const existingMemories = [
          {
            id: 'existing-profile-text-1',
            content: '用户希望被称为老大',
            type: MemoryType.PROFILE,
            user_id: 'user1'
          }
        ]
        const { storage, inserts, updates } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const llm = createMockLLMProvider('SAME 语义完全一致')
        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractAll: async () => ({
            profile: {
              user_profiles: [{ summary: '用户希望被称呼为"老大"' }]
            }
          })
        } as any

        const manager = new MemoryManager(storage, {
          llmProvider: llm,
          unifiedExtractor: mockUnifiedExtractor,
          embeddingProvider
        })

        const memcell: MemCell = {
          original_data: [
            { role: 'user', content: '叫我老大' },
            { role: 'assistant', content: '好的，老大！' }
          ],
          type: RawDataType.CONVERSATION,
          user_id: 'user1',
          deleted: false,
          scene: 'assistant'
        }

        const created = await manager.processMemCell(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // PROFILE 应被去重（文本匹配 + LLM 确认），不插入新记忆
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
        // 已有记忆被 touch
        expect(
          updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-text-1')
        ).toHaveLength(1)
        // 去重日志写入
        const dedupLogs = inserts.filter((i) => i.table === 'dedup_log')
        expect(dedupLogs).toHaveLength(1)
        expect(dedupLogs[0].item.kept_memory_id).toBe('existing-profile-text-1')
        expect(String(dedupLogs[0].item.llm_reasoning)).toContain('text-sim')
        // LLM 确认结果也写入 reasoning
        expect(String(dedupLogs[0].item.llm_reasoning)).toContain('SAME')
        // 双分数都记录
        expect(dedupLogs[0].item.text_similarity).toBeGreaterThan(0.5)
        expect(dedupLogs[0].item.vector_distance).toBe(-1) // mock embedding 无向量候选
      })

      it('should NOT text-dedup Profile when content is different', async () => {
        const existingMemories = [
          {
            id: 'existing-profile-diff',
            content: '用户倾向于使用受管理文档进行工作',
            type: MemoryType.PROFILE,
            user_id: 'user1'
          }
        ]
        const { storage, inserts } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractAll: async () => ({
            profile: {
              user_profiles: [{ summary: '用户希望被称为老大' }]
            }
          })
        } as any

        const manager = new MemoryManager(storage, {
          unifiedExtractor: mockUnifiedExtractor,
          embeddingProvider
        })

        const memcell: MemCell = {
          original_data: [
            { role: 'user', content: '叫我老大' },
            { role: 'assistant', content: '好的，老大！' }
          ],
          type: RawDataType.CONVERSATION,
          user_id: 'user1',
          deleted: false,
          scene: 'assistant'
        }

        const created = await manager.processMemCell(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // 内容不同，PROFILE 应正常插入
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(1)
      })

      it('should dedup Profile with medium text similarity + LLM confirmation', async () => {
        // 已有记忆比新记忆多几个 token，sim 在 0.5~0.75 的中等区间
        const existingMemories = [
          {
            id: 'existing-profile-medium',
            content: '用户是一名资深程序员，希望被称为老大',
            type: MemoryType.PROFILE,
            user_id: 'user1'
          }
        ]
        const { storage, inserts, updates } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const llm = createMockLLMProvider('SAME 两条都描述用户希望被称为老大')
        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractAll: async () => ({
            profile: {
              user_profiles: [{ summary: '用户希望被称为老大' }]
            }
          })
        } as any

        const manager = new MemoryManager(storage, {
          llmProvider: llm,
          unifiedExtractor: mockUnifiedExtractor,
          embeddingProvider
        })

        const memcell: MemCell = {
          original_data: [
            { role: 'user', content: '叫我老大' },
            { role: 'assistant', content: '好的！' }
          ],
          type: RawDataType.CONVERSATION,
          user_id: 'user1',
          deleted: false,
          scene: 'assistant'
        }

        const created = await manager.processMemCell(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // LLM 确认相同 → 去重
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
        expect(
          updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-medium')
        ).toHaveLength(1)
      })
    })
  })
})
