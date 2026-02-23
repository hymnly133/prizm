/**
 * Executor integration test for prizm_browser: dispatchBrowser is invoked via executeBuiltinTool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

const mockExecute = vi.fn()

vi.mock('../browserTools', () => ({
  BrowserExecutor: class {
    execute(args: Record<string, unknown>, context: unknown) {
      return mockExecute(args, context)
    }
  }
}))

vi.mock('../../../core/ScopeStore', () => ({
  scopeStore: {
    getScopeData: vi.fn(() => ({
      documents: [],
      todoLists: [],
      clipboard: [],
      agentSessions: []
    })),
    getScopeRootPath: vi.fn(() => path.join(os.tmpdir(), 'prizm-browser-exec-test'))
  }
}))

vi.mock('../../workspaceResolver', () => ({
  createWorkspaceContext: vi.fn(() => ({
    scopeRoot: path.join(os.tmpdir(), 'prizm-browser-exec-test'),
    sessionWorkspaceRoot: null,
    sessionId: null
  }))
}))

vi.mock('../../contextTracker', () => ({
  recordActivity: vi.fn()
}))

vi.mock('../../../core/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

import { executeBuiltinTool } from '../executor'

describe('executeBuiltinTool prizm_browser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue('ok: no active session')
  })

  it('should call BrowserExecutor with action and sessionId in context', async () => {
    const result = await executeBuiltinTool(
      'default',
      'prizm_browser',
      { action: 'close' },
      'session-123'
    )

    expect(mockExecute).toHaveBeenCalledWith(
      { action: 'close' },
      { clientId: 'unknown', sessionId: 'session-123' }
    )
    expect(result.text).toBe('ok: no active session')
    expect(result.isError).toBeFalsy()
  })

  it('should return isError true when executor returns error', async () => {
    mockExecute.mockResolvedValue('error: url is required for goto')

    const result = await executeBuiltinTool(
      'default',
      'prizm_browser',
      { action: 'goto' },
      'sess-1'
    )

    expect(result.text).toContain('error:')
    expect(result.isError).toBe(true)
  })

  it('should pass through goto args', async () => {
    mockExecute.mockResolvedValue('ok: navigated to https://example.com')

    await executeBuiltinTool(
      'default',
      'prizm_browser',
      { action: 'goto', url: 'https://example.com' },
      'sess-1'
    )

    expect(mockExecute).toHaveBeenCalledWith(
      { action: 'goto', url: 'https://example.com' },
      { clientId: 'unknown', sessionId: 'sess-1' }
    )
  })

  it('should pass through click args', async () => {
    mockExecute.mockResolvedValue('ok: clicked ref 0')

    await executeBuiltinTool(
      'default',
      'prizm_browser',
      { action: 'click', ref: 0 },
      'sess-1'
    )

    expect(mockExecute).toHaveBeenCalledWith(
      { action: 'click', ref: 0 },
      { clientId: 'unknown', sessionId: 'sess-1' }
    )
  })
})
