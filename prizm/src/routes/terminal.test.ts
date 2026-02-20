/**
 * Terminal Routes 单元测试
 *
 * 覆盖：
 * - POST   /agent/sessions/:id/terminals      创建终端
 * - GET    /agent/sessions/:id/terminals      列出终端
 * - GET    /agent/sessions/:id/terminals/:id  获取详情
 * - POST   /agent/sessions/:id/terminals/:id/resize  调整尺寸
 * - POST   /agent/sessions/:id/terminals/:id/write   写入输入
 * - DELETE /agent/sessions/:id/terminals/:id  关闭终端
 * - 错误处理（404、400）
 *
 * 使用 express + supertest + mock TerminalSessionManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTerminalRoutes } from './terminal'
import type { TerminalSessionManager } from '../terminal/TerminalSessionManager'
import type { TerminalSession } from '@prizm/shared'

// ---- Mock ----

function createMockSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-1',
    agentSessionId: 'session-1',
    scope: 'default',
    sessionType: 'interactive',
    shell: '/bin/bash',
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    pid: 12345,
    title: 'test terminal',
    status: 'running',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    ...overrides
  }
}

function createMockManager(): TerminalSessionManager {
  return {
    createTerminal: vi.fn().mockReturnValue(createMockSession()),
    listTerminals: vi.fn().mockReturnValue([createMockSession()]),
    getTerminal: vi.fn().mockReturnValue(createMockSession()),
    getRecentOutput: vi.fn().mockReturnValue('recent terminal output'),
    getExecWorkerInfos: vi.fn().mockReturnValue([]),
    getExecHistory: vi.fn().mockReturnValue([]),
    resizeTerminal: vi.fn(),
    writeToTerminal: vi.fn(),
    killTerminal: vi.fn(),
    cleanupSession: vi.fn(),
    onOutput: vi.fn(),
    onExit: vi.fn(),
    shutdown: vi.fn(),
    totalCount: 1,
    runningCount: 1,
    executeCommand: vi.fn()
  } as unknown as TerminalSessionManager
}

// Mock ScopeStore — 模拟 agent session 存在
vi.mock('../core/ScopeStore', () => {
  return {
    DEFAULT_SCOPE: 'default',
    scopeStore: {
      getScopeData: vi.fn().mockReturnValue({
        agentSessions: [{ id: 'session-1', title: 'Test Session' }]
      }),
      getScopeRootPath: vi.fn().mockReturnValue('/tmp/test-scope')
    }
  }
})

// Mock scopeUtils — 跳过权限检查
vi.mock('../scopeUtils', () => ({
  ensureStringParam: (v: unknown) => String(v),
  hasScopeAccess: () => true,
  getScopeFromQuery: (req: { query?: { scope?: string } }) => req?.query?.scope ?? 'default'
}))

// ---- Test Setup ----

function createApp(manager: TerminalSessionManager) {
  const app = express()
  app.use(express.json())
  const router = express.Router()
  createTerminalRoutes(router, manager)
  app.use(router)
  return app
}

// ---- Tests ----

describe('Terminal Routes', () => {
  let manager: TerminalSessionManager
  let app: express.Express

  beforeEach(() => {
    manager = createMockManager()
    app = createApp(manager)
  })

  // ---- POST create ----

  describe('POST /agent/sessions/:id/terminals', () => {
    it('should create a terminal and return 201', async () => {
      const res = await request(app)
        .post('/agent/sessions/session-1/terminals?scope=default')
        .send({})
        .expect(201)

      expect(res.body.terminal).toBeDefined()
      expect(res.body.terminal.id).toBe('term-1')
      expect(manager.createTerminal).toHaveBeenCalled()
    })

    it('should pass body options to manager', async () => {
      await request(app)
        .post('/agent/sessions/session-1/terminals?scope=default')
        .send({ title: 'My Term', cols: 120, rows: 40 })
        .expect(201)

      expect(manager.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSessionId: 'session-1',
          scope: 'default',
          title: 'My Term',
          cols: 120,
          rows: 40
        })
      )
    })

    it('should return 404 for non-existent agent session', async () => {
      const { scopeStore } = await import('../core/ScopeStore')
      ;(scopeStore.getScopeData as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        agentSessions: []
      })

      const res = await request(app)
        .post('/agent/sessions/nonexistent/terminals?scope=default')
        .send({})
        .expect(404)

      expect(res.body.error).toContain('not found')
    })

    it('should return error when manager throws', async () => {
      ;(manager.createTerminal as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('此会话终端数已达上限 (5)')
      })

      const res = await request(app)
        .post('/agent/sessions/session-1/terminals?scope=default')
        .send({})

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.body.error).toBeDefined()
    })
  })

  // ---- GET list ----

  describe('GET /agent/sessions/:id/terminals', () => {
    it('should list terminals', async () => {
      const res = await request(app).get('/agent/sessions/session-1/terminals').expect(200)

      expect(res.body.terminals).toBeDefined()
      expect(Array.isArray(res.body.terminals)).toBe(true)
      expect(manager.listTerminals).toHaveBeenCalledWith('session-1')
    })

    it('should return empty array for session with no terminals', async () => {
      ;(manager.listTerminals as ReturnType<typeof vi.fn>).mockReturnValue([])

      const res = await request(app).get('/agent/sessions/session-1/terminals').expect(200)

      expect(res.body.terminals).toEqual([])
    })
  })

  // ---- GET detail ----

  describe('GET /agent/sessions/:id/terminals/:termId', () => {
    it('should return terminal detail with recent output', async () => {
      const res = await request(app).get('/agent/sessions/session-1/terminals/term-1').expect(200)

      expect(res.body.terminal).toBeDefined()
      expect(res.body.terminal.id).toBe('term-1')
      expect(res.body.recentOutput).toBe('recent terminal output')
    })

    it('should support maxBytes query parameter', async () => {
      await request(app).get('/agent/sessions/session-1/terminals/term-1?maxBytes=1024').expect(200)

      expect(manager.getRecentOutput).toHaveBeenCalledWith('term-1', 1024, true)
    })

    it('should return 404 for non-existent terminal', async () => {
      ;(manager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      const res = await request(app)
        .get('/agent/sessions/session-1/terminals/nonexistent')
        .expect(404)

      expect(res.body.error).toContain('not found')
    })
  })

  // ---- POST resize ----

  describe('POST /agent/sessions/:id/terminals/:termId/resize', () => {
    it('should resize terminal', async () => {
      const res = await request(app)
        .post('/agent/sessions/session-1/terminals/term-1/resize')
        .send({ cols: 120, rows: 40 })
        .expect(200)

      expect(res.body.ok).toBe(true)
      expect(manager.resizeTerminal).toHaveBeenCalledWith('term-1', 120, 40)
    })

    it('should return 400 when missing cols or rows', async () => {
      const res = await request(app)
        .post('/agent/sessions/session-1/terminals/term-1/resize')
        .send({ cols: 120 })
        .expect(400)

      expect(res.body.error).toContain('cols')
    })
  })

  // ---- POST write ----

  describe('POST /agent/sessions/:id/terminals/:termId/write', () => {
    it('should write data to terminal', async () => {
      const res = await request(app)
        .post('/agent/sessions/session-1/terminals/term-1/write')
        .send({ data: 'echo hello\n' })
        .expect(200)

      expect(res.body.ok).toBe(true)
      expect(manager.writeToTerminal).toHaveBeenCalledWith('term-1', 'echo hello\n')
    })

    it('should return 400 when missing data', async () => {
      const res = await request(app)
        .post('/agent/sessions/session-1/terminals/term-1/write')
        .send({})
        .expect(400)

      expect(res.body.error).toContain('data')
    })
  })

  // ---- DELETE kill ----

  describe('DELETE /agent/sessions/:id/terminals/:termId', () => {
    it('should kill terminal', async () => {
      const res = await request(app)
        .delete('/agent/sessions/session-1/terminals/term-1')
        .expect(200)

      expect(res.body.ok).toBe(true)
      expect(manager.killTerminal).toHaveBeenCalledWith('term-1')
    })

    it('should return 404 for non-existent terminal', async () => {
      ;(manager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      const res = await request(app)
        .delete('/agent/sessions/session-1/terminals/nonexistent')
        .expect(404)

      expect(res.body.error).toContain('not found')
    })
  })
})
