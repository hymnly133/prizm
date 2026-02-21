/**
 * InteractManager 单元测试
 * 验证交互请求的创建、解决、超时、取消等行为（InteractDetails 版本）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { interactManager } from './interactManager'
import type { InteractDetails } from '../core/toolPermission/types'

describe('InteractManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    interactManager.cancelSession('test-session', 'test-scope')
    vi.useRealTimers()
  })

  const fileDetails: InteractDetails = { kind: 'file_access', paths: ['/path/to/file'] }
  const terminalDetails: InteractDetails = { kind: 'terminal_command', command: 'rm -rf /' }
  const destructiveDetails: InteractDetails = {
    kind: 'destructive_operation',
    resourceType: 'document',
    resourceId: 'doc-1',
    description: 'Delete document "My Doc"'
  }

  it('should create a file_access interact request and resolve it when approved', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-1',
      'prizm_file',
      fileDetails
    )

    expect(request.requestId).toBeTruthy()
    expect(request.toolCallId).toBe('tc-1')
    expect(request.toolName).toBe('prizm_file')
    expect(request.kind).toBe('file_access')
    expect(request.details).toEqual(fileDetails)
    expect(request.sessionId).toBe('test-session')
    expect(request.scope).toBe('test-scope')

    const resolved = interactManager.resolveRequest(request.requestId, true, ['/path/to/file'])
    expect(resolved).toBe(true)

    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toEqual(['/path/to/file'])
  })

  it('should create a terminal_command interact request', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-term',
      'prizm_terminal_execute',
      terminalDetails
    )

    expect(request.kind).toBe('terminal_command')
    expect(request.details).toEqual(terminalDetails)

    interactManager.resolveRequest(request.requestId, true)
    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toBeUndefined()
  })

  it('should create a destructive_operation interact request', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-dest',
      'prizm_document',
      destructiveDetails
    )

    expect(request.kind).toBe('destructive_operation')

    interactManager.resolveRequest(request.requestId, false)
    const response = await promise
    expect(response.approved).toBe(false)
  })

  it('should resolve with denied when user rejects', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-2',
      'prizm_file',
      { kind: 'file_access', paths: ['/sensitive/path'] }
    )

    const resolved = interactManager.resolveRequest(request.requestId, false)
    expect(resolved).toBe(true)

    const response = await promise
    expect(response.approved).toBe(false)
    expect(response.grantedPaths).toBeUndefined()
  })

  it('should timeout after the specified duration', async () => {
    const { promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-3',
      'prizm_file',
      fileDetails,
      5000
    )

    vi.advanceTimersByTime(5000)

    const response = await promise
    expect(response.approved).toBe(false)
  })

  it('should return false when resolving a non-existent request', () => {
    const resolved = interactManager.resolveRequest('non-existent', true)
    expect(resolved).toBe(false)
  })

  it('should return false when resolving an already-resolved request', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-4',
      'prizm_file',
      fileDetails
    )

    interactManager.resolveRequest(request.requestId, true)
    await promise

    const secondResolve = interactManager.resolveRequest(request.requestId, true)
    expect(secondResolve).toBe(false)
  })

  it('should cancel all session interactions', async () => {
    const { promise: p1 } = interactManager.createRequest(
      'session-A', 'scope-1', 'tc-5', 'prizm_file', fileDetails
    )
    const { promise: p2 } = interactManager.createRequest(
      'session-A', 'scope-1', 'tc-6', 'prizm_file',
      { kind: 'file_access', paths: ['/b'] }
    )
    const { request: req3, promise: p3 } = interactManager.createRequest(
      'session-B', 'scope-1', 'tc-7', 'prizm_file', fileDetails
    )

    interactManager.cancelSession('session-A', 'scope-1')

    const r1 = await p1
    const r2 = await p2
    expect(r1.approved).toBe(false)
    expect(r2.approved).toBe(false)

    const pending = interactManager.getPendingRequests('session-B', 'scope-1')
    expect(pending.length).toBe(1)
    expect(pending[0].requestId).toBe(req3.requestId)

    interactManager.resolveRequest(req3.requestId, false)
    await p3
  })

  it('should list pending requests for a session', () => {
    const { request: r1 } = interactManager.createRequest(
      'session-X', 'scope-1', 'tc-8', 'prizm_file', fileDetails
    )
    const { request: r2 } = interactManager.createRequest(
      'session-X', 'scope-1', 'tc-9', 'prizm_document', destructiveDetails
    )

    const pending = interactManager.getPendingRequests('session-X', 'scope-1')
    expect(pending.length).toBe(2)
    expect(pending.map((p) => p.requestId).sort()).toEqual([r1.requestId, r2.requestId].sort())

    interactManager.cancelSession('session-X', 'scope-1')
  })

  it('should get a specific request', () => {
    const { request } = interactManager.createRequest(
      'session-Y', 'scope-1', 'tc-10', 'prizm_file', fileDetails
    )

    const found = interactManager.getRequest(request.requestId)
    expect(found).toBeTruthy()
    expect(found?.toolCallId).toBe('tc-10')

    const notFound = interactManager.getRequest('non-existent')
    expect(notFound).toBeUndefined()

    interactManager.cancelSession('session-Y', 'scope-1')
  })

  it('should use default paths when approving file_access without specifying paths', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-11',
      'prizm_file',
      { kind: 'file_access', paths: ['/default/path'] }
    )

    interactManager.resolveRequest(request.requestId, true)

    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toEqual(['/default/path'])
  })
})
