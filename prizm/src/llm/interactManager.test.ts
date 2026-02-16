/**
 * InteractManager 单元测试
 * 验证交互请求的创建、解决、超时、取消等行为
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { interactManager } from './interactManager'

describe('InteractManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    // 清理所有挂起的交互请求
    interactManager.cancelSession('test-session', 'test-scope')
    vi.useRealTimers()
  })

  it('should create an interact request and resolve it when approved', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-1',
      'prizm_file_read',
      ['/path/to/file']
    )

    expect(request.requestId).toBeTruthy()
    expect(request.toolCallId).toBe('tc-1')
    expect(request.toolName).toBe('prizm_file_read')
    expect(request.paths).toEqual(['/path/to/file'])
    expect(request.sessionId).toBe('test-session')
    expect(request.scope).toBe('test-scope')

    // 模拟用户批准
    const resolved = interactManager.resolveRequest(request.requestId, true, ['/path/to/file'])
    expect(resolved).toBe(true)

    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toEqual(['/path/to/file'])
    expect(response.requestId).toBe(request.requestId)
  })

  it('should resolve with denied when user rejects', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-2',
      'prizm_file_write',
      ['/sensitive/path']
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
      'prizm_file_read',
      ['/path'],
      5000 // 5 秒超时
    )

    // 推进 5 秒
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
      'prizm_file_read',
      ['/path']
    )

    interactManager.resolveRequest(request.requestId, true)
    await promise

    // 二次 resolve 应返回 false
    const secondResolve = interactManager.resolveRequest(request.requestId, true)
    expect(secondResolve).toBe(false)
  })

  it('should cancel all session interactions', async () => {
    const { request: req1, promise: p1 } = interactManager.createRequest(
      'session-A',
      'scope-1',
      'tc-5',
      'prizm_file_read',
      ['/a']
    )
    const { request: req2, promise: p2 } = interactManager.createRequest(
      'session-A',
      'scope-1',
      'tc-6',
      'prizm_file_write',
      ['/b']
    )
    const { request: req3, promise: p3 } = interactManager.createRequest(
      'session-B',
      'scope-1',
      'tc-7',
      'prizm_file_read',
      ['/c']
    )

    // 取消 session-A 的交互
    interactManager.cancelSession('session-A', 'scope-1')

    const r1 = await p1
    const r2 = await p2
    expect(r1.approved).toBe(false)
    expect(r2.approved).toBe(false)

    // session-B 的交互应该不受影响
    const pending = interactManager.getPendingRequests('session-B', 'scope-1')
    expect(pending.length).toBe(1)
    expect(pending[0].requestId).toBe(req3.requestId)

    // 清理
    interactManager.resolveRequest(req3.requestId, false)
    await p3
  })

  it('should list pending requests for a session', () => {
    const { request: r1 } = interactManager.createRequest(
      'session-X',
      'scope-1',
      'tc-8',
      'prizm_file_read',
      ['/a']
    )
    const { request: r2 } = interactManager.createRequest(
      'session-X',
      'scope-1',
      'tc-9',
      'prizm_file_write',
      ['/b']
    )

    const pending = interactManager.getPendingRequests('session-X', 'scope-1')
    expect(pending.length).toBe(2)
    expect(pending.map((p) => p.requestId).sort()).toEqual([r1.requestId, r2.requestId].sort())

    // 清理
    interactManager.cancelSession('session-X', 'scope-1')
  })

  it('should get a specific request', () => {
    const { request } = interactManager.createRequest(
      'session-Y',
      'scope-1',
      'tc-10',
      'prizm_file_read',
      ['/test']
    )

    const found = interactManager.getRequest(request.requestId)
    expect(found).toBeTruthy()
    expect(found?.toolCallId).toBe('tc-10')

    const notFound = interactManager.getRequest('non-existent')
    expect(notFound).toBeUndefined()

    // 清理
    interactManager.cancelSession('session-Y', 'scope-1')
  })

  it('should use default paths when approving without specifying paths', async () => {
    const { request, promise } = interactManager.createRequest(
      'test-session',
      'test-scope',
      'tc-11',
      'prizm_file_read',
      ['/default/path']
    )

    // Approve without specifying paths
    interactManager.resolveRequest(request.requestId, true)

    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toEqual(['/default/path'])
  })
})
