import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryManager } from './MemoryManager.js'
import { MemoryType, RawDataType, type MemCell, type MemoryRoutingContext } from '../types.js'
import type { StorageAdapter } from '../storage/interfaces.js'
import type { IExtractor } from '../extractors/BaseExtractor.js'

function createMockStorage(opts?: { vectorSearchResults?: any[] }): {
  storage: StorageAdapter
  inserts: Array<{ table: string; item: Record<string, unknown> }>
  updates: Array<{ table: string; id: string; item: Record<string, unknown> }>
  deletes: Array<{ table: string; id: string }>
  queryResults: Record<string, any[]>
  setVectorSearchResults: (results: any[]) => void
} {
  const inserts: Array<{ table: string; item: Record<string, unknown> }> = []
  const updates: Array<{ table: string; id: string; item: Record<string, unknown> }> = []
  const deletes: Array<{ table: string; id: string }> = []
  let queryResults: any[] = []
  let vectorSearchResults: any[] = opts?.vectorSearchResults ?? []

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
    query: async (_sql: string, params?: any[]) => {
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
      // Dedup log records vector-only reasoning
      const logEntry = inserts.find((i) => i.table === 'dedup_log')?.item
      expect(logEntry?.llm_reasoning).toContain('vector-only')
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

      // LLM failed, should fallback to vector-only dedup (still deduped)
      expect(inserts.filter((i) => i.item.type === MemoryType.EPISODIC_MEMORY)).toHaveLength(0)
      const logEntry = inserts.find((i) => i.table === 'dedup_log')?.item
      expect(logEntry?.llm_reasoning).toContain('vector-only')
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
})
