/**
 * Agent sessions interact-response 路由测试
 *
 * 覆盖：POST /agent/sessions/:id/interact-response
 * - 400 requestId/approved 缺失或非法
 * - 403 scope 无权限、request 不属于该 session
 * - 404 request 不存在
 * - 410 已 resolve 后重复提交
 * - 503 adapter 不可用
 * - 200 批准/拒绝、grantedPaths 持久化
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { registerSessionRoutes } from './sessions'
import { interactManager } from '../../llm/interactManager'
import type { IAgentAdapter } from '../../adapters/interfaces'

vi.mock('../../scopeUtils', () => ({
  ensureStringParam: (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : ''),
  getScopeFromQuery: (req: { query?: { scope?: string }; body?: { scope?: string } }) =>
    req?.query?.scope ?? req?.body?.scope ?? 'default',
  hasScopeAccess: vi.fn(() => true),
  getScopeForCreate: vi.fn(() => 'default'),
  requireScopeForList: vi.fn(),
  getScopeForReadById: vi.fn(),
  getAllowedScopes: vi.fn(() => ['default'])
}))

vi.mock('../../llm/contextTracker', () => ({
  getSessionContext: vi.fn(() => null),
  resetSessionContext: vi.fn()
}))

vi.mock('../../llm/scopeInteractionParser', () => ({
  deriveScopeActivities: vi.fn(() => []),
  collectToolCallsFromMessages: vi.fn(() => [])
}))

vi.mock('../../core/tokenUsageDb', () => ({
  queryTokenUsage: vi.fn(() => [])
}))

vi.mock('../../llm/index', () => ({
  getLLMProviderName: vi.fn(() => 'test')
}))

vi.mock('../../terminal/TerminalSessionManager', () => ({
  getTerminalManager: vi.fn(() => null)
}))

vi.mock('../../core/eventBus', () => ({
  emit: vi.fn()
}))

vi.mock('../../core/resourceLockManager', () => ({
  lockManager: { getLocksBySession: vi.fn(() => []) }
}))

vi.mock('../../core/checkpointStore', () => ({
  loadFileSnapshots: vi.fn(),
  deleteCheckpointSnapshots: vi.fn(),
  deleteSessionCheckpoints: vi.fn(),
  extractFileChangesFromMessages: vi.fn(() => [])
}))

vi.mock('../../core/ScopeStore', () => ({
  scopeStore: { getScopeData: vi.fn(() => ({})), getScopeRootPath: vi.fn(() => '/tmp') }
}))

vi.mock('../../core/mdStore', () => ({
  getSession: vi.fn(),
  saveSession: vi.fn(),
  listSessions: vi.fn(() => [])
}))

vi.mock('../../services/documentService', () => ({}))
vi.mock('../../core/documentVersionStore', () => ({
  getVersionHistory: vi.fn(() => []),
  saveVersion: vi.fn()
}))
vi.mock('../../llm/EverMemService', () => ({
  resetSessionAccumulator: vi.fn()
}))
vi.mock('../../llm/conversationSummaryService', () => ({
  scheduleTurnSummary: vi.fn()
}))
vi.mock('../_shared', () => ({
  getTextContent: (x: unknown) => x,
  isChatCategory: () => false,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  getScopeFromQuery: (req: { query?: { scope?: string } }) => req?.query?.scope ?? 'default',
  activeChats: new Map(),
  chatKey: () => ''
}))

function createApp(adapter?: IAgentAdapter): express.Express {
  const app = express()
  app.use(express.json())
  const router = express.Router()
  registerSessionRoutes(router, adapter)
  app.use(router)
  return app
}

describe('POST /agent/sessions/:id/interact-response', () => {
  const sessionId = 'test-session'
  const scope = 'default'

  afterEach(() => {
    interactManager.cancelSession(sessionId, scope)
  })

  it('should return 503 when adapter has no updateSession/getSession', async () => {
    const app = createApp(undefined)
    const { request: req } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: true, paths: ['/a'] })
    expect(res.status).toBe(503)
    expect(res.body.error).toContain('adapter')
    interactManager.resolveRequest(req.requestId, false)
  })

  it('should return 400 when requestId is missing', async () => {
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId, grantedPaths: [] }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)
    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ approved: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('requestId')
  })

  it('should return 400 when requestId is empty string', async () => {
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)
    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: '   ', approved: true })
    expect(res.status).toBe(400)
  })

  it('should return 400 when approved is missing', async () => {
    const { request: req } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)
    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('approved')
    interactManager.resolveRequest(req.requestId, false)
  })

  it('should return 404 when request does not exist', async () => {
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)
    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: 'non-existent-id', approved: true })
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('not found')
  })

  it('should return 403 when request session/scope does not match', async () => {
    const { request: req } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: 'other' }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)
    const res = await request(app)
      .post(`/agent/sessions/other-session/interact-response`)
      .query({ scope: 'default' })
      .send({ requestId: req.requestId, approved: true })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('does not belong')
    interactManager.resolveRequest(req.requestId, false)
  })

  it('should return 200 and resolve approved file_access with grantedPaths', async () => {
    const { request: req, promise } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a', '/b'] }
    )
    const getSession = vi.fn().mockResolvedValue({ id: sessionId, grantedPaths: [] })
    const updateSession = vi.fn().mockResolvedValue(undefined)
    const adapter = { getSession, updateSession } as unknown as IAgentAdapter
    const app = createApp(adapter)

    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: true, paths: ['/a', '/b'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      requestId: req.requestId,
      approved: true,
      grantedPaths: ['/a', '/b']
    })
    expect(updateSession).toHaveBeenCalledWith(scope, sessionId, { grantedPaths: ['/a', '/b'] })
    const response = await promise
    expect(response.approved).toBe(true)
    expect(response.grantedPaths).toEqual(['/a', '/b'])
  })

  it('should return 200 when denied and not persist paths', async () => {
    const { request: req, promise } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const updateSession = vi.fn().mockResolvedValue(undefined)
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId }),
      updateSession
    } as unknown as IAgentAdapter
    const app = createApp(adapter)

    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: false })

    expect(res.status).toBe(200)
    expect(res.body.approved).toBe(false)
    expect(res.body.grantedPaths).toEqual([])
    expect(updateSession).not.toHaveBeenCalled()
    const response = await promise
    expect(response.approved).toBe(false)
  })

  it('should use default paths from request.details when paths not provided and approved', async () => {
    const { request: req, promise } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/default/path'] }
    )
    const getSession = vi.fn().mockResolvedValue({ id: sessionId, grantedPaths: [] })
    const updateSession = vi.fn().mockResolvedValue(undefined)
    const adapter = { getSession, updateSession } as unknown as IAgentAdapter
    const app = createApp(adapter)

    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: true })

    expect(res.status).toBe(200)
    expect(res.body.grantedPaths).toEqual(['/default/path'])
    expect(updateSession).toHaveBeenCalledWith(scope, sessionId, {
      grantedPaths: ['/default/path']
    })
    await promise
  })

  it('should return 404 when request already resolved (pending removed)', async () => {
    const { request: req, promise } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const adapter = {
      getSession: vi.fn().mockResolvedValue({ id: sessionId }),
      updateSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as IAgentAdapter
    const app = createApp(adapter)

    const first = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: true, paths: ['/a'] })
    expect(first.status).toBe(200)
    await promise

    const second = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({ requestId: req.requestId, approved: false })
    expect(second.status).toBe(404)
    expect(second.body.error).toContain('not found')
  })

  it('should filter out non-string and empty paths', async () => {
    const { request: req, promise } = interactManager.createRequest(
      sessionId,
      scope,
      'tc1',
      'prizm_file',
      { kind: 'file_access', paths: ['/a'] }
    )
    const getSession = vi.fn().mockResolvedValue({ id: sessionId, grantedPaths: [] })
    const updateSession = vi.fn().mockResolvedValue(undefined)
    const adapter = { getSession, updateSession } as unknown as IAgentAdapter
    const app = createApp(adapter)

    const res = await request(app)
      .post(`/agent/sessions/${sessionId}/interact-response`)
      .query({ scope })
      .send({
        requestId: req.requestId,
        approved: true,
        paths: ['/valid', 123, null, '  /trimmed  ', '']
      })

    expect(res.status).toBe(200)
    expect(res.body.grantedPaths).toContain('/valid')
    expect(res.body.grantedPaths).toContain('  /trimmed  ')
    expect(res.body.grantedPaths).not.toContain(123)
    expect(res.body.grantedPaths).not.toContain('')
    await promise
  })
})
