/**
 * 资源锁 handler 单元测试
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

// Mock lockManager before importing handler
vi.mock('../../resourceLockManager', () => ({
  lockManager: {
    listSessionLocks: vi.fn().mockReturnValue([]),
    releaseSessionLocks: vi.fn()
  }
}))

import { emit, subscribe, clearAll } from '../eventBus'
import { registerLockHandlers } from './lockHandlers'
import { lockManager } from '../../resourceLockManager'

const mockListSessionLocks = lockManager.listSessionLocks as ReturnType<typeof vi.fn>
const mockReleaseSessionLocks = lockManager.releaseSessionLocks as ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAll()
  mockListSessionLocks.mockClear()
  mockReleaseSessionLocks.mockClear()
  registerLockHandlers()
})

afterEach(() => {
  clearAll()
})

describe('lockHandlers', () => {
  it('should release session locks on agent:session.deleted', async () => {
    mockListSessionLocks.mockReturnValue([
      { resourceType: 'document', resourceId: 'doc-1' },
      { resourceType: 'todo_list', resourceId: 'list-1' }
    ])

    // Track emitted lock change events
    const lockEvents: unknown[] = []
    subscribe('resource:lock.changed', (data) => {
      lockEvents.push(data)
    })

    await emit('agent:session.deleted', { scope: 'default', sessionId: 'sess-del' })

    expect(mockListSessionLocks).toHaveBeenCalledWith('default', 'sess-del')
    expect(mockReleaseSessionLocks).toHaveBeenCalledWith('default', 'sess-del')
    expect(lockEvents).toHaveLength(2)
    expect(lockEvents[0]).toMatchObject({
      action: 'unlocked',
      scope: 'default',
      resourceType: 'document',
      resourceId: 'doc-1'
    })
    expect(lockEvents[1]).toMatchObject({
      action: 'unlocked',
      scope: 'default',
      resourceType: 'todo_list',
      resourceId: 'list-1'
    })
  })

  it('should not call releaseSessionLocks if no locks exist', async () => {
    mockListSessionLocks.mockReturnValue([])

    await emit('agent:session.deleted', { scope: 'default', sessionId: 'sess-nolocks' })

    expect(mockListSessionLocks).toHaveBeenCalledWith('default', 'sess-nolocks')
    expect(mockReleaseSessionLocks).not.toHaveBeenCalled()
  })
})
