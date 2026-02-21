/**
 * toolExecution 单元测试 — handleInteractions
 *
 * 覆盖：无交互、file_access 全覆盖跳过、file_access 需审批、terminal/destructive、
 * 批准后重试、abort 提前退出、interactRequest payload 形状。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InteractDetails } from '../../core/toolPermission/types'
import type { ExecResult } from './chatHelpers'
import { handleInteractions, type ToolExecContext } from './toolExecution'

// --- Mocks ---

const mockCreateRequest = vi.fn()
const mockResolveRequest = vi.fn()
vi.mock('../../llm/interactManager', () => ({
  interactManager: {
    createRequest: (...args: unknown[]) => mockCreateRequest(...args),
    resolveRequest: (...args: unknown[]) => mockResolveRequest(...args),
    getRequest: vi.fn(),
    cancelSession: vi.fn()
  }
}))

vi.mock('../../llm/builtinTools', () => ({
  executeBuiltinTool: vi.fn().mockResolvedValue({ text: 'ok', isError: false }),
  BUILTIN_TOOL_NAMES: new Set(['prizm_file', 'prizm_document', 'prizm_terminal_execute'])
}))

describe('handleInteractions', () => {
  const baseCtx: ToolExecContext = {
    scope: 'default',
    sessionId: 's1',
    grantedPaths: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty chunks when no result needs interact', async () => {
    const results: ExecResult[] = [
      {
        tc: { id: 'tc1', name: 'prizm_todo', arguments: '{}' },
        text: 'done',
        isError: false
      }
    ]
    const { chunks, updatedGrantedPaths } = await handleInteractions(results, baseCtx)
    expect(chunks).toHaveLength(0)
    expect(updatedGrantedPaths).toEqual([])
  })

  it('should skip results without needsInteract or interactDetails', async () => {
    const results: ExecResult[] = [
      {
        tc: { id: 'tc1', name: 'prizm_file', arguments: '{}' },
        text: 'done',
        isError: false,
        needsInteract: true
        // interactDetails missing
      }
    ]
    const { chunks } = await handleInteractions(results, baseCtx)
    expect(chunks).toHaveLength(0)
  })

  it('should auto-retry file_access when all paths already granted', async () => {
    const executeBuiltinTool = (await import('../../llm/builtinTools')).executeBuiltinTool
    const ctx: ToolExecContext = {
      ...baseCtx,
      grantedPaths: ['/allowed/path']
    }
    const details: InteractDetails = { kind: 'file_access', paths: ['/allowed/path'] }
    const results: ExecResult[] = [
      {
        tc: { id: 'tc1', name: 'prizm_file', arguments: '{"path":"/allowed/path"}' },
        text: 'OUT_OF_BOUNDS: out_of_bounds',
        isError: true,
        needsInteract: true,
        interactDetails: details,
        parsedArgs: { path: '/allowed/path' }
      }
    ]
    const { chunks, updatedGrantedPaths } = await handleInteractions(results, ctx)
    expect(chunks).toHaveLength(0)
    expect(executeBuiltinTool).toHaveBeenCalledWith(
      'default',
      'prizm_file',
      { path: '/allowed/path' },
      's1',
      undefined,
      ['/allowed/path'],
      undefined
    )
    expect(updatedGrantedPaths).toEqual(['/allowed/path'])
  })

  it('should yield awaiting_interact and interactRequest then block until resolve', async () => {
    let resolvePromise!: (v: { requestId: string; approved: boolean; grantedPaths?: string[] }) => void
    const promise = new Promise<{ requestId: string; approved: boolean; grantedPaths?: string[] }>(
      (r) => {
        resolvePromise = r
      }
    )
    mockCreateRequest.mockReturnValue({
      request: {
        requestId: 'req-1',
        toolCallId: 'tc1',
        toolName: 'prizm_file',
        kind: 'file_access',
        details: { kind: 'file_access', paths: ['/foo'] },
        sessionId: 's1',
        scope: 'default',
        createdAt: Date.now()
      },
      promise
    })

    const details: InteractDetails = { kind: 'file_access', paths: ['/foo'] }
    const results: ExecResult[] = [
      {
        tc: { id: 'tc1', name: 'prizm_file', arguments: '{"path":"/foo"}' },
        text: 'out of bounds',
        isError: true,
        needsInteract: true,
        interactDetails: details,
        parsedArgs: { path: '/foo' }
      }
    ]

    const handlePromise = handleInteractions(results, baseCtx)
    await vi.waitFor(() => {
      expect(mockCreateRequest).toHaveBeenCalledWith('s1', 'default', 'tc1', 'prizm_file', details)
    })
    resolvePromise({ requestId: 'req-1', approved: true, grantedPaths: ['/foo'] })
    const { chunks, updatedGrantedPaths } = await handlePromise
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].toolCall).toEqual({
      type: 'tool',
      id: 'tc1',
      name: 'prizm_file',
      arguments: '{"path":"/foo"}',
      result: '',
      status: 'awaiting_interact'
    })
    expect(chunks[1].interactRequest).toBeDefined()
    expect(chunks[1].interactRequest!.kind).toBe('file_access')
    expect(chunks[1].interactRequest!.paths).toEqual(['/foo'])
    expect(updatedGrantedPaths).toContain('/foo')
  })

  it('should break on aborted signal', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const details: InteractDetails = { kind: 'file_access', paths: ['/foo'] }
    const results: ExecResult[] = [
      {
        tc: { id: 'tc1', name: 'prizm_file', arguments: '{}' },
        text: 'out of bounds',
        isError: true,
        needsInteract: true,
        interactDetails: details,
        parsedArgs: {}
      }
    ]
    const { chunks } = await handleInteractions(results, { ...baseCtx, signal: aborted.signal })
    expect(chunks).toHaveLength(0)
    expect(mockCreateRequest).not.toHaveBeenCalled()
  })

  it('should include terminal_command in interactRequest payload', async () => {
    let resolvePromise!: (v: { requestId: string; approved: boolean }) => void
    const promise = new Promise<{ requestId: string; approved: boolean }>((r) => {
      resolvePromise = r
    })
    mockCreateRequest.mockReturnValue({
      request: {
        requestId: 'req-t',
        toolCallId: 'tc2',
        toolName: 'prizm_terminal_execute',
        kind: 'terminal_command',
        details: { kind: 'terminal_command', command: 'rm -rf /' },
        sessionId: 's1',
        scope: 'default',
        createdAt: Date.now()
      },
      promise
    })

    const details: InteractDetails = {
      kind: 'terminal_command',
      command: 'rm -rf /',
      cwd: '/tmp'
    }
    const results: ExecResult[] = [
      {
        tc: { id: 'tc2', name: 'prizm_terminal_execute', arguments: '{"command":"rm -rf /"}' },
        text: 'denied',
        isError: true,
        needsInteract: true,
        interactDetails: details,
        parsedArgs: { command: 'rm -rf /' }
      }
    ]

    const handlePromise = handleInteractions(results, baseCtx)
    await vi.waitFor(() => expect(mockCreateRequest).toHaveBeenCalled())
    setTimeout(() => resolvePromise({ requestId: 'req-t', approved: true }), 0)
    const { chunks } = await handlePromise
    const interactChunk = chunks.find((c) => c.interactRequest)
    expect(interactChunk?.interactRequest).toMatchObject({
      kind: 'terminal_command',
      command: 'rm -rf /',
      cwd: '/tmp'
    })
  })

  it('should include destructive_operation in interactRequest payload', async () => {
    let resolvePromise!: (v: { requestId: string; approved: boolean }) => void
    const promise = new Promise<{ requestId: string; approved: boolean }>((r) => {
      resolvePromise = r
    })
    mockCreateRequest.mockReturnValue({
      request: {
        requestId: 'req-d',
        toolCallId: 'tc3',
        toolName: 'prizm_document',
        kind: 'destructive_operation',
        details: {
          kind: 'destructive_operation',
          resourceType: 'document',
          resourceId: 'doc-1',
          description: 'Delete document "My Doc"'
        },
        sessionId: 's1',
        scope: 'default',
        createdAt: Date.now()
      },
      promise
    })

    const details: InteractDetails = {
      kind: 'destructive_operation',
      resourceType: 'document',
      resourceId: 'doc-1',
      description: 'Delete document "My Doc"'
    }
    const results: ExecResult[] = [
      {
        tc: { id: 'tc3', name: 'prizm_document', arguments: '{}' },
        text: 'denied',
        isError: true,
        needsInteract: true,
        interactDetails: details,
        parsedArgs: {}
      }
    ]

    const handlePromise = handleInteractions(results, baseCtx)
    setTimeout(() => resolvePromise({ requestId: 'req-d', approved: true }), 0)
    const { chunks } = await handlePromise
    const interactChunk = chunks.find((c) => c.interactRequest)
    expect(interactChunk?.interactRequest).toMatchObject({
      kind: 'destructive_operation',
      resourceType: 'document',
      resourceId: 'doc-1',
      description: 'Delete document "My Doc"'
    })
  })
})
