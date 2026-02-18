/**
 * EventBus 核心单元测试
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { emit, subscribe, subscribeOnce, clearAll } from './eventBus'

afterEach(() => {
  clearAll()
})

describe('EventBus', () => {
  describe('subscribe + emit', () => {
    it('should deliver event data to subscriber', async () => {
      const handler = vi.fn()
      subscribe('agent:session.created', handler)

      await emit('agent:session.created', { scope: 'default', sessionId: 'sess-1' })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ scope: 'default', sessionId: 'sess-1' })
    })

    it('should support multiple subscribers on same event', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      subscribe('agent:session.deleted', h1)
      subscribe('agent:session.deleted', h2)

      await emit('agent:session.deleted', { scope: 'default', sessionId: 'sess-2' })

      expect(h1).toHaveBeenCalledOnce()
      expect(h2).toHaveBeenCalledOnce()
    })

    it('should not call handler for different event', async () => {
      const handler = vi.fn()
      subscribe('agent:session.created', handler)

      await emit('agent:session.deleted', { scope: 'default', sessionId: 'sess-3' })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe', () => {
    it('should stop receiving events after unsubscribe', async () => {
      const handler = vi.fn()
      const unsub = subscribe('tool:executed', handler)

      await emit('tool:executed', {
        scope: 'default',
        sessionId: 'sess-1',
        toolName: 'prizm_file_read',
        auditInput: {
          toolName: 'prizm_file_read',
          action: 'read',
          resourceType: 'file',
          result: 'success'
        }
      })
      expect(handler).toHaveBeenCalledOnce()

      unsub()

      await emit('tool:executed', {
        scope: 'default',
        sessionId: 'sess-1',
        toolName: 'prizm_file_write',
        auditInput: {
          toolName: 'prizm_file_write',
          action: 'create',
          resourceType: 'file',
          result: 'success'
        }
      })
      expect(handler).toHaveBeenCalledOnce() // still 1
    })
  })

  describe('error isolation', () => {
    it('should not propagate handler errors to other handlers', async () => {
      const errorHandler = vi.fn(async () => {
        throw new Error('handler boom')
      })
      const goodHandler = vi.fn()

      subscribe('agent:session.created', errorHandler, 'failing')
      subscribe('agent:session.created', goodHandler, 'good')

      // Should not throw
      await emit('agent:session.created', { scope: 'default', sessionId: 'sess-err' })

      expect(errorHandler).toHaveBeenCalledOnce()
      expect(goodHandler).toHaveBeenCalledOnce()
    })
  })

  describe('subscribeOnce', () => {
    it('should only fire handler once', async () => {
      const handler = vi.fn()
      subscribeOnce('document:deleted', handler)

      await emit('document:deleted', { scope: 'default', documentId: 'doc-1' })
      // Allow microtask to run (once handler is promise-based)
      await new Promise((r) => setTimeout(r, 10))

      expect(handler).toHaveBeenCalledOnce()
    })
  })

  describe('clearAll', () => {
    it('should remove all subscriptions', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      subscribe('agent:session.created', h1)
      subscribe('agent:session.deleted', h2)

      clearAll()

      await emit('agent:session.created', { scope: 'default', sessionId: 's1' })
      await emit('agent:session.deleted', { scope: 'default', sessionId: 's2' })

      expect(h1).not.toHaveBeenCalled()
      expect(h2).not.toHaveBeenCalled()
    })
  })

  describe('async handlers', () => {
    it('should await async handlers before emit resolves', async () => {
      const order: string[] = []

      subscribe('agent:session.created', async () => {
        await new Promise((r) => setTimeout(r, 50))
        order.push('handler-done')
      })

      await emit('agent:session.created', { scope: 'default', sessionId: 's1' })
      order.push('emit-done')

      expect(order).toEqual(['handler-done', 'emit-done'])
    })
  })
})
