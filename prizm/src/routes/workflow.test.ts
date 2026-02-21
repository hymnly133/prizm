/**
 * workflow.test.ts — 工作流 REST 路由测试
 *
 * 覆盖：
 * - POST /workflow/defs/:id/management-session：创建/返回工作流管理会话（幂等、鉴权、错误码）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { WORKFLOW_MANAGEMENT_SOURCE } from '@prizm/shared'

const mockGetDefById = vi.fn()
const mockGetDefMeta = vi.fn()
const mockGetDefMetaByDefId = vi.fn()
const mockUpdateDefMeta = vi.fn()
const mockUpdateDefMetaByDefId = vi.fn()
const mockListDefs = vi.fn()

vi.mock('../core/workflowEngine/workflowDefStore', () => ({
  getDefById: (id: string) => mockGetDefById(id),
  getDefMeta: (name: string, scope: string) => mockGetDefMeta(name, scope),
  getDefMetaByDefId: (id: string) => mockGetDefMetaByDefId(id),
  updateDefMeta: (name: string, scope: string, patch: unknown) =>
    mockUpdateDefMeta(name, scope, patch),
  updateDefMetaByDefId: (id: string, patch: unknown) => mockUpdateDefMetaByDefId(id, patch),
  listDefs: (scope?: string) => mockListDefs(scope)
}))

const mockGetScopeFromQuery = vi.fn()
const mockHasScopeAccess = vi.fn()
const mockEnsureStringParam = vi.fn()
const mockRequireScopeForList = vi.fn()

vi.mock('../scopeUtils', () => ({
  getScopeFromQuery: (req: Request) => mockGetScopeFromQuery(req),
  hasScopeAccess: (req: Request, scope: string) => mockHasScopeAccess(req, scope),
  ensureStringParam: (v: string | string[] | undefined) => mockEnsureStringParam(v),
  requireScopeForList: (req: Request, res: Response) => mockRequireScopeForList(req, res)
}))

const mockCreateSession = vi.fn()
const mockUpdateSession = vi.fn()

const mockAgentAdapter = {
  createSession: mockCreateSession,
  updateSession: mockUpdateSession
}

const routeHandlers = new Map<string, (req: Request, res: Response) => Promise<void> | void>()

const mockRouter = {
  get: vi.fn((path: string, handler: (req: Request, res: Response) => void) => {
    routeHandlers.set(`GET ${path}`, handler as (req: Request, res: Response) => Promise<void> | void)
  }),
  post: vi.fn((path: string, handler: (req: Request, res: Response) => void) => {
    routeHandlers.set(`POST ${path}`, handler as (req: Request, res: Response) => Promise<void> | void)
  }),
  delete: vi.fn(),
  put: vi.fn(),
  patch: vi.fn((path: string, handler: (req: Request, res: Response) => void) => {
    routeHandlers.set(`PATCH ${path}`, handler as (req: Request, res: Response) => Promise<void> | void)
  }),
  use: vi.fn()
}

import { createWorkflowRoutes } from './workflow'

function createMockReq(overrides: {
  params?: Record<string, string | string[]>
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
} = {}) {
  return {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    body: overrides.body,
    header: vi.fn((name: string) => (overrides.headers ?? {})[name.toLowerCase()]),
    get: vi.fn((name: string) => (overrides.headers ?? {})[name.toLowerCase()])
  } as unknown as Request
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
    }
  }
  return res
}

const DEF_ID = 'def-123'
const DEF_NAME = 'my-workflow'
const SCOPE = 'default'

describe('Workflow REST Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeHandlers.clear()
    mockHasScopeAccess.mockReturnValue(true)
    mockCreateSession.mockResolvedValue({ id: 'new-session-1' })
    mockUpdateSession.mockResolvedValue(undefined)
    mockUpdateDefMetaByDefId.mockReturnValue(true)
  })

  describe('POST /workflow/defs/:id/management-session', () => {
    beforeEach(() => {
      createWorkflowRoutes(mockRouter as never, mockAgentAdapter as never)
    })

    it('缺少 definition id 时返回 400', async () => {
      mockEnsureStringParam.mockReturnValue(undefined)

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      const handler = routeHandlers.get('POST /workflow/defs/:id/management-session')!
      await handler(req, res)

      expect(res.statusCode).toBe(400)
      expect((res.body as { error?: string })?.error).toContain('definition id')
    })

    it('definition 不存在时返回 404', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue(null)

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(404)
      expect((res.body as { error?: string })?.error).toContain('not found')
    })

    it('请求 scope 与定义 scope 不一致时返回 403', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue({ id: DEF_ID, name: DEF_NAME, scope: SCOPE })
      mockGetScopeFromQuery.mockReturnValue('other-scope')

      const req = createMockReq({ params: { id: DEF_ID }, query: { scope: 'other-scope' } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(403)
      expect((res.body as { error?: string })?.error).toContain('scope does not match')
    })

    it('无 scope 访问权限时返回 403', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue({ id: DEF_ID, name: DEF_NAME, scope: SCOPE })
      mockGetScopeFromQuery.mockReturnValue(SCOPE)
      mockHasScopeAccess.mockReturnValue(false)

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(403)
      expect((res.body as { error?: string })?.error).toContain('scope')
    })

    it('已有 workflowManagementSessionId 时幂等返回 200 和现有 sessionId', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue({ id: DEF_ID, name: DEF_NAME, scope: SCOPE })
      mockGetScopeFromQuery.mockReturnValue(null)
      mockGetDefMetaByDefId.mockReturnValue({ id: DEF_ID, workflowManagementSessionId: 'existing-sess-99' })
      mockAgentAdapter.getSession = vi.fn().mockResolvedValue({ id: 'existing-sess-99' })

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ sessionId: 'existing-sess-99' })
      expect(mockCreateSession).not.toHaveBeenCalled()
      expect(mockUpdateDefMetaByDefId).not.toHaveBeenCalled()
    })

    it('无现有会话时创建新会话并返回 201', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue({ id: DEF_ID, name: DEF_NAME, scope: SCOPE })
      mockGetScopeFromQuery.mockReturnValue(null)
      mockGetDefMetaByDefId.mockReturnValue({ id: DEF_ID })

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(201)
      expect(res.body).toEqual({ sessionId: 'new-session-1' })
      expect(mockCreateSession).toHaveBeenCalledWith(SCOPE)
      expect(mockUpdateDefMetaByDefId).toHaveBeenCalledWith(DEF_ID, {
        workflowManagementSessionId: 'new-session-1'
      })
      expect(mockUpdateSession).toHaveBeenCalledWith(
        SCOPE,
        'new-session-1',
        expect.objectContaining({
          kind: 'tool',
          toolMeta: expect.objectContaining({
            source: WORKFLOW_MANAGEMENT_SOURCE,
            label: `工作流管理：${DEF_NAME}`,
            workflowDefId: DEF_ID,
            workflowName: DEF_NAME,
            persistentWorkspaceDir: expect.stringContaining('workflows')
          })
        })
      )
    })

    it('无 agentAdapter 时返回 503', async () => {
      routeHandlers.clear()
      createWorkflowRoutes(mockRouter as never, undefined)

      mockEnsureStringParam.mockReturnValue(DEF_ID)
      mockGetDefById.mockReturnValue({ id: DEF_ID, name: DEF_NAME, scope: SCOPE })
      mockGetDefMetaByDefId.mockReturnValue({ id: DEF_ID })

      const req = createMockReq({ params: { id: DEF_ID } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)

      expect(res.statusCode).toBe(503)
      expect((res.body as { error?: string })?.error).toContain('Agent adapter')
    })

    it('params.id 为数组时 ensureStringParam 返回空则 400', async () => {
      mockEnsureStringParam.mockReturnValue(undefined)
      const req = createMockReq({ params: { id: ['a', 'b'] as unknown as string } })
      const res = createMockRes()
      await routeHandlers.get('POST /workflow/defs/:id/management-session')!(req, res)
      expect(mockEnsureStringParam).toHaveBeenCalled()
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /workflow/defs（自动修复单向引用）', () => {
    const SCOPE_DEFAULT = 'default'

    beforeEach(() => {
      vi.clearAllMocks()
      mockRequireScopeForList.mockReturnValue(SCOPE_DEFAULT)
      mockHasScopeAccess.mockReturnValue(true)
      createWorkflowRoutes(mockRouter as never, mockAgentAdapter as never)
    })

    it('session 不存在时清除 def 的 workflowManagementSessionId', async () => {
      mockListDefs.mockReturnValue([
        { id: 'd1', name: 'w1', scope: SCOPE_DEFAULT, workflowManagementSessionId: 'dead-sess' }
      ])
      mockAgentAdapter.getSession = vi.fn().mockResolvedValue(null)

      const req = createMockReq({ query: { scope: SCOPE_DEFAULT } })
      const res = createMockRes()
      const handler = routeHandlers.get('GET /workflow/defs')
      await handler!(req, res)

      expect(res.statusCode).toBe(200)
      expect(mockUpdateDefMetaByDefId).toHaveBeenCalledWith('d1', { workflowManagementSessionId: undefined })
      expect((res.body as { workflowManagementSessionId?: string }[])[0].workflowManagementSessionId).toBeUndefined()
    })

    it('session 存在但不指回该 def 时清除单向引用', async () => {
      mockListDefs.mockReturnValue([
        { id: 'd1', name: 'w1', scope: SCOPE_DEFAULT, workflowManagementSessionId: 'sess-other' }
      ])
      mockAgentAdapter.getSession = vi.fn().mockResolvedValue({
        id: 'sess-other',
        toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE, workflowDefId: 'other-def' }
      })

      const req = createMockReq({ query: { scope: SCOPE_DEFAULT } })
      const res = createMockRes()
      const handler = routeHandlers.get('GET /workflow/defs')
      await handler!(req, res)

      expect(mockUpdateDefMetaByDefId).toHaveBeenCalledWith('d1', { workflowManagementSessionId: undefined })
      expect((res.body as { workflowManagementSessionId?: string }[])[0].workflowManagementSessionId).toBeUndefined()
    })

    it('session 指回该 def 时保留引用', async () => {
      mockListDefs.mockReturnValue([
        { id: 'd1', name: 'w1', scope: SCOPE_DEFAULT, workflowManagementSessionId: 'sess-1' }
      ])
      mockAgentAdapter.getSession = vi.fn().mockResolvedValue({
        id: 'sess-1',
        toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE, workflowDefId: 'd1' }
      })

      const req = createMockReq({ query: { scope: SCOPE_DEFAULT } })
      const res = createMockRes()
      const handler = routeHandlers.get('GET /workflow/defs')
      await handler!(req, res)

      expect(mockUpdateDefMetaByDefId).not.toHaveBeenCalled()
      expect((res.body as { workflowManagementSessionId?: string }[])[0].workflowManagementSessionId).toBe('sess-1')
    })

    it('def 无 session 引用且 session 指向该 def 时从 session 侧补全', async () => {
      mockListDefs
        .mockReturnValueOnce([{ id: 'd1', name: 'w1', scope: SCOPE_DEFAULT }])
        .mockReturnValueOnce([
          { id: 'd1', name: 'w1', scope: SCOPE_DEFAULT, workflowManagementSessionId: 'sess-1' }
        ])
      mockGetDefById.mockImplementation((id: string) =>
        id === 'd1' ? { id: 'd1', name: 'w1', scope: SCOPE_DEFAULT } : null
      )
      mockAgentAdapter.getSession = vi.fn().mockResolvedValue(null)
      mockAgentAdapter.listSessions = vi.fn().mockResolvedValue([
        {
          id: 'sess-1',
          scope: SCOPE_DEFAULT,
          kind: 'tool',
          toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE, workflowDefId: 'd1' }
        }
      ])

      const req = createMockReq({ query: { scope: SCOPE_DEFAULT } })
      const res = createMockRes()
      const handler = routeHandlers.get('GET /workflow/defs')
      await handler!(req, res)

      expect(mockUpdateDefMetaByDefId).toHaveBeenCalledWith('d1', { workflowManagementSessionId: 'sess-1' })
      expect(mockListDefs).toHaveBeenCalledTimes(2)
      expect((res.body as { workflowManagementSessionId?: string }[])[0].workflowManagementSessionId).toBe('sess-1')
    })
  })

  describe('PATCH /workflow/defs/:id', () => {
    beforeEach(() => {
      createWorkflowRoutes(mockRouter as never, mockAgentAdapter as never)
    })

    it('可更新 descriptionDocumentId 并返回 200', async () => {
      mockEnsureStringParam.mockReturnValue(DEF_ID)
      const defRecord = { id: DEF_ID, name: DEF_NAME, scope: SCOPE }
      mockGetDefById.mockReturnValue(defRecord)

      const req = createMockReq({ params: { id: DEF_ID }, body: { descriptionDocumentId: 'doc-usage-1' } })
      const res = createMockRes()
      const patchHandler = routeHandlers.get('PATCH /workflow/defs/:id')
      if (!patchHandler) throw new Error('PATCH handler not registered')
      await patchHandler(req, res)

      expect(res.statusCode).toBe(200)
      expect(mockUpdateDefMeta).toHaveBeenCalledWith(DEF_NAME, SCOPE, { descriptionDocumentId: 'doc-usage-1' })
    })

    it('definition 不存在时返回 404', async () => {
      mockEnsureStringParam.mockReturnValue('nonexistent')
      mockGetDefById.mockReturnValue(null)
      const req = createMockReq({ params: { id: 'nonexistent' }, body: { descriptionDocumentId: 'doc-1' } })
      const res = createMockRes()
      const patchHandler = routeHandlers.get('PATCH /workflow/defs/:id')
      if (!patchHandler) throw new Error('PATCH handler not registered')
      await patchHandler(req, res)
      expect(res.statusCode).toBe(404)
      expect(mockUpdateDefMeta).not.toHaveBeenCalled()
    })
  })
})
