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

function createMockStorage(opts?: {
  vectorSearchResults?: any[]
  /** 模拟已有记忆行（用于文本去重查询） */
  existingMemories?: Array<{
    id: string
    content: string
    type?: string
    user_id?: string
    metadata?: string
  }>
}): {
  storage: StorageAdapter
  inserts: Array<{ table: string; item: Record<string, unknown> }>
  updates: Array<{ table: string; id: string; item: Record<string, unknown> }>
  deletes: Array<{ table: string; id: string }>
  queryResults: any[]
  setVectorSearchResults: (results: any[]) => void
  setExistingMemories: (
    memories: Array<{
      id: string
      content: string
      type?: string
      user_id?: string
      metadata?: string
    }>
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
      // Profile 增量合并查询：SELECT * FROM memories WHERE type = ? AND user_id = ? AND group_id = ? ...
      if (sql.includes('SELECT * FROM memories') && sql.includes('group_id = ?')) {
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

describe('MemoryManager', () => {
  function createMockLLMProvider(response: string) {
    return {
      generate: async () => response,
      getEmbedding: async () => [0.1, 0.2, 0.3],
      chat: async function* () {
        yield { text: response }
      }
    } as any
  }

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
      const rows = await manager.listMemoriesByGroup('online', 'u1', 10)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('m2')
    })
  })

  describe('Semantic deduplication via processPerRound', () => {
    it('should merge PROFILE into existing when profile already exists', async () => {
      const { storage, inserts, updates, setVectorSearchResults, setExistingMemories } =
        createMockStorage()
      setVectorSearchResults([])
      setExistingMemories([
        {
          id: 'existing-profile-1',
          content: '用户希望被称为老大',
          type: MemoryType.PROFILE,
          user_id: 'user1',
          metadata: JSON.stringify({ items: ['用户希望被称为老大'] })
        }
      ])

      const llm = createMockLLMProvider('SAME 两条都描述用户希望被称为老大')
      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => ({
          profile: {
            user_profiles: [{ items: ['用户希望被称为老大'] }]
          }
        }),
        extractDocument: async () => null
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

      const created = await manager.processPerRound(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should NOT be inserted (no changes after merge)
      expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
    })

    it('should insert PROFILE when no existing profile (first profile)', async () => {
      const { storage, inserts, setVectorSearchResults } = createMockStorage()
      setVectorSearchResults([])

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => ({
          profile: {
            user_profiles: [{ items: ['用户喜欢周杰伦的音乐'] }]
          }
        }),
        extractDocument: async () => null
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

      const created = await manager.processPerRound(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should be inserted
      const profileInserts = inserts.filter((i) => i.item.type === MemoryType.PROFILE)
      expect(profileInserts).toHaveLength(1)
      expect(profileInserts[0].item.content).toBe('用户喜欢周杰伦的音乐')
      // Reported as created
      expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
    })

    it('should merge PROFILE with new items into existing profile', async () => {
      const { storage, inserts, updates, setVectorSearchResults, setExistingMemories } =
        createMockStorage()
      setVectorSearchResults([])
      setExistingMemories([
        {
          id: 'existing-profile-2',
          content: '用户希望被称为老大',
          type: MemoryType.PROFILE,
          user_id: 'user1',
          metadata: JSON.stringify({ items: ['用户希望被称为老大'] })
        }
      ])

      const embeddingProvider = { getEmbedding: async () => [0.4, 0.5, 0.6] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => ({
          profile: {
            user_profiles: [{ items: ['用户喜欢听摇滚乐'] }]
          }
        }),
        extractDocument: async () => null
      } as any

      const manager = new MemoryManager(storage, {
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

      const created = await manager.processPerRound(memcell, { userId: 'user1', scope: 'online' })

      // PROFILE should NOT be inserted (merged into existing)
      expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
      // Existing memory should be updated
      expect(
        updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-2')
      ).toHaveLength(1)
      // Reported as created (merge produces output)
      expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
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

    describe('Profile incremental merge via processPerRound', () => {
      it('should skip update when incoming items are identical to existing', async () => {
        const existingMemories = [
          {
            id: 'existing-profile-text-1',
            content: '用户希望被称为老大',
            type: MemoryType.PROFILE,
            user_id: 'user1',
            metadata: JSON.stringify({ items: ['用户希望被称为老大'] })
          }
        ]
        const { storage, inserts, updates } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const llm = createMockLLMProvider('SAME')
        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractPerRound: async () => ({
            profile: {
              user_profiles: [{ items: ['用户希望被称为老大'] }]
            }
          }),
          extractDocument: async () => null
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

        const created = await manager.processPerRound(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // 无变化 → 不插入也不更新
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
        expect(
          updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-text-1')
        ).toHaveLength(0)
      })

      it('should merge new items into existing profile', async () => {
        const existingMemories = [
          {
            id: 'existing-profile-diff',
            content: '用户倾向于使用文档管理工作',
            type: MemoryType.PROFILE,
            user_id: 'user1',
            metadata: JSON.stringify({ items: ['用户倾向于使用文档管理工作'] })
          }
        ]
        const { storage, inserts, updates } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractPerRound: async () => ({
            profile: {
              user_profiles: [{ items: ['用户希望被称为老大'] }]
            }
          }),
          extractDocument: async () => null
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

        const created = await manager.processPerRound(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // 新 items 合并 → update 已有记录
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
        expect(
          updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-diff')
        ).toHaveLength(1)
        expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
      })

      it('should merge with LLM when available and items differ', async () => {
        const existingMemories = [
          {
            id: 'existing-profile-medium',
            content: '用户是一名资深程序员\n用户希望被称为老大',
            type: MemoryType.PROFILE,
            user_id: 'user1',
            metadata: JSON.stringify({
              items: ['用户是一名资深程序员', '用户希望被称为老大']
            })
          }
        ]
        const { storage, inserts, updates } = createMockStorage({
          vectorSearchResults: [],
          existingMemories
        })

        const llm = createMockLLMProvider(
          JSON.stringify({
            merged_profile: {
              items: ['用户是一名资深程序员', '用户希望被称为老大', '用户喜欢摇滚乐']
            },
            changes_summary: '新增"用户喜欢摇滚乐"'
          })
        )
        const embeddingProvider = { getEmbedding: async () => new Array(384).fill(0.01) }
        const mockUnifiedExtractor = {
          extractPerRound: async () => ({
            profile: {
              user_profiles: [{ items: ['用户喜欢摇滚乐'] }]
            }
          }),
          extractDocument: async () => null
        } as any

        const manager = new MemoryManager(storage, {
          llmProvider: llm,
          unifiedExtractor: mockUnifiedExtractor,
          embeddingProvider
        })

        const memcell: MemCell = {
          original_data: [
            { role: 'user', content: '我喜欢摇滚乐' },
            { role: 'assistant', content: '好的！' }
          ],
          type: RawDataType.CONVERSATION,
          user_id: 'user1',
          deleted: false,
          scene: 'assistant'
        }

        const created = await manager.processPerRound(memcell, {
          userId: 'user1',
          scope: 'online'
        })

        // 合并到已有 → update
        expect(inserts.filter((i) => i.item.type === MemoryType.PROFILE)).toHaveLength(0)
        expect(
          updates.filter((u) => u.table === 'memories' && u.id === 'existing-profile-medium')
        ).toHaveLength(1)
        expect(created.filter((c) => c.type === MemoryType.PROFILE)).toHaveLength(1)
      })
    })
  })

  describe('Document scene: OVERVIEW → DOCUMENT+overview, FACTS → DOCUMENT+fact', () => {
    it('should store document overview as DOCUMENT type with sub_type=overview', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractDocument: async () => ({
          narrative: { content: '文档总览内容', summary: '文档总览' }
        }),
        extractPerRound: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: { documentId: 'doc1', title: '测试文档' },
        type: RawDataType.TEXT,
        text: '文档正文内容',
        user_id: 'user1',
        deleted: false,
        scene: 'document'
      }

      await manager.processDocumentMemCell(memcell, { userId: 'user1', scope: 'online' })

      const docInserts = inserts.filter((i) => i.item.type === MemoryType.DOCUMENT)
      expect(docInserts).toHaveLength(1)
      expect(docInserts[0].item.sub_type).toBe('overview')
      expect(docInserts[0].item.group_id).toBe('online')

      // 不应产生 NARRATIVE 类型
      expect(inserts.filter((i) => i.item.type === MemoryType.NARRATIVE)).toHaveLength(0)
    })

    it('should store document facts as DOCUMENT type with sub_type=fact', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractDocument: async () => ({
          document_facts: { facts: ['事实一', '事实二', '事实三'] }
        }),
        extractPerRound: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: { documentId: 'doc1', title: '测试文档' },
        type: RawDataType.TEXT,
        text: '文档正文内容',
        user_id: 'user1',
        deleted: false,
        scene: 'document'
      }

      await manager.processDocumentMemCell(memcell, { userId: 'user1', scope: 'online' })

      const factInserts = inserts.filter(
        (i) => i.item.type === MemoryType.DOCUMENT && i.item.sub_type === 'fact'
      )
      expect(factInserts).toHaveLength(3)
      factInserts.forEach((i) => {
        expect(i.item.group_id).toBe('online')
      })

      // 不应产生 EVENT_LOG 类型
      expect(inserts.filter((i) => i.item.type === MemoryType.EVENT_LOG)).toHaveLength(0)
    })

    it('should NOT produce EVENT_LOG for document scene even if event_log is in result', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractDocument: async () => ({
          narrative: { content: '总览' },
          event_log: { atomic_fact: ['不该出现的事件'] },
          document_facts: { facts: ['正确的文档事实'] }
        }),
        extractPerRound: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: { documentId: 'doc1' },
        type: RawDataType.TEXT,
        text: '内容',
        user_id: 'user1',
        deleted: false,
        scene: 'document'
      }

      await manager.processDocumentMemCell(memcell, { userId: 'user1', scope: 'online' })

      // EVENT_LOG 应被守卫阻止
      expect(inserts.filter((i) => i.item.type === MemoryType.EVENT_LOG)).toHaveLength(0)
      // DOCUMENT facts 应正常写入
      expect(
        inserts.filter((i) => i.item.type === MemoryType.DOCUMENT && i.item.sub_type === 'fact')
      ).toHaveLength(1)
      // DOCUMENT overview 应正常写入
      expect(
        inserts.filter((i) => i.item.type === MemoryType.DOCUMENT && i.item.sub_type === 'overview')
      ).toHaveLength(1)
    })

    it('should still produce EVENT_LOG for assistant scene via processPerRound', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => ({
          event_log: { atomic_fact: ['用户讨论了测试'] }
        }),
        extractDocument: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

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

      await manager.processPerRound(memcell, {
        userId: 'user1',
        scope: 'online',
        sessionId: 'sess1'
      })

      const eventInserts = inserts.filter((i) => i.item.type === MemoryType.EVENT_LOG)
      expect(eventInserts).toHaveLength(1)
      expect(eventInserts[0].item.group_id).toBe('online:session:sess1')
    })
  })

  describe('Pipeline 1: processPerRound', () => {
    it('should extract event_log + profile + foresight via extractPerRound', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => ({
          event_log: { atomic_fact: ['用户讨论了技术选型'] },
          foresight: [{ content: '用户可能会使用 React' }],
          profile: { user_profiles: [{ items: ['用户精通 TypeScript'] }] }
        }),
        extractNarrativeBatch: async () => null,
        extractDocument: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: '我想用 React 做前端' },
          { role: 'assistant', content: '好的选择！' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processPerRound(memcell, {
        userId: 'user1',
        scope: 'online',
        sessionId: 'sess1',
        roundMessageId: 'round-1'
      })

      // Should have EVENT_LOG, FORESIGHT, PROFILE
      expect(created.length).toBeGreaterThanOrEqual(1)
      const types = created.map((c) => c.type)
      expect(types).toContain(MemoryType.EVENT_LOG)
      expect(types).toContain(MemoryType.FORESIGHT)
      expect(types).toContain(MemoryType.PROFILE)

      // Check source_round_id is set (single round reference)
      const eventInserts = inserts.filter((i) => i.item.type === MemoryType.EVENT_LOG)
      expect(eventInserts.length).toBeGreaterThan(0)
      expect(eventInserts[0].item.source_round_id).toBe('round-1')
    })

    it('should return empty array when extractor returns null', async () => {
      const { storage } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => null,
        extractDocument: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: '你好' }],
        type: RawDataType.CONVERSATION,
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processPerRound(memcell, {
        scope: 'online',
        sessionId: 'sess1'
      })

      expect(created).toHaveLength(0)
    })
  })

  describe('Pipeline 2: processNarrativeBatch', () => {
    it('should extract narratives + foresight + profile with source_round_ids', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => null,
        extractDocument: async () => null,
        extractNarrativeBatch: async () => ({
          narratives: [
            { content: '话题一：用户讨论项目选型', summary: '项目选型' },
            { content: '话题二：用户描述团队协作', summary: '团队协作' }
          ],
          narrative: { content: '话题一：用户讨论项目选型', summary: '项目选型' },
          foresight: [{ content: '用户可能在下周开始新项目' }],
          profile: { user_profiles: [{ items: ['用户是技术负责人'] }] }
        })
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [
          { role: 'user', content: '讨论了很多话题' },
          { role: 'assistant', content: '是的' }
        ],
        type: RawDataType.CONVERSATION,
        user_id: 'user1',
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processNarrativeBatch(
        memcell,
        {
          userId: 'user1',
          scope: 'online',
          sessionId: 'sess1',
          roundMessageIds: ['round-1', 'round-2', 'round-3']
        },
        '已提取的上下文摘要'
      )

      const narrativeCreated = created.filter((c) => c.type === MemoryType.NARRATIVE)
      expect(narrativeCreated).toHaveLength(2)

      // Check source_round_ids is stored as JSON array
      const narrativeInserts = inserts.filter((i) => i.item.type === MemoryType.NARRATIVE)
      expect(narrativeInserts).toHaveLength(2)
      for (const ins of narrativeInserts) {
        const roundIds = JSON.parse(ins.item.source_round_ids as string)
        expect(roundIds).toEqual(['round-1', 'round-2', 'round-3'])
        // source_round_id (single) should be null for P2
        expect(ins.item.source_round_id).toBeNull()
      }

      // Foresight should also have source_round_ids
      const foresightInserts = inserts.filter((i) => i.item.type === MemoryType.FORESIGHT)
      expect(foresightInserts).toHaveLength(1)
      expect(JSON.parse(foresightInserts[0].item.source_round_ids as string)).toEqual([
        'round-1',
        'round-2',
        'round-3'
      ])
    })

    it('should handle single narrative from extractNarrativeBatch', async () => {
      const { storage, inserts } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => null,
        extractDocument: async () => null,
        extractNarrativeBatch: async () => ({
          narrative: { content: '单一叙述', summary: '摘要' }
        })
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: '一些内容' }],
        type: RawDataType.CONVERSATION,
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processNarrativeBatch(memcell, {
        scope: 'online',
        roundMessageIds: ['r1']
      })

      const narrativeCreated = created.filter((c) => c.type === MemoryType.NARRATIVE)
      expect(narrativeCreated).toHaveLength(1)
    })

    it('should return empty when extractor returns null', async () => {
      const { storage } = createMockStorage()

      const embeddingProvider = { getEmbedding: async () => [0.1, 0.2, 0.3] }
      const mockUnifiedExtractor = {
        extractPerRound: async () => null,
        extractDocument: async () => null,
        extractNarrativeBatch: async () => null
      } as any

      const manager = new MemoryManager(storage, {
        unifiedExtractor: mockUnifiedExtractor,
        embeddingProvider
      })

      const memcell: MemCell = {
        original_data: [{ role: 'user', content: '你好' }],
        type: RawDataType.CONVERSATION,
        deleted: false,
        scene: 'assistant'
      }

      const created = await manager.processNarrativeBatch(memcell, {
        scope: 'online'
      })

      expect(created).toHaveLength(0)
    })
  })

  describe('listMemoriesByRoundId (reverse lookup)', () => {
    it('should find memories by source_round_id or source_round_ids', async () => {
      const { storage } = createMockStorage()
      const relay = storage.relational as any
      relay.query = async (sql: string, params?: any[]) => {
        if (sql.includes('source_round_id = ?') && sql.includes('source_round_ids LIKE ?')) {
          return [
            { id: 'p1-mem', source_round_id: 'round-1', source_round_ids: null },
            { id: 'p2-mem', source_round_id: null, source_round_ids: '["round-1","round-2"]' }
          ]
        }
        return []
      }

      const manager = new MemoryManager(storage)
      const results = await manager.listMemoriesByRoundId('round-1')
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('p1-mem')
      expect(results[1].id).toBe('p2-mem')
    })
  })
})
