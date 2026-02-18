/**
 * 审计 handler 单元测试
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

// Mock auditManager before importing handler
vi.mock('../../agentAuditLog', () => ({
  auditManager: {
    record: vi.fn()
  }
}))

import { emit, clearAll } from '../eventBus'
import { registerAuditHandlers } from './auditHandlers'
import { auditManager } from '../../agentAuditLog'

const mockRecord = auditManager.record as ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAll()
  mockRecord.mockClear()
  registerAuditHandlers()
})

afterEach(() => {
  clearAll()
})

describe('auditHandlers', () => {
  it('should record audit entry when tool:executed is emitted', async () => {
    const auditInput = {
      toolName: 'prizm_create_document',
      action: 'create' as const,
      resourceType: 'document' as const,
      resourceId: 'doc-123',
      result: 'success' as const
    }

    await emit('tool:executed', {
      scope: 'default',
      sessionId: 'sess-1',
      toolName: 'prizm_create_document',
      auditInput
    })

    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith('default', 'sess-1', auditInput)
  })

  it('should handle auditManager.record errors gracefully', async () => {
    mockRecord.mockImplementation(() => {
      throw new Error('DB write failed')
    })

    // Should not throw
    await emit('tool:executed', {
      scope: 'default',
      sessionId: 'sess-2',
      toolName: 'prizm_file_read',
      auditInput: {
        toolName: 'prizm_file_read',
        action: 'read',
        resourceType: 'file',
        result: 'success'
      }
    })

    expect(mockRecord).toHaveBeenCalledOnce()
  })
})
