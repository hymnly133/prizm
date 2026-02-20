/**
 * BG Session 事件处理器单元测试
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import type { AgentSession } from '@prizm/shared'

vi.mock('../../agentAuditLog/auditManager', () => ({
  record: vi.fn()
}))

vi.mock('../../ScopeStore', () => ({
  scopeStore: {
    getScopeData: vi.fn().mockReturnValue({ agentSessions: [] }),
    saveScope: vi.fn()
  }
}))

import { emit, clearAll } from '../eventBus'
import { registerBgSessionHandlers } from './bgSessionHandlers'
import * as auditManager from '../../agentAuditLog/auditManager'
import { scopeStore } from '../../ScopeStore'

const mockRecord = auditManager.record as ReturnType<typeof vi.fn>
const mockGetScopeData = scopeStore.getScopeData as ReturnType<typeof vi.fn>
const mockSaveScope = scopeStore.saveScope as ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAll()
  vi.clearAllMocks()
  mockGetScopeData.mockReturnValue({ agentSessions: [] })
  registerBgSessionHandlers()
})

afterEach(() => {
  clearAll()
})

describe('bgSessionHandlers', () => {
  describe('bg:session.completed', () => {
    it('审计记录包含 durationMs 和 resultLength', async () => {
      mockGetScopeData.mockReturnValue({ agentSessions: [] })

      await emit('bg:session.completed', {
        scope: 'default',
        sessionId: 'bg-4',
        result: '完成结果',
        durationMs: 1500
      })

      expect(mockRecord).toHaveBeenCalledOnce()
      const [, , entry] = mockRecord.mock.calls[0]
      expect(entry.detail).toContain('1500')
      expect(entry.detail).toContain('4')
    })

    it('有 announceTarget + 父 session 存在 → 注入 system 消息', async () => {
      const parentSession: AgentSession = {
        id: 'parent-1',
        scope: 'default',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const bgSession: AgentSession = {
        id: 'bg-5',
        scope: 'default',
        kind: 'background',
        bgMeta: {
          triggerType: 'tool_spawn',
          announceTarget: { sessionId: 'parent-1', scope: 'default' },
          label: '数据报告'
        },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      mockGetScopeData.mockImplementation((scope: string) => ({
        agentSessions: [parentSession, bgSession].filter((s) => s.scope === scope)
      }))

      await emit('bg:session.completed', {
        scope: 'default',
        sessionId: 'bg-5',
        result: '报告内容',
        durationMs: 2000
      })

      expect(parentSession.messages.length).toBe(1)
      expect(parentSession.messages[0].role).toBe('system')
      expect(parentSession.messages[0].parts[0]).toEqual(expect.objectContaining({ type: 'text' }))
      expect(mockSaveScope).toHaveBeenCalledWith('default')
    })

    it('有 announceTarget + 父 session 不存在 → 优雅跳过', async () => {
      const bgSession: AgentSession = {
        id: 'bg-6',
        scope: 'default',
        kind: 'background',
        bgMeta: {
          triggerType: 'tool_spawn',
          announceTarget: { sessionId: 'nonexistent', scope: 'default' }
        },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      mockGetScopeData.mockReturnValue({ agentSessions: [bgSession] })

      await expect(
        emit('bg:session.completed', {
          scope: 'default',
          sessionId: 'bg-6',
          result: '',
          durationMs: 100
        })
      ).resolves.toBeUndefined()
    })

    it('无 announceTarget → 不注入', async () => {
      const bgSession: AgentSession = {
        id: 'bg-7',
        scope: 'default',
        kind: 'background',
        bgMeta: { triggerType: 'api' },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      mockGetScopeData.mockReturnValue({ agentSessions: [bgSession] })

      await emit('bg:session.completed', {
        scope: 'default',
        sessionId: 'bg-7',
        result: '结果',
        durationMs: 100
      })

      expect(mockSaveScope).not.toHaveBeenCalled()
    })
  })

  describe('bg:session.failed', () => {
    it('记录 result=error + errorMessage', async () => {
      await emit('bg:session.failed', {
        scope: 'default',
        sessionId: 'bg-f1',
        error: 'LLM 超时',
        durationMs: 5000
      })

      expect(mockRecord).toHaveBeenCalledOnce()
      const [, , entry] = mockRecord.mock.calls[0]
      expect(entry.result).toBe('error')
      expect(entry.errorMessage).toBe('LLM 超时')
    })
  })

  describe('bg:session.timeout', () => {
    it('记录 errorMessage 包含 timeoutMs', async () => {
      await emit('bg:session.timeout', {
        scope: 'default',
        sessionId: 'bg-t1',
        timeoutMs: 60000
      })

      expect(mockRecord).toHaveBeenCalledOnce()
      const [, , entry] = mockRecord.mock.calls[0]
      expect(entry.errorMessage).toContain('60000')
    })
  })

  describe('bg:session.cancelled', () => {
    it('记录 action=bg_cancel + result=success', async () => {
      await emit('bg:session.cancelled', {
        scope: 'default',
        sessionId: 'bg-c1'
      })

      expect(mockRecord).toHaveBeenCalledOnce()
      const [, , entry] = mockRecord.mock.calls[0]
      expect(entry.action).toBe('bg_cancel')
      expect(entry.result).toBe('success')
    })
  })
})
