/**
 * 记忆 handler 单元测试
 *
 * 覆盖：
 * - document:saved → scheduleDocumentMemory
 * - document:deleted → deleteDocumentMemories
 * - agent:session.deleted → flushSessionBuffer
 * - agent:session.rolledBack → P1 记忆批量删除 + 已删除文档记忆清理
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

vi.mock('../../../llm/EverMemService', () => ({
  isMemoryEnabled: vi.fn().mockReturnValue(true),
  flushSessionBuffer: vi.fn().mockResolvedValue(null),
  deleteMemory: vi.fn().mockResolvedValue(true),
  deleteDocumentMemories: vi.fn().mockResolvedValue(0)
}))

vi.mock('../../../llm/documentMemoryService', () => ({
  scheduleDocumentMemory: vi.fn()
}))

vi.mock('../../../llm/memoryLogger', () => ({
  memLog: vi.fn()
}))

vi.mock('../../ScopeStore', () => ({
  scopeStore: {
    getScopeData: vi.fn().mockReturnValue({ agentSessions: [] })
  }
}))

import { emit, clearAll } from '../eventBus'
import { registerMemoryHandlers } from './memoryHandlers'
import {
  isMemoryEnabled,
  flushSessionBuffer,
  deleteMemory,
  deleteDocumentMemories
} from '../../../llm/EverMemService'
import { scheduleDocumentMemory } from '../../../llm/documentMemoryService'
import { scopeStore } from '../../ScopeStore'

const mockIsEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>
const mockFlush = flushSessionBuffer as ReturnType<typeof vi.fn>
const mockDeleteMemory = deleteMemory as ReturnType<typeof vi.fn>
const mockDeleteDocMemories = deleteDocumentMemories as ReturnType<typeof vi.fn>
const mockSchedule = scheduleDocumentMemory as ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAll()
  vi.clearAllMocks()
  mockIsEnabled.mockReturnValue(true)
  mockDeleteMemory.mockResolvedValue(true)
  mockDeleteDocMemories.mockResolvedValue(0)
  mockFlush.mockResolvedValue(null)
  registerMemoryHandlers()
})

afterEach(() => {
  clearAll()
})

describe('memoryHandlers', () => {
  describe('document:saved', () => {
    it('should schedule document memory extraction', async () => {
      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-1',
        title: 'Test Doc',
        content: 'hello world',
        actor: { type: 'user', source: 'api' }
      })

      expect(mockSchedule).toHaveBeenCalledOnce()
      expect(mockSchedule).toHaveBeenCalledWith('default', 'doc-1', expect.objectContaining({
        changedBy: { type: 'user', source: 'api' }
      }))
    })

    it('should skip when memory disabled', async () => {
      mockIsEnabled.mockReturnValue(false)

      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-2',
        title: 'Test',
        content: 'content'
      })

      expect(mockSchedule).not.toHaveBeenCalled()
    })
  })

  describe('document:deleted', () => {
    it('should cleanup document memories on delete', async () => {
      mockDeleteDocMemories.mockResolvedValue(3)

      await emit('document:deleted', {
        scope: 'default',
        documentId: 'doc-del-1'
      })

      expect(mockDeleteDocMemories).toHaveBeenCalledOnce()
      expect(mockDeleteDocMemories).toHaveBeenCalledWith('default', 'doc-del-1')
    })

    it('should skip when memory disabled', async () => {
      mockIsEnabled.mockReturnValue(false)

      await emit('document:deleted', {
        scope: 'default',
        documentId: 'doc-del-2'
      })

      expect(mockDeleteDocMemories).not.toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', async () => {
      mockDeleteDocMemories.mockRejectedValue(new Error('DB error'))

      await emit('document:deleted', {
        scope: 'default',
        documentId: 'doc-del-err'
      })

      expect(mockDeleteDocMemories).toHaveBeenCalledOnce()
    })
  })

  describe('agent:session.deleted', () => {
    it('should flush session buffer', async () => {
      await emit('agent:session.deleted', {
        scope: 'default',
        sessionId: 'sess-del-1'
      })

      expect(mockFlush).toHaveBeenCalledOnce()
      expect(mockFlush).toHaveBeenCalledWith('default', 'sess-del-1')
    })

    it('should handle flush errors gracefully', async () => {
      mockFlush.mockRejectedValue(new Error('flush failed'))

      await emit('agent:session.deleted', {
        scope: 'default',
        sessionId: 'sess-del-err'
      })

      expect(mockFlush).toHaveBeenCalledOnce()
    })
  })

  describe('agent:session.rolledBack', () => {
    const baseEvent = {
      scope: 'default',
      sessionId: 'sess-rb-1',
      checkpointId: 'cp-3',
      checkpointMessageIndex: 4,
      removedCheckpointIds: ['cp-3', 'cp-4'],
      remainingMessageCount: 4,
      actor: { type: 'user' as const, source: 'api:rollback' as const }
    }

    it('should batch delete P1 memories from memoryRefs', async () => {
      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: {
          user: ['mem-u1'],
          scope: ['mem-s1', 'mem-s2'],
          session: ['mem-sess1']
        },
        deletedDocumentIds: [],
        restoredDocumentIds: []
      })

      expect(mockDeleteMemory).toHaveBeenCalledTimes(4)
      expect(mockDeleteMemory).toHaveBeenCalledWith('mem-u1', 'default')
      expect(mockDeleteMemory).toHaveBeenCalledWith('mem-s1', 'default')
      expect(mockDeleteMemory).toHaveBeenCalledWith('mem-s2', 'default')
      expect(mockDeleteMemory).toHaveBeenCalledWith('mem-sess1', 'default')
    })

    it('should cleanup memories for deleted documents (create rollback)', async () => {
      mockDeleteDocMemories.mockResolvedValue(5)

      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: { user: [], scope: [], session: [] },
        deletedDocumentIds: ['doc-created-1', 'doc-created-2'],
        restoredDocumentIds: []
      })

      expect(mockDeleteDocMemories).toHaveBeenCalledTimes(2)
      expect(mockDeleteDocMemories).toHaveBeenCalledWith('default', 'doc-created-1')
      expect(mockDeleteDocMemories).toHaveBeenCalledWith('default', 'doc-created-2')
    })

    it('should handle both P1 cleanup and doc cleanup together', async () => {
      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: {
          user: ['mem-u1'],
          scope: [],
          session: ['mem-sess1']
        },
        deletedDocumentIds: ['doc-cr-1'],
        restoredDocumentIds: ['doc-upd-1']
      })

      expect(mockDeleteMemory).toHaveBeenCalledTimes(2)
      expect(mockDeleteDocMemories).toHaveBeenCalledOnce()
      expect(mockDeleteDocMemories).toHaveBeenCalledWith('default', 'doc-cr-1')
    })

    it('should skip when memory disabled', async () => {
      mockIsEnabled.mockReturnValue(false)

      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: { user: ['m1'], scope: [], session: [] },
        deletedDocumentIds: ['doc-1'],
        restoredDocumentIds: []
      })

      expect(mockDeleteMemory).not.toHaveBeenCalled()
      expect(mockDeleteDocMemories).not.toHaveBeenCalled()
    })

    it('should handle empty memory IDs gracefully', async () => {
      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: { user: [], scope: [], session: [] },
        deletedDocumentIds: [],
        restoredDocumentIds: []
      })

      expect(mockDeleteMemory).not.toHaveBeenCalled()
      expect(mockDeleteDocMemories).not.toHaveBeenCalled()
    })

    it('should continue on individual memory delete failure', async () => {
      mockDeleteMemory
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(true)

      await emit('agent:session.rolledBack', {
        ...baseEvent,
        removedMemoryIds: {
          user: [],
          scope: ['m1', 'm2', 'm3'],
          session: []
        },
        deletedDocumentIds: [],
        restoredDocumentIds: []
      })

      expect(mockDeleteMemory).toHaveBeenCalledTimes(3)
    })
  })

  describe('document:saved — BG session 文档记忆豁免', () => {
    const mockGetScopeData = scopeStore.getScopeData as ReturnType<typeof vi.fn>

    it('BG session + skipDocumentExtract=true → 跳过 scheduleDocumentMemory', async () => {
      mockGetScopeData.mockReturnValue({
        agentSessions: [{
          id: 'bg-sess-1', kind: 'background',
          bgMeta: { triggerType: 'api', memoryPolicy: { skipDocumentExtract: true } },
          messages: [], createdAt: 0, updatedAt: 0, scope: 'default'
        }]
      })

      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-bg-1',
        title: 'BG Doc',
        content: 'content',
        actor: { type: 'agent', sessionId: 'bg-sess-1', source: 'tool:prizm_document' }
      })

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('BG session + skipDocumentExtract=false → 正常抽取', async () => {
      mockGetScopeData.mockReturnValue({
        agentSessions: [{
          id: 'bg-sess-2', kind: 'background',
          bgMeta: { triggerType: 'api', memoryPolicy: { skipDocumentExtract: false } },
          messages: [], createdAt: 0, updatedAt: 0, scope: 'default'
        }]
      })

      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-bg-2',
        title: 'BG Doc 2',
        content: 'content',
        actor: { type: 'agent', sessionId: 'bg-sess-2', source: 'tool:prizm_document' }
      })

      expect(mockSchedule).toHaveBeenCalledOnce()
    })

    it('交互 session → 正常抽取', async () => {
      mockGetScopeData.mockReturnValue({
        agentSessions: [{
          id: 'int-sess-1',
          messages: [], createdAt: 0, updatedAt: 0, scope: 'default'
        }]
      })

      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-int-1',
        title: 'Interactive Doc',
        content: 'content',
        actor: { type: 'agent', sessionId: 'int-sess-1', source: 'tool:prizm_document' }
      })

      expect(mockSchedule).toHaveBeenCalledOnce()
    })

    it('无 sessionId（用户操作）→ 正常抽取', async () => {
      await emit('document:saved', {
        scope: 'default',
        documentId: 'doc-user-1',
        title: 'User Doc',
        content: 'content',
        actor: { type: 'user', source: 'api' }
      })

      expect(mockSchedule).toHaveBeenCalledOnce()
    })
  })
})
