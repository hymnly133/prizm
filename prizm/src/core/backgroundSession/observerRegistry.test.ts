import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 直接导入类以便每个测试创建独立实例
const createRegistry = async () => {
  const mod = await import('./observerRegistry')
  return mod.observerRegistry
}

describe('ObserverRegistry', () => {
  let registry: Awaited<ReturnType<typeof createRegistry>>

  beforeEach(async () => {
    registry = await createRegistry()
    registry.clear()
  })

  afterEach(() => {
    registry.clear()
  })

  describe('startSession / has / isActive', () => {
    it('should track started sessions', () => {
      expect(registry.has('s1')).toBe(false)
      registry.startSession('s1')
      expect(registry.has('s1')).toBe(true)
      expect(registry.isActive('s1')).toBe(true)
    })
  })

  describe('dispatch / register replay', () => {
    it('should buffer dispatched chunks', () => {
      registry.startSession('s1')
      registry.dispatch('s1', { text: 'hello' })
      registry.dispatch('s1', { text: ' world' })

      const chunks: Array<{ text?: string }> = []
      const callbacks = {
        onChunk: vi.fn((c) => chunks.push(c)),
        onDone: vi.fn()
      }

      const registered = registry.register('s1', callbacks)
      expect(registered).toBe(true)
      expect(callbacks.onChunk).toHaveBeenCalledTimes(2)
      expect(chunks[0]).toEqual({ text: 'hello' })
      expect(chunks[1]).toEqual({ text: ' world' })
    })

    it('should forward live chunks to registered observers', () => {
      registry.startSession('s1')

      const chunks: Array<{ text?: string }> = []
      const callbacks = {
        onChunk: vi.fn((c) => chunks.push(c)),
        onDone: vi.fn()
      }

      registry.register('s1', callbacks)
      registry.dispatch('s1', { text: 'live1' })
      registry.dispatch('s1', { text: 'live2' })

      expect(callbacks.onChunk).toHaveBeenCalledTimes(2)
      expect(chunks).toEqual([{ text: 'live1' }, { text: 'live2' }])
    })

    it('should replay buffered chunks AND receive live chunks', () => {
      registry.startSession('s1')
      registry.dispatch('s1', { text: 'buffered' })

      const chunks: string[] = []
      const callbacks = {
        onChunk: vi.fn((c) => chunks.push(c.text ?? '')),
        onDone: vi.fn()
      }

      registry.register('s1', callbacks)
      expect(chunks).toEqual(['buffered'])

      registry.dispatch('s1', { text: 'live' })
      expect(chunks).toEqual(['buffered', 'live'])
    })
  })

  describe('endSession', () => {
    it('should notify all observers on session end', () => {
      registry.startSession('s1')
      const onDone1 = vi.fn()
      const onDone2 = vi.fn()

      registry.register('s1', { onChunk: vi.fn(), onDone: onDone1 })
      registry.register('s1', { onChunk: vi.fn(), onDone: onDone2 })

      registry.endSession('s1', { bgStatus: 'completed', bgResult: 'done' })

      expect(onDone1).toHaveBeenCalledWith({ bgStatus: 'completed', bgResult: 'done' })
      expect(onDone2).toHaveBeenCalledWith({ bgStatus: 'completed', bgResult: 'done' })
    })

    it('should mark session as inactive after end', () => {
      registry.startSession('s1')
      registry.endSession('s1', { bgStatus: 'completed' })
      expect(registry.isActive('s1')).toBe(false)
      expect(registry.has('s1')).toBe(true)
    })

    it('should stop dispatching after end', () => {
      registry.startSession('s1')
      registry.endSession('s1', { bgStatus: 'completed' })

      const onChunk = vi.fn()
      registry.register('s1', { onChunk, onDone: vi.fn() })
      registry.dispatch('s1', { text: 'should-not-arrive' })

      expect(onChunk).not.toHaveBeenCalledWith({ text: 'should-not-arrive' })
    })
  })

  describe('late observer (after endSession)', () => {
    it('should replay buffer and immediately call onDone', () => {
      registry.startSession('s1')
      registry.dispatch('s1', { text: 'chunk1' })
      registry.dispatch('s1', { reasoning: 'thinking' })
      registry.endSession('s1', { bgStatus: 'completed', bgResult: 'result' })

      const chunks: unknown[] = []
      const onDone = vi.fn()

      registry.register('s1', {
        onChunk: (c) => chunks.push(c),
        onDone
      })

      expect(chunks).toHaveLength(2)
      expect(chunks[0]).toEqual({ text: 'chunk1' })
      expect(chunks[1]).toEqual({ reasoning: 'thinking' })
      expect(onDone).toHaveBeenCalledWith({ bgStatus: 'completed', bgResult: 'result' })
    })
  })

  describe('unregister', () => {
    it('should stop receiving chunks after unregister', () => {
      registry.startSession('s1')

      const callbacks = {
        onChunk: vi.fn(),
        onDone: vi.fn()
      }

      registry.register('s1', callbacks)
      registry.dispatch('s1', { text: 'before' })
      expect(callbacks.onChunk).toHaveBeenCalledTimes(1)

      registry.unregister('s1', callbacks)
      registry.dispatch('s1', { text: 'after' })
      expect(callbacks.onChunk).toHaveBeenCalledTimes(1)
    })
  })

  describe('multiple observers', () => {
    it('should forward to all registered observers', () => {
      registry.startSession('s1')

      const chunks1: string[] = []
      const chunks2: string[] = []

      registry.register('s1', {
        onChunk: (c) => chunks1.push(c.text ?? ''),
        onDone: vi.fn()
      })
      registry.register('s1', {
        onChunk: (c) => chunks2.push(c.text ?? ''),
        onDone: vi.fn()
      })

      registry.dispatch('s1', { text: 'shared' })
      expect(chunks1).toEqual(['shared'])
      expect(chunks2).toEqual(['shared'])
    })
  })

  describe('register on unknown session', () => {
    it('should return false', () => {
      const result = registry.register('nonexistent', {
        onChunk: vi.fn(),
        onDone: vi.fn()
      })
      expect(result).toBe(false)
    })
  })

  describe('totalObservers', () => {
    it('should track active observer count', () => {
      registry.startSession('s1')
      registry.startSession('s2')

      const cb1 = { onChunk: vi.fn(), onDone: vi.fn() }
      const cb2 = { onChunk: vi.fn(), onDone: vi.fn() }
      const cb3 = { onChunk: vi.fn(), onDone: vi.fn() }

      registry.register('s1', cb1)
      registry.register('s1', cb2)
      registry.register('s2', cb3)
      expect(registry.totalObservers).toBe(3)

      registry.unregister('s1', cb1)
      expect(registry.totalObservers).toBe(2)

      registry.endSession('s1', { bgStatus: 'completed' })
      expect(registry.totalObservers).toBe(1)
    })
  })

  describe('error isolation', () => {
    it('should not break dispatch if one observer throws', () => {
      registry.startSession('s1')

      const goodChunks: string[] = []
      registry.register('s1', {
        onChunk: () => { throw new Error('bad observer') },
        onDone: vi.fn()
      })
      registry.register('s1', {
        onChunk: (c) => goodChunks.push(c.text ?? ''),
        onDone: vi.fn()
      })

      registry.dispatch('s1', { text: 'test' })
      expect(goodChunks).toEqual(['test'])
    })
  })

  describe('clear', () => {
    it('should remove all sessions', () => {
      registry.startSession('s1')
      registry.startSession('s2')
      expect(registry.has('s1')).toBe(true)

      registry.clear()
      expect(registry.has('s1')).toBe(false)
      expect(registry.has('s2')).toBe(false)
    })
  })
})
