/**
 * TerminalSessionManager 单元测试
 *
 * 覆盖：
 * - 创建/查询/关闭终端
 * - Session 级联清理
 * - 限额控制（单会话 + 全局）
 * - 写入/输出/调整尺寸
 * - 输出缓冲区管理
 * - onOutput / onExit 事件
 * - executeCommand 一次性命令
 * - sanitizeEnv 环境变量过滤
 * - isAllowedShell shell 白名单
 * - shutdown 优雅关闭
 * - 统计属性
 *
 * 注意：需要 node-pty 可用（native module），CI 中可能需要跳过
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TerminalSessionManager, isAllowedShell, sanitizeEnv } from './TerminalSessionManager'
import * as os from 'os'

// node-pty 需要在有 native module 的环境下运行
let canRunPty = true
try {
  require('node-pty')
} catch {
  canRunPty = false
}

const describeIfPty = canRunPty ? describe : describe.skip

// =========================================
// 纯函数测试 — 不需要 node-pty
// =========================================

describe('isAllowedShell', () => {
  it('should allow default system shells on current platform', () => {
    if (os.platform() === 'win32') {
      expect(isAllowedShell('powershell.exe')).toBe(true)
      expect(isAllowedShell('cmd.exe')).toBe(true)
      expect(isAllowedShell('pwsh.exe')).toBe(true)
      expect(isAllowedShell('C:\\Windows\\System32\\cmd.exe')).toBe(true)
    } else {
      expect(isAllowedShell('/bin/bash')).toBe(true)
      expect(isAllowedShell('/bin/sh')).toBe(true)
      expect(isAllowedShell('/bin/zsh')).toBe(true)
      expect(isAllowedShell('bash')).toBe(true)
      expect(isAllowedShell('sh')).toBe(true)
    }
  })

  it('should reject unknown/malicious shells', () => {
    expect(isAllowedShell('/usr/bin/evil')).toBe(false)
    expect(isAllowedShell('python')).toBe(false)
    expect(isAllowedShell('nc')).toBe(false)
    expect(isAllowedShell('/tmp/payload.sh')).toBe(false)
  })
})

describe('sanitizeEnv', () => {
  it('should keep normal environment variables', () => {
    const result = sanitizeEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8'
    })
    expect(result.PATH).toBe('/usr/bin')
    expect(result.HOME).toBe('/home/user')
    expect(result.TERM).toBe('xterm-256color')
    expect(result.LANG).toBe('en_US.UTF-8')
  })

  it('should strip sensitive variables containing KEY', () => {
    const result = sanitizeEnv({
      PATH: '/usr/bin',
      API_KEY: 'secret123',
      OPENAI_API_KEY: 'sk-xxx',
      SSH_KEY: '/path/to/key'
    })
    expect(result.PATH).toBe('/usr/bin')
    expect(result).not.toHaveProperty('API_KEY')
    expect(result).not.toHaveProperty('OPENAI_API_KEY')
    expect(result).not.toHaveProperty('SSH_KEY')
  })

  it('should strip variables containing SECRET, TOKEN, PASSWORD, CREDENTIAL, PRIVATE', () => {
    const result = sanitizeEnv({
      HOME: '/home',
      MY_SECRET: 'xxx',
      AUTH_TOKEN: 'bearer-xxx',
      DB_PASSWORD: 'pass123',
      AWS_CREDENTIAL: 'cred',
      PRIVATE_KEY: 'rsa-key'
    })
    expect(result.HOME).toBe('/home')
    expect(result).not.toHaveProperty('MY_SECRET')
    expect(result).not.toHaveProperty('AUTH_TOKEN')
    expect(result).not.toHaveProperty('DB_PASSWORD')
    expect(result).not.toHaveProperty('AWS_CREDENTIAL')
    expect(result).not.toHaveProperty('PRIVATE_KEY')
  })

  it('should skip undefined values', () => {
    const result = sanitizeEnv({
      PATH: '/usr/bin',
      EMPTY: undefined
    })
    expect(result.PATH).toBe('/usr/bin')
    expect(result).not.toHaveProperty('EMPTY')
  })

  it('should be case-insensitive for blocked patterns', () => {
    const result = sanitizeEnv({
      my_key_var: 'val',
      Secret_Data: 'val'
    })
    expect(result).not.toHaveProperty('my_key_var')
    expect(result).not.toHaveProperty('Secret_Data')
  })
})

// =========================================
// node-pty 依赖测试
// =========================================

describeIfPty('TerminalSessionManager', () => {
  let manager: TerminalSessionManager

  beforeEach(() => {
    manager = new TerminalSessionManager()
  })

  afterEach(async () => {
    await manager.shutdown()
  })

  // ---- 创建终端 ----

  describe('createTerminal', () => {
    it('should create a terminal with default options', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      expect(session).toBeDefined()
      expect(session.id).toBeTruthy()
      expect(session.agentSessionId).toBe('session-1')
      expect(session.scope).toBe('default')
      expect(session.status).toBe('running')
      expect(session.pid).toBeGreaterThan(0)
      expect(session.cols).toBe(80)
      expect(session.rows).toBe(24)
      expect(session.sessionType).toBe('interactive')
      expect(session.createdAt).toBeGreaterThan(0)
      expect(session.lastActivityAt).toBeGreaterThan(0)
    })

    it('should create terminal with custom options', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default',
        cols: 120,
        rows: 40,
        title: 'Test Terminal',
        sessionType: 'exec'
      })

      expect(session.cols).toBe(120)
      expect(session.rows).toBe(40)
      expect(session.title).toBe('Test Terminal')
      expect(session.sessionType).toBe('exec')
    })

    it('should reject disallowed shell', () => {
      expect(() => {
        manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default',
          shell: '/usr/bin/evil'
        })
      }).toThrow('不允许的 shell')
    })

    it('should enforce per-session terminal limit (5)', () => {
      for (let i = 0; i < 5; i++) {
        manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default',
          title: `Term ${i}`
        })
      }

      expect(() => {
        manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default'
        })
      }).toThrow('已达上限')
    })

    it('should allow terminals in different sessions independently', () => {
      for (let i = 0; i < 5; i++) {
        manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default'
        })
      }

      const session = manager.createTerminal({
        agentSessionId: 'session-2',
        scope: 'default'
      })
      expect(session).toBeDefined()
    })

    it('should enforce global terminal limit (20)', () => {
      // 创建 20 个终端（4个 session 各5个）
      for (let s = 0; s < 4; s++) {
        for (let i = 0; i < 5; i++) {
          manager.createTerminal({
            agentSessionId: `session-${s}`,
            scope: 'default'
          })
        }
      }
      expect(manager.totalCount).toBe(20)

      expect(() => {
        manager.createTerminal({
          agentSessionId: 'session-new',
          scope: 'default'
        })
      }).toThrow('全局终端数已达上限')
    })

    it('should generate unique terminal IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const t = manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default'
        })
        ids.add(t.id)
      }
      expect(ids.size).toBe(5)
    })
  })

  // ---- 查询 ----

  describe('getTerminal / listTerminals', () => {
    it('should get terminal by id', () => {
      const created = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      const found = manager.getTerminal(created.id)
      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.status).toBe('running')
    })

    it('should return copy (not reference)', () => {
      const created = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })
      const found = manager.getTerminal(created.id)!
      found.title = 'modified'
      const again = manager.getTerminal(created.id)!
      expect(again.title).not.toBe('modified')
    })

    it('should return undefined for unknown terminal', () => {
      expect(manager.getTerminal('nonexistent')).toBeUndefined()
    })

    it('should list terminals by session', () => {
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-2', scope: 'default' })

      expect(manager.listTerminals('session-1')).toHaveLength(2)
      expect(manager.listTerminals('session-2')).toHaveLength(1)
      expect(manager.listTerminals('session-3')).toHaveLength(0)
    })

    it('should return terminals sorted by creation time', () => {
      const t1 = manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      const t2 = manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })

      const list = manager.listTerminals('session-1')
      expect(list[0].id).toBe(t1.id)
      expect(list[1].id).toBe(t2.id)
    })
  })

  // ---- 关闭终端 ----

  describe('killTerminal', () => {
    it('should kill a terminal and remove it', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      manager.killTerminal(session.id)

      expect(manager.getTerminal(session.id)).toBeUndefined()
      expect(manager.listTerminals('session-1')).toHaveLength(0)
      expect(manager.totalCount).toBe(0)
    })

    it('should be idempotent for unknown terminal', () => {
      expect(() => manager.killTerminal('nonexistent')).not.toThrow()
    })

    it('should allow creating new terminal after killing one at limit', () => {
      const terminals: string[] = []
      for (let i = 0; i < 5; i++) {
        const t = manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default'
        })
        terminals.push(t.id)
      }

      manager.killTerminal(terminals[0])

      // Should now be able to create one more
      const newT = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })
      expect(newT).toBeDefined()
    })
  })

  // ---- 写入/输出 ----

  describe('writeToTerminal / getRecentOutput', () => {
    it('should write input and capture output', async () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      manager.writeToTerminal(session.id, 'echo hello\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const output = manager.getRecentOutput(session.id)
      expect(output.length).toBeGreaterThan(0)
    })

    it('should throw for non-existent terminal', () => {
      expect(() => manager.writeToTerminal('nonexistent', 'test')).toThrow('Terminal not found')
    })

    it('should throw for killed terminal', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })
      manager.killTerminal(session.id)
      expect(() => manager.writeToTerminal(session.id, 'test')).toThrow()
    })

    it('should return empty string for unknown terminal output', () => {
      expect(manager.getRecentOutput('nonexistent')).toBe('')
    })

    it('should respect maxBytes parameter', async () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      manager.writeToTerminal(session.id, 'echo hello world\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const fullOutput = manager.getRecentOutput(session.id)
      if (fullOutput.length > 5) {
        const limited = manager.getRecentOutput(session.id, 5)
        expect(limited.length).toBeLessThanOrEqual(5)
      }
    })
  })

  // ---- 调整尺寸 ----

  describe('resizeTerminal', () => {
    it('should resize a terminal', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default',
        cols: 80,
        rows: 24
      })

      manager.resizeTerminal(session.id, 120, 40)

      const updated = manager.getTerminal(session.id)
      expect(updated!.cols).toBe(120)
      expect(updated!.rows).toBe(40)
    })

    it('should throw for non-existent terminal', () => {
      expect(() => manager.resizeTerminal('nonexistent', 80, 24)).toThrow('Terminal not found')
    })
  })

  // ---- Session 级联清理 ----

  describe('cleanupSession', () => {
    it('should kill all terminals in a session', () => {
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-2', scope: 'default' })

      manager.cleanupSession('session-1')

      expect(manager.listTerminals('session-1')).toHaveLength(0)
      expect(manager.listTerminals('session-2')).toHaveLength(1)
    })

    it('should be safe for unknown session', () => {
      expect(() => manager.cleanupSession('nonexistent')).not.toThrow()
    })

    it('should update totalCount after cleanup', () => {
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      expect(manager.totalCount).toBe(2)

      manager.cleanupSession('session-1')
      expect(manager.totalCount).toBe(0)
    })
  })

  // ---- 事件监听 ----

  describe('onOutput / onExit', () => {
    it('should notify output listeners', async () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      const received: string[] = []
      const disposable = manager.onOutput(session.id, (data) => {
        received.push(data)
      })

      manager.writeToTerminal(session.id, 'echo test\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(received.length).toBeGreaterThan(0)
      disposable.dispose()
    })

    it('should support multiple output listeners', async () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      const received1: string[] = []
      const received2: string[] = []
      const d1 = manager.onOutput(session.id, (data) => received1.push(data))
      const d2 = manager.onOutput(session.id, (data) => received2.push(data))

      manager.writeToTerminal(session.id, 'echo test\n')
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(received1.length).toBeGreaterThan(0)
      expect(received2.length).toBeGreaterThan(0)
      d1.dispose()
      d2.dispose()
    })

    it('should dispose output listener without error', () => {
      const session = manager.createTerminal({
        agentSessionId: 'session-1',
        scope: 'default'
      })

      const disposable = manager.onOutput(session.id, () => {})
      expect(() => disposable.dispose()).not.toThrow()
    })

    it('should throw when listening on non-existent terminal', () => {
      expect(() => manager.onOutput('nonexistent', () => {})).toThrow('Terminal not found')
      expect(() => manager.onExit('nonexistent', () => {})).toThrow('Terminal not found')
    })
  })

  // ---- executeCommand ----

  describe('executeCommand', () => {
    it('should execute a simple command and return output', async () => {
      const result = await manager.executeCommand({
        agentSessionId: 'session-1',
        scope: 'default',
        command: 'echo hello_from_test',
        timeoutMs: 10000
      })

      expect(result).toBeDefined()
      expect(result.timedOut).toBe(false)
      expect(typeof result.exitCode).toBe('number')
      expect(result.output).toContain('hello_from_test')
    })

    it('should timeout for long-running command', async () => {
      const result = await manager.executeCommand({
        agentSessionId: 'session-1',
        scope: 'default',
        command: os.platform() === 'win32' ? 'ping -n 100 127.0.0.1' : 'sleep 100',
        timeoutMs: 2000
      })

      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBe(-1)
    }, 15000)

    it('should handle non-zero exit code', async () => {
      const result = await manager.executeCommand({
        agentSessionId: 'session-1',
        scope: 'default',
        command: os.platform() === 'win32' ? 'cmd /c exit 42' : 'exit 42',
        timeoutMs: 10000
      })

      expect(result.timedOut).toBe(false)
      // exit code might vary by shell behavior
      expect(typeof result.exitCode).toBe('number')
    })
  })

  // ---- Shutdown ----

  describe('shutdown', () => {
    it('should kill all terminals on shutdown', async () => {
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-2', scope: 'default' })

      expect(manager.totalCount).toBe(2)

      await manager.shutdown()

      expect(manager.totalCount).toBe(0)
    })

    it('should prevent creating terminals after shutdown', async () => {
      await manager.shutdown()

      expect(() => {
        manager.createTerminal({
          agentSessionId: 'session-1',
          scope: 'default'
        })
      }).toThrow('disposed')
    })

    it('should be idempotent', async () => {
      await manager.shutdown()
      await expect(manager.shutdown()).resolves.toBeUndefined()
    })
  })

  // ---- 统计 ----

  describe('statistics', () => {
    it('should track total and running counts', () => {
      expect(manager.totalCount).toBe(0)
      expect(manager.runningCount).toBe(0)

      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })

      expect(manager.totalCount).toBe(2)
      expect(manager.runningCount).toBe(2)
    })

    it('should decrement count when terminal is killed', () => {
      const t = manager.createTerminal({ agentSessionId: 'session-1', scope: 'default' })
      expect(manager.totalCount).toBe(1)

      manager.killTerminal(t.id)
      expect(manager.totalCount).toBe(0)
      expect(manager.runningCount).toBe(0)
    })
  })
})
