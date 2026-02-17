import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  searchThreeLevelMemories,
  searchUserMemories,
  searchScopeMemories,
  searchSessionMemories,
  setRetrievalManagerForTest,
  getMemoryManager,
  isMemoryEnabled
} from './EverMemService'

const mockRetrieve = vi.fn()

describe('EverMemService (logic chain)', () => {
  beforeEach(() => {
    mockRetrieve.mockReset()
    setRetrievalManagerForTest({
      retrieve: mockRetrieve
    } as any)
  })

  afterEach(() => {
    setRetrievalManagerForTest(null)
  })

  describe('searchThreeLevelMemories', () => {
    it('calls retrieve with correct user_id and group_id for each layer and returns three segments', async () => {
      mockRetrieve.mockImplementation(async (req: { user_id?: string; group_id?: string }) => {
        if (req.group_id === 'user') {
          return [{ id: 'p1', content: 'user profile', metadata: {}, type: 'profile', score: 0.9 }]
        }
        if (req.group_id === 'online') {
          return [
            {
              id: 'sc1',
              content: 'scope narrative',
              metadata: {},
              type: 'narrative',
              score: 0.8
            }
          ]
        }
        if (req.group_id === 'online:session:sid1') {
          return [
            {
              id: 'sess1',
              content: 'session event',
              metadata: {},
              type: 'event_log',
              score: 0.7
            }
          ]
        }
        return []
      })

      const result = await searchThreeLevelMemories('query', 'online', 'sid1')

      expect(result).toHaveProperty('user')
      expect(result).toHaveProperty('scope')
      expect(result).toHaveProperty('session')
      expect(Array.isArray(result.user)).toBe(true)
      expect(Array.isArray(result.scope)).toBe(true)
      expect(Array.isArray(result.session)).toBe(true)

      expect(result.user).toHaveLength(1)
      expect(result.user[0].memory).toBe('user profile')
      expect(result.user[0].id).toBe('p1')

      expect(result.scope.length).toBeGreaterThanOrEqual(0)
      const scopeContent = result.scope.map((m) => m.memory)
      expect(scopeContent.some((c) => c.includes('scope narrative'))).toBe(true)

      expect(result.session).toHaveLength(1)
      expect(result.session[0].memory).toBe('session event')
      expect(result.session[0].id).toBe('sess1')

      expect(mockRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'query',
          user_id: 'default'
        })
      )
    })
  })

  describe('searchUserMemories', () => {
    it('calls retrieve with group_id "user" and memory_types Profile', async () => {
      mockRetrieve.mockResolvedValue([])
      await searchUserMemories('q')
      expect(mockRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'q',
          user_id: 'default',
          group_id: 'user'
        })
      )
      const call = mockRetrieve.mock.calls[0][0]
      expect(call.memory_types).toContain('profile')
    })
  })

  describe('searchSessionMemories', () => {
    it('calls retrieve with group_id scope:session:sessionId', async () => {
      mockRetrieve.mockResolvedValue([])
      await searchSessionMemories('q', 'online', 'sess-xyz')
      expect(mockRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'q',
          user_id: 'default',
          group_id: 'online:session:sess-xyz'
        })
      )
      const call = mockRetrieve.mock.calls[0][0]
      expect(call.memory_types).toContain('event_log')
    })
  })

  describe('isMemoryEnabled', () => {
    it('returns true', () => {
      expect(isMemoryEnabled()).toBe(true)
    })
  })
})

describe('EverMemService (init guard)', () => {
  afterEach(() => {
    setRetrievalManagerForTest(null)
  })

  it('getMemoryManager throws when not initialized', () => {
    setRetrievalManagerForTest(null)
    expect(() => getMemoryManager()).toThrow('not initialized')
  })
})
