/**
 * Agent 终端工具单元测试
 *
 * 覆盖：
 * - prizm_terminal_execute：正常执行、超时、空命令、缺少 session
 * - prizm_terminal_spawn：正常创建、缺少 session
 * - prizm_terminal_send_keys：正常发送、缺少 terminalId、终端不存在、终端已退出
 * - 输出截断逻辑
 *
 * Mock TerminalSessionManager 来测试工具的编排逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeBuiltinTool } from './builtinTools'
import type { TerminalSession } from '@prizm/shared'

// Mock 整个 terminal manager 模块
const mockManager = {
  executeCommand: vi.fn(),
  createTerminal: vi.fn(),
  getTerminal: vi.fn(),
  getRecentOutput: vi.fn(),
  writeToTerminal: vi.fn(),
  listTerminals: vi.fn(),
  killTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  onOutput: vi.fn(),
  onExit: vi.fn(),
  cleanupSession: vi.fn(),
  shutdown: vi.fn(),
  totalCount: 0,
  runningCount: 0
}

vi.mock('../terminal/TerminalSessionManager', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../terminal/TerminalSessionManager')>()
  return {
    getTerminalManager: () => mockManager,
    TerminalSessionManager: vi.fn(),
    stripAnsi: orig.stripAnsi
  }
})

// Mock ScopeStore
vi.mock('../core/ScopeStore', () => ({
  DEFAULT_SCOPE: 'default',
  scopeStore: {
    getScopeData: vi.fn().mockReturnValue({
      agentSessions: [{ id: 'session-1' }],
      notes: [],
      groups: [],
      todoLists: [],
      documents: [],
      clipboardItems: []
    }),
    getScopeRootPath: vi.fn().mockReturnValue('/tmp/test-scope'),
    saveScopeData: vi.fn()
  }
}))

// Mock PathProviderCore (used by workspaceResolver)
vi.mock('../core/PathProviderCore', () => ({
  getSessionWorkspaceDir: vi.fn(
    (scopeRoot: string, sessionId: string) =>
      `${scopeRoot}/.prizm/agent-sessions/${sessionId}/workspace`
  )
}))

// Mock mdStore.ensureSessionWorkspace (used by workspaceResolver when workspace='session')
vi.mock('../core/mdStore', () => ({
  ensureSessionWorkspace: vi.fn(
    (scopeRoot: string, sessionId: string) =>
      `${scopeRoot}/.prizm/agent-sessions/${sessionId}/workspace`
  ),
  validateRelativePath: vi.fn().mockReturnValue(true)
}))

// Mock ContextTracker
vi.mock('./ContextTracker', () => ({
  getContextTracker: () => ({
    recordToolUsage: vi.fn(),
    trackActivity: vi.fn(),
    addProvision: vi.fn()
  })
}))

// Mock EverMemService
vi.mock('./EverMemService', () => ({
  getEverMemService: () => null
}))

// Mock skillsManager
vi.mock('../skills/skillsManager', () => ({
  getSkillsManager: () => ({
    listSkills: vi.fn().mockReturnValue([])
  })
}))

function mockTerminalSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
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
    title: 'test',
    status: 'running',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    ...overrides
  }
}

describe('Agent Terminal Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- prizm_terminal_execute ----

  describe('prizm_terminal_execute', () => {
    it('should execute command and return output', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: '$ echo hello\nhello\n',
        exitCode: 0,
        timedOut: false
      })

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'echo hello' },
        'session-1'
      )

      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('退出码: 0')
      expect(result.text).toContain('hello')
      expect(mockManager.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'echo hello',
          agentSessionId: 'session-1',
          scope: 'default'
        })
      )
    })

    it('should report timeout', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: 'partial output...',
        exitCode: -1,
        timedOut: true
      })

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'sleep 100', timeout: 5 },
        'session-1'
      )

      expect(result.text).toContain('超时')
      expect(result.text).toContain('5s')
    })

    it('should return error for empty command', async () => {
      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: '' },
        'session-1'
      )

      expect(result.isError).toBe(true)
      expect(result.text).toContain('请提供')
    })

    it('should return error without session', async () => {
      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'echo hello' }
        // 不传 sessionId
      )

      expect(result.isError).toBe(true)
      expect(result.text).toContain('会话')
    })

    it('should truncate very long output', async () => {
      const longOutput = 'x'.repeat(20000)
      mockManager.executeCommand.mockResolvedValue({
        output: longOutput,
        exitCode: 0,
        timedOut: false
      })

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'cat large-file' },
        'session-1'
      )

      expect(result.text).toContain('输出已截断')
      expect(result.text.length).toBeLessThan(longOutput.length)
    })

    it('should use session workspace when workspace="session"', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: 'session output',
        exitCode: 0,
        timedOut: false
      })

      await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'ls', workspace: 'session' },
        'session-1'
      )

      expect(mockManager.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('agent-sessions/session-1/workspace')
        })
      )
    })

    it('should use scope root when workspace="main" (default)', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: 'main output',
        exitCode: 0,
        timedOut: false
      })

      await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'ls', workspace: 'main' },
        'session-1'
      )

      expect(mockManager.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/test-scope'
        })
      )
    })

    it('should resolve cwd relative to session workspace', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: '',
        exitCode: 0,
        timedOut: false
      })

      await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'ls', cwd: 'subdir', workspace: 'session' },
        'session-1'
      )

      const calledCwd: string = mockManager.executeCommand.mock.calls[0][0].cwd
      expect(calledCwd).toContain('subdir')
      expect(calledCwd).toContain('agent-sessions')
      expect(calledCwd).toContain('session-1')
      expect(calledCwd).toContain('workspace')
    })

    it('should cap timeout at 300 seconds', async () => {
      mockManager.executeCommand.mockResolvedValue({
        output: '',
        exitCode: 0,
        timedOut: false
      })

      await executeBuiltinTool(
        'default',
        'prizm_terminal_execute',
        { command: 'echo hi', timeout: 999 },
        'session-1'
      )

      expect(mockManager.executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 300 * 1000
        })
      )
    })
  })

  // ---- prizm_terminal_spawn ----

  describe('prizm_terminal_spawn', () => {
    it('should create persistent terminal', async () => {
      mockManager.createTerminal.mockReturnValue(
        mockTerminalSession({ id: 'term-new', title: 'Dev Server' })
      )

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_spawn',
        { title: 'Dev Server' },
        'session-1'
      )

      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('Dev Server')
      expect(result.text).toContain('term-new')
      expect(mockManager.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSessionId: 'session-1',
          scope: 'default',
          title: 'Dev Server',
          sessionType: 'interactive'
        })
      )
    })

    it('should return error without session', async () => {
      const result = await executeBuiltinTool('default', 'prizm_terminal_spawn', { title: 'test' })

      expect(result.isError).toBe(true)
      expect(result.text).toContain('会话')
    })

    it('should handle cwd parameter', async () => {
      mockManager.createTerminal.mockReturnValue(mockTerminalSession())

      await executeBuiltinTool('default', 'prizm_terminal_spawn', { cwd: 'subdir' }, 'session-1')

      expect(mockManager.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('subdir')
        })
      )
    })

    it('should use session workspace when workspace="session"', async () => {
      mockManager.createTerminal.mockReturnValue(mockTerminalSession())

      await executeBuiltinTool(
        'default',
        'prizm_terminal_spawn',
        { workspace: 'session' },
        'session-1'
      )

      expect(mockManager.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('agent-sessions/session-1/workspace')
        })
      )
    })

    it('should resolve cwd relative to session workspace', async () => {
      mockManager.createTerminal.mockReturnValue(mockTerminalSession())

      await executeBuiltinTool(
        'default',
        'prizm_terminal_spawn',
        { cwd: 'src', workspace: 'session' },
        'session-1'
      )

      const calledCwd: string = mockManager.createTerminal.mock.calls[0][0].cwd
      expect(calledCwd).toContain('agent-sessions')
      expect(calledCwd).toContain('session-1')
      expect(calledCwd).toContain('workspace')
      expect(calledCwd).toContain('src')
    })
  })

  // ---- prizm_terminal_send_keys ----

  describe('prizm_terminal_send_keys', () => {
    it('should send input and return new output', async () => {
      mockManager.getTerminal.mockReturnValue(mockTerminalSession())
      mockManager.getRecentOutput
        .mockReturnValueOnce('old output')
        .mockReturnValueOnce('old outputnew output from command')

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'term-1', input: 'ls -la' },
        'session-1'
      )

      expect(result.isError).toBeFalsy()
      expect(result.text).toContain('new output from command')
      // pressEnter 默认 true，会在 input 后追加 \r
      expect(mockManager.writeToTerminal).toHaveBeenCalledWith('term-1', 'ls -la\r')
    })

    it('should return error for empty terminalId', async () => {
      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: '', input: 'test' },
        'session-1'
      )

      expect(result.isError).toBe(true)
      expect(result.text).toContain('terminalId')
    })

    it('should return error for non-existent terminal', async () => {
      mockManager.getTerminal.mockReturnValue(undefined)

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'nonexistent', input: 'test' },
        'session-1'
      )

      expect(result.isError).toBe(true)
      expect(result.text).toContain('不存在')
    })

    it('should return error for exited terminal', async () => {
      mockManager.getTerminal.mockReturnValue(
        mockTerminalSession({ status: 'exited', exitCode: 1 })
      )

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'term-1', input: 'test' },
        'session-1'
      )

      expect(result.isError).toBe(true)
      expect(result.text).toContain('已退出')
    })

    it('should report no new output', async () => {
      mockManager.getTerminal.mockReturnValue(mockTerminalSession())
      mockManager.getRecentOutput
        .mockReturnValueOnce('same output')
        .mockReturnValueOnce('same output')

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'term-1', input: '\n' },
        'session-1'
      )

      expect(result.text).toContain('无新输出')
    })

    it('should accept custom waitMs without error', async () => {
      mockManager.getTerminal.mockReturnValue(mockTerminalSession())
      mockManager.getRecentOutput.mockReturnValue('output')

      // 使用较小的 waitMs 以避免测试超时
      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'term-1', input: 'test', waitMs: 100 },
        'session-1'
      )

      expect(result.isError).toBeFalsy()
    })

    it('should truncate very long output', async () => {
      mockManager.getTerminal.mockReturnValue(mockTerminalSession())
      const longNew = 'y'.repeat(20000)
      mockManager.getRecentOutput
        .mockReturnValueOnce('prefix')
        .mockReturnValueOnce('prefix' + longNew)

      const result = await executeBuiltinTool(
        'default',
        'prizm_terminal_send_keys',
        { terminalId: 'term-1', input: 'cat bigfile\n' },
        'session-1'
      )

      expect(result.text.length).toBeLessThanOrEqual(8192 + 100)
    })
  })
})
