import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryManager } from './MemoryManager.js'
import { MemoryType, RawDataType, type MemCell, type MemoryRoutingContext } from '../types.js'
import type { StorageAdapter } from '../storage/interfaces.js'
import type { IExtractor } from '../extractors/BaseExtractor.js'

function createMockStorage(): {
  storage: StorageAdapter
  inserts: Array<{ table: string; item: Record<string, unknown> }>
  deletes: Array<{ table: string; id: string }>
  queryResults: Record<string, any[]>
} {
  const inserts: Array<{ table: string; item: Record<string, unknown> }> = []
  const deletes: Array<{ table: string; id: string }> = []
  let queryResults: any[] = []

  const relational = {
    get: async () => null,
    find: async () => [],
    insert: async (table: string, item: Record<string, unknown>) => {
      inserts.push({ table, item: { ...item } })
    },
    update: async () => {},
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
    search: async () => [],
    delete: async () => {}
  }

  const storage: StorageAdapter = { relational, vector }

  return {
    storage,
    inserts,
    deletes,
    get queryResults() {
      return queryResults
    },
    set queryResults(v: any[]) {
      queryResults = v
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
})
