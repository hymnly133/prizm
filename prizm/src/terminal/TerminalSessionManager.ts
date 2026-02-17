/**
 * TerminalSessionManager
 * 核心终端管理器 — 持有所有 PTY 实例，负责生命周期管理
 *
 * 设计要点：
 * - 终端作为 Agent Session 的子资源，通过 agentSessionId 归属
 * - 滚动输出缓冲区用于 Agent 工具读取和客户端重连回放
 * - 限额控制 + 空闲超时 + 最大生命周期 + 定时 reaper
 * - 环境变量安全剥离
 *
 * 架构优化 (v2)：
 * - exec 终端使用复用 worker 池（ExecWorkerPool），每个 session 按工作区类型最多两个常驻 exec shell
 * - 限额只计算 interactive 终端，exec 不计入
 * - 所有终端输出额外写入日志文件（.prizm-data/terminal-logs/）
 */

import * as pty from 'node-pty'
import * as path from 'path'
import type { TerminalSession, CreateTerminalOptions, TerminalSessionType } from '@prizm/shared'
import { createLogger } from '../logger'
import { resolveDefaultShell } from './shellDetector'
import {
  MAX_INTERACTIVE_PER_SESSION,
  MAX_INTERACTIVE_TOTAL,
  IDLE_TIMEOUT_MS,
  MAX_LIFETIME_MS,
  REAPER_INTERVAL_MS,
  OUTPUT_BUFFER_MAX_SIZE,
  SHUTDOWN_GRACE_MS,
  sanitizeEnv,
  stripAnsi,
  generateId,
  isAllowedShell,
  type Disposable,
  type ExecWorkspaceType,
  type ExecRecord,
  type ExecWorkerInfo
} from './terminalConstants'
import { createLogStream } from './terminalLogger'
import { ExecWorkerPool } from './ExecWorkerPool'

const logger = createLogger('TerminalManager')

// ============ 内部类型（依赖 pty，保留在此） ============

interface ManagedTerminal {
  session: TerminalSession
  ptyProcess: pty.IPty
  outputBuffer: string
  outputListeners: Set<(data: string) => void>
  exitListeners: Set<(exitCode: number, signal?: number) => void>
  dataDisposable: pty.IDisposable
  exitDisposable: pty.IDisposable
  logStream: import('fs').WriteStream | null
}

// ============ 重导出（保持对外 API 不变） ============

export type { Disposable, ExecWorkspaceType, ExecRecord, ExecWorkerInfo }
export { isAllowedShell, sanitizeEnv, stripAnsi }

// ============ TerminalSessionManager ============

export class TerminalSessionManager {
  private terminals = new Map<string, ManagedTerminal>()
  private readonly execPool = new ExecWorkerPool()
  private reaperTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor() {
    this.startReaper()
  }

  // ================================================================
  //  Interactive 终端
  // ================================================================

