/**
 * task.test.ts — Task REST API 路由测试
 *
 * Mock TaskRunner，验证路由 handler 的请求解析和响应格式。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskRun, TaskRunStatus } from '@prizm/shared'

const mockTaskRunner = {
  trigger: vi.fn(),
  triggerSync: vi.fn(),
  cancel: vi.fn(),
  getStatus: vi.fn(),
  list: vi.fn()
}

vi.mock('../core/workflowEngine', () => ({
  getTaskRunner: vi.fn(() => mockTaskRunner)
}))

vi.mock('../core/workflowEngine/resumeStore', () => ({
  deleteTaskRun: vi.fn()
}))

import { createTaskRoutes } from './task'
import { deleteTaskRun } from '../core/workflowEngine/resumeStore'

const mockedDeleteTaskRun = deleteTaskRun as ReturnType<typeof vi.fn>

interface MockRes {
  statusCode: number
  body: unknown
  status: (code: number) => MockRes
  json: (data: unknown) => void
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res },
    json(data: unknown) { res.body = data }
  }
  return res
}

function createMockReq(overrides: {
  method?: string
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  params?: Record<string, unknown>
  headers?: Record<string, string>
} = {}) {
  return {
    method: overrides.method ?? 'GET',
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    headers: overrides.headers ?? {},
    header: vi.fn((name: string) => {
      const h = overrides.headers ?? {}
      return h[name.toLowerCase()] ?? h[name]
    }),
    get: vi.fn((name: string) => {
      const h = overrides.headers ?? {}
      return h[name.toLowerCase()] ?? h[name]
    }),
    scope: 'default',
    clientAuth: { clientId: 'test', allowedScopes: ['*'] }
  }
}

type RouteHandler = (req: unknown, res: unknown) => Promise<void> | void

const routeHandlers = new Map<string, RouteHandler>()

const mockRouter = {
  post: vi.fn((path: string, handler: RouteHandler) => {
    routeHandlers.set(`POST ${path}`, handler)
  }),
  get: vi.fn((path: string, handler: RouteHandler) => {
    routeHandlers.set(`GET ${path}`, handler)
  }),
  delete: vi.fn((path: string, handler: RouteHandler) => {
    routeHandlers.set(`DELETE ${path}`, handler)
  }),
  put: vi.fn(),
  patch: vi.fn(),
  use: vi.fn()
}

vi.mock('../scopeUtils', () => ({
  getScopeForCreate: vi.fn(() => 'default'),
  requireScopeForList: vi.fn((req: unknown, res: unknown) => 'default')
}))

describe('Task REST Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeHandlers.clear()
    createTaskRoutes(mockRouter as never)
  })

  describe('POST /task/run', () => {
    it('异步模式 → 202 + taskId', async () => {
      mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-123' })

      const req = createMockReq({ body: { prompt: '分析数据', mode: 'async' } })
      const res = createMockRes()

      const handler = routeHandlers.get('POST /task/run')!
      await handler(req, res)

      expect(res.statusCode).toBe(202)
      expect(res.body).toEqual({ taskId: 'task-123', status: 'running' })
    })

    it('同步模式 → 200 + 完整 TaskRun', async () => {
      const mockRun: Partial<TaskRun> = {
        id: 'task-sync-1',
        status: 'completed' as TaskRunStatus,
        output: '结果'
      }
      mockTaskRunner.triggerSync.mockResolvedValue(mockRun)

      const req = createMockReq({ body: { prompt: '短任务', mode: 'sync' } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual(mockRun)
    })

    it('缺少 prompt → 400', async () => {
      const req = createMockReq({ body: {} })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(400)
      expect((res.body as Record<string, string>).error).toContain('prompt')
    })

    it('prompt 非字符串 → 400', async () => {
      const req = createMockReq({ body: { prompt: 123 } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(400)
    })

    it('context 为对象 → 正确解析', async () => {
      mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-ctx' })

      const ctx = { key: 'value', nested: { a: 1 } }
      const req = createMockReq({ body: { prompt: '任务', context: ctx } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(202)
      const triggerCall = mockTaskRunner.trigger.mock.calls[0]
      expect(triggerCall[1].context).toEqual(ctx)
    })

    it('context 为合法 JSON 字符串 → 正确解析', async () => {
      mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-ctx' })

      const req = createMockReq({ body: { prompt: '任务', context: '{"key":"value"}' } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(202)
      const triggerCall = mockTaskRunner.trigger.mock.calls[0]
      expect(triggerCall[1].context).toEqual({ key: 'value' })
    })

    it('context 为非法 JSON 字符串 → 400', async () => {
      const req = createMockReq({ body: { prompt: '任务', context: 'not json' } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(400)
      expect((res.body as Record<string, string>).error).toContain('JSON')
    })

    it('默认为异步模式', async () => {
      mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-default' })

      const req = createMockReq({ body: { prompt: '任务' } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      expect(res.statusCode).toBe(202)
      expect(mockTaskRunner.trigger).toHaveBeenCalled()
      expect(mockTaskRunner.triggerSync).not.toHaveBeenCalled()
    })

    it('timeout_seconds 转为 timeoutMs', async () => {
      mockTaskRunner.trigger.mockResolvedValue({ taskId: 'task-to' })

      const req = createMockReq({ body: { prompt: '任务', timeout_seconds: 30 } })
      const res = createMockRes()

      await routeHandlers.get('POST /task/run')!(req, res)

      const triggerCall = mockTaskRunner.trigger.mock.calls[0]
      expect(triggerCall[1].timeoutMs).toBe(30000)
    })
  })

  describe('GET /task/list', () => {
    it('正常列表 → 200 + 数组', () => {
      const tasks = [
        { id: 'task-1', status: 'running' },
        { id: 'task-2', status: 'completed' }
      ]
      mockTaskRunner.list.mockReturnValue(tasks)

      const req = createMockReq({ query: { scope: 'default' } })
      const res = createMockRes()

      routeHandlers.get('GET /task/list')!(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual(tasks)
    })

    it('带 status 筛选 → 传递给 taskRunner.list', () => {
      mockTaskRunner.list.mockReturnValue([])

      const req = createMockReq({ query: { scope: 'default', status: 'running' } })
      const res = createMockRes()

      routeHandlers.get('GET /task/list')!(req, res)

      const listCall = mockTaskRunner.list.mock.calls[0]
      expect(listCall[1].status).toBe('running')
    })
  })

  describe('GET /task/:id', () => {
    it('存在 → 200 + TaskRun', () => {
      const task = { id: 'task-1', status: 'completed', output: '结果' }
      mockTaskRunner.getStatus.mockReturnValue(task)

      const req = createMockReq({ params: { id: 'task-1' } })
      const res = createMockRes()

      routeHandlers.get('GET /task/:id')!(req, res)

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual(task)
    })

    it('不存在 → 404', () => {
      mockTaskRunner.getStatus.mockReturnValue(null)

      const req = createMockReq({ params: { id: 'nonexistent' } })
      const res = createMockRes()

      routeHandlers.get('GET /task/:id')!(req, res)

      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /task/:id', () => {
    it('运行中 → cancel → { cancelled: true }', async () => {
      mockTaskRunner.cancel.mockResolvedValue(true)

      const req = createMockReq({ params: { id: 'task-running' } })
      const res = createMockRes()

      await routeHandlers.get('DELETE /task/:id')!(req, res)

      expect(res.body).toEqual({ cancelled: true })
      expect(mockTaskRunner.cancel).toHaveBeenCalledWith('task-running')
    })

    it('已完成 → delete → { deleted: true }', async () => {
      mockTaskRunner.cancel.mockResolvedValue(false)
      mockedDeleteTaskRun.mockReturnValue(true)

      const req = createMockReq({ params: { id: 'task-done' } })
      const res = createMockRes()

      await routeHandlers.get('DELETE /task/:id')!(req, res)

      expect(res.body).toEqual({ deleted: true })
    })

    it('不存在 → 404', async () => {
      mockTaskRunner.cancel.mockResolvedValue(false)
      mockedDeleteTaskRun.mockReturnValue(false)

      const req = createMockReq({ params: { id: 'task-none' } })
      const res = createMockRes()

      await routeHandlers.get('DELETE /task/:id')!(req, res)

      expect(res.statusCode).toBe(404)
    })
  })
})