  createTerminal(opts: CreateTerminalOptions): TerminalSession {
    if (this.disposed) {
      throw new Error('TerminalSessionManager is disposed')
    }

    const interactiveCount = this.getInteractiveCount()
    if (interactiveCount >= MAX_INTERACTIVE_TOTAL) {
      throw new Error(`全局终端数已达上限 (${MAX_INTERACTIVE_TOTAL})`)
    }

    const sessionInteractive = this.listTerminals(opts.agentSessionId).filter(
      (t) => t.sessionType === 'interactive'
    )
    if (sessionInteractive.length >= MAX_INTERACTIVE_PER_SESSION) {
      throw new Error(`此会话终端数已达上限 (${MAX_INTERACTIVE_PER_SESSION})`)
    }

    const shell = opts.shell || resolveDefaultShell()
    if (!isAllowedShell(shell)) {
      throw new Error(`不允许的 shell: ${shell}`)
    }

    const cols = opts.cols ?? 80
    const rows = opts.rows ?? 24
    const cwd = opts.cwd || process.cwd()
    const resolvedCwd = path.resolve(cwd)

    const id = generateId()
    const now = Date.now()
    const sessionType: TerminalSessionType = opts.sessionType ?? 'interactive'

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolvedCwd,
        env: sanitizeEnv(process.env)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`无法启动终端进程: ${msg}`)
    }

    const session: TerminalSession = {
      id,
      agentSessionId: opts.agentSessionId,
      scope: opts.scope,
      sessionType,
      shell,
      cwd: resolvedCwd,
      cols,
      rows,
      pid: ptyProcess.pid,
      title: opts.title || shell,
      status: 'running',
      createdAt: now,
      lastActivityAt: now
    }

    const logStream = createLogStream(id, sessionType)

    const managed: ManagedTerminal = {
      session,
      ptyProcess,
      outputBuffer: '',
      outputListeners: new Set(),
      exitListeners: new Set(),
      dataDisposable: null as unknown as pty.IDisposable,
      exitDisposable: null as unknown as pty.IDisposable,
      logStream
    }

    managed.dataDisposable = ptyProcess.onData((data: string) => {
      managed.outputBuffer += data
      if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX_SIZE) {
        managed.outputBuffer = managed.outputBuffer.slice(-OUTPUT_BUFFER_MAX_SIZE)
      }
      managed.session.lastActivityAt = Date.now()
      if (managed.logStream && !managed.logStream.destroyed) {
        managed.logStream.write(data)
      }
      for (const listener of managed.outputListeners) {
        try {
          listener(data)
        } catch (err) {
          logger.error('Output listener error:', err)
        }
      }
    })

    managed.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      managed.session.status = 'exited'
      managed.session.exitCode = exitCode
      managed.session.signal = signal
      logger.info(`Terminal ${id} exited: code=${exitCode}, signal=${signal}`)
      if (managed.logStream && !managed.logStream.destroyed) {
        managed.logStream.write(`\n---\n# Exited: code=${exitCode}, signal=${signal}\n`)
        managed.logStream.end()
      }
      for (const listener of managed.exitListeners) {
        try {
          listener(exitCode, signal)
        } catch (err) {
          logger.error('Exit listener error:', err)
        }
      }
    })

    this.terminals.set(id, managed)
    logger.info(
      `Terminal created: ${id} (session=${opts.agentSessionId}, type=${sessionType}, shell=${shell}, pid=${ptyProcess.pid})`
    )
    return { ...session }
  }

  writeToTerminal(termId: string, data: string): void {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    if (managed.session.status !== 'running') throw new Error(`Terminal ${termId} is not running`)
    managed.ptyProcess.write(data)
    managed.session.lastActivityAt = Date.now()
  }

  resizeTerminal(termId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    if (managed.session.status !== 'running') return
    managed.ptyProcess.resize(cols, rows)
    managed.session.cols = cols
    managed.session.rows = rows
  }

  killTerminal(termId: string): void {
    const managed = this.terminals.get(termId)
    if (!managed) return
    this.destroyManagedTerminal(managed)
    this.terminals.delete(termId)
    logger.info(`Terminal killed: ${termId}`)
  }

  getTerminal(termId: string): TerminalSession | undefined {
    const managed = this.terminals.get(termId)
    return managed ? { ...managed.session } : undefined
  }

  listTerminals(agentSessionId: string): TerminalSession[] {
    const results: TerminalSession[] = []
    for (const managed of this.terminals.values()) {
      if (managed.session.agentSessionId === agentSessionId) {
        results.push({ ...managed.session })
      }
    }
    return results.sort((a, b) => a.createdAt - b.createdAt)
  }

  getRecentOutput(termId: string, maxBytes?: number, clean?: boolean): string {
    const managed = this.terminals.get(termId)
    if (!managed) return ''
    let buf = managed.outputBuffer
    if (maxBytes && buf.length > maxBytes) {
      buf = buf.slice(-maxBytes)
    }
    if (clean) {
      buf = stripAnsi(buf)
    }
    return buf
  }

  onOutput(termId: string, cb: (data: string) => void): Disposable {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    managed.outputListeners.add(cb)
    return {
      dispose: () => {
        managed.outputListeners.delete(cb)
      }
    }
  }

  onExit(termId: string, cb: (exitCode: number, signal?: number) => void): Disposable {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    managed.exitListeners.add(cb)
    return {
      dispose: () => {
        managed.exitListeners.delete(cb)
      }
    }
  }

  // ================================================================
  //  Exec Worker 池 — 委托给 ExecWorkerPool
  // ================================================================

  async executeCommand(
    opts: CreateTerminalOptions & {
      command: string
      timeoutMs?: number
      workspaceType?: ExecWorkspaceType
    }
  ): Promise<{ output: string; exitCode: number; timedOut: boolean; execId: string }> {
    return this.execPool.executeCommand(opts)
  }

  getExecWorkerInfos(agentSessionId: string): ExecWorkerInfo[] {
    return this.execPool.getExecWorkerInfos(agentSessionId)
  }

  getExecHistory(agentSessionId?: string, limit?: number): ExecRecord[] {
    return this.execPool.getExecHistory(agentSessionId, limit)
  }

  getExecRecord(execId: string): ExecRecord | undefined {
    return this.execPool.getExecRecord(execId)
  }

  // ================================================================
  //  Session 级联清理
  // ================================================================

  cleanupSession(agentSessionId: string): void {
    const toRemove: string[] = []
    for (const [id, managed] of this.terminals) {
      if (managed.session.agentSessionId === agentSessionId) {
        toRemove.push(id)
      }
    }
    for (const id of toRemove) {
      this.killTerminal(id)
    }

    const workersCleaned = this.execPool.cleanupSession(agentSessionId)
    const total = toRemove.length + workersCleaned
    if (total > 0) {
      logger.info(
        `Cleaned up ${toRemove.length} terminals + ${workersCleaned} exec workers for session ${agentSessionId}`
      )
    }
  }

  // ================================================================
  //  Graceful Shutdown
  // ================================================================

  async shutdown(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.stopReaper()

    const termCount = this.terminals.size
    const workerCount = this.execPool.size
    if (termCount === 0 && workerCount === 0) return

    logger.info(`Shutting down ${termCount} terminals + ${workerCount} exec workers...`)

    for (const managed of this.terminals.values()) {
      if (managed.session.status === 'running') {
        try {
          managed.ptyProcess.kill()
        } catch {
          /* 忽略 */
        }
      }
    }
    this.execPool.killAll()

    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))

    for (const [id, managed] of this.terminals) {
      this.destroyManagedTerminal(managed)
      this.terminals.delete(id)
    }
    this.execPool.shutdown()

    logger.info('All terminals shut down')
  }

  // ================================================================
  //  统计
  // ================================================================

  get totalCount(): number {
    return this.terminals.size
  }

  get interactiveCount(): number {
    return this.getInteractiveCount()
  }

  get runningCount(): number {
    let count = 0
    for (const managed of this.terminals.values()) {
      if (managed.session.status === 'running') count++
    }
    return count
  }

  get execWorkerCount(): number {
    return this.execPool.size
  }

  private getInteractiveCount(): number {
    let count = 0
    for (const managed of this.terminals.values()) {
      if (
        managed.session.sessionType === 'interactive' &&
        managed.session.status === 'running'
      ) {
        count++
      }
    }
    return count
  }

  // ================================================================
  //  内部方法
  // ================================================================

  private destroyManagedTerminal(managed: ManagedTerminal): void {
    try {
      managed.dataDisposable.dispose()
    } catch {
      /* ignore */
    }
    try {
      managed.exitDisposable.dispose()
    } catch {
      /* ignore */
    }
    if (managed.session.status === 'running') {
      try {
        managed.ptyProcess.kill()
      } catch {
        /* ignore */
      }
    }
    if (managed.logStream && !managed.logStream.destroyed) {
      managed.logStream.end()
    }
    managed.outputListeners.clear()
    managed.exitListeners.clear()
    managed.outputBuffer = ''
    managed.session.status = 'exited'
  }

  private startReaper(): void {
    this.reaperTimer = setInterval(() => {
      this.reapIdleTerminals()
      this.execPool.reapIdleExecWorkers()
    }, REAPER_INTERVAL_MS)
    if (this.reaperTimer.unref) {
      this.reaperTimer.unref()
    }
  }

  private stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer)
      this.reaperTimer = null
    }
  }

  private reapIdleTerminals(): void {
    const now = Date.now()
    const toKill: string[] = []

    for (const [id, managed] of this.terminals) {
      if (managed.session.status === 'exited') {
        if (now - managed.session.lastActivityAt > 5 * 60 * 1000) {
          toKill.push(id)
        }
        continue
      }

      if (now - managed.session.lastActivityAt > IDLE_TIMEOUT_MS) {
        logger.info(
          `Reaping idle terminal ${id} (idle ${Math.round(
            (now - managed.session.lastActivityAt) / 1000 / 60
          )}min)`
        )
        toKill.push(id)
        continue
      }

      if (now - managed.session.createdAt > MAX_LIFETIME_MS) {
        logger.info(`Reaping terminal ${id} (exceeded max lifetime)`)
        toKill.push(id)
        continue
      }
    }

    for (const id of toKill) {
      this.killTerminal(id)
    }
  }
}

// ============ 单例 ============

let _instance: TerminalSessionManager | null = null

export function getTerminalManager(): TerminalSessionManager {
  if (!_instance) {
    _instance = new TerminalSessionManager()
  }
  return _instance
}

export function resetTerminalManager(): void {
  if (_instance) {
    _instance.shutdown().catch(() => {})
    _instance = null
  }
}

export {
  resolveDefaultShell,
  getAvailableShells,
  resetShellCache
} from './shellDetector'
