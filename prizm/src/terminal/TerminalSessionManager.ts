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
 * - exec 终端使用复用 worker 池，每个 session 按工作区类型最多两个常驻 exec shell
 *   - main worker: 工作目录为 scope 根目录
 *   - session worker: 工作目录为 session 临时工作区
 * - 限额只计算 interactive 终端，exec 不计入
 * - 所有终端输出额外写入日志文件（.prizm-data/terminal-logs/）
 */

import * as pty from 'node-pty'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import type { TerminalSession, CreateTerminalOptions, TerminalSessionType } from '@prizm/shared'
import { createLogger } from '../logger'
import { resolveDefaultShell } from './shellDetector'
import { getDataDir, ensureDataDir } from '../core/PathProviderCore'

const logger = createLogger('TerminalManager')

// ============ 配置常量 ============

/** 单 Agent Session 最大 **interactive** 终端数 */
const MAX_INTERACTIVE_PER_SESSION = 5
/** 全局最大 **interactive** 终端数 */
const MAX_INTERACTIVE_TOTAL = 20
/** 空闲超时 (ms) — 30 分钟无输入自动 kill */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
/** 最大生命周期 (ms) — 8 小时硬性上限 */
const MAX_LIFETIME_MS = 8 * 60 * 60 * 1000
/** reaper 扫描间隔 (ms) */
const REAPER_INTERVAL_MS = 60 * 1000
/** 输出缓冲区最大大小 (bytes) */
const OUTPUT_BUFFER_MAX_SIZE = 100 * 1024
/** Graceful shutdown 等待时间 (ms) */
const SHUTDOWN_GRACE_MS = 3000
/** Exec worker 空闲超时 (ms) — 10 分钟无执行自动回收 */
const EXEC_WORKER_IDLE_MS = 10 * 60 * 1000

/** 需要从 env 中剥离的关键词（大写比较） */
const BLOCKED_ENV_PATTERNS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'PRIVATE']

// ============ 内部类型 ============

export interface Disposable {
  dispose(): void
}

interface ManagedTerminal {
  /** 对外暴露的 session 信息 */
  session: TerminalSession
  /** node-pty 实例 */
  ptyProcess: pty.IPty
  /** 滚动输出缓冲区 */
  outputBuffer: string
  /** 输出事件监听器 */
  outputListeners: Set<(data: string) => void>
  /** 退出事件监听器 */
  exitListeners: Set<(exitCode: number, signal?: number) => void>
  /** node-pty onData disposable */
  dataDisposable: pty.IDisposable
  /** node-pty onExit disposable */
  exitDisposable: pty.IDisposable
  /** 日志文件写入流 */
  logStream: fs.WriteStream | null
}

/** 工作区类型：main = scope 根目录, session = session 临时工作区 */
export type ExecWorkspaceType = 'main' | 'session'

/** Exec Worker：每个 agent session + 工作区类型 复用的一次性命令执行器 */
interface ExecWorker {
  /** 对应的 agent session ID */
  agentSessionId: string
  scope: string
  /** 工作区类型 */
  workspaceType: ExecWorkspaceType
  /** node-pty 实例 */
  ptyProcess: pty.IPty
  /** shell 路径 */
  shell: string
  /** 工作目录 */
  cwd: string
  /** 是否正在执行命令 */
  busy: boolean
  /** 最后活动时间 */
  lastActivityAt: number
  /** 创建时间 */
  createdAt: number
  /** onData disposable */
  dataDisposable: pty.IDisposable
  /** onExit disposable */
  exitDisposable: pty.IDisposable
  /** 是否已退出 */
  exited: boolean
}

/** 生成 exec worker 的复合 key */
function execWorkerKey(agentSessionId: string, workspaceType: ExecWorkspaceType): string {
  return `${agentSessionId}:${workspaceType}`
}

/** 单次 exec 命令的历史记录 */
export interface ExecRecord {
  id: string
  agentSessionId: string
  /** 该命令在哪个工作区执行的 */
  workspaceType: ExecWorkspaceType
  command: string
  output: string
  exitCode: number
  timedOut: boolean
  startedAt: number
  finishedAt: number
}

/** Exec Worker 对外暴露的状态信息 */
export interface ExecWorkerInfo {
  agentSessionId: string
  /** 工作区类型 */
  workspaceType: ExecWorkspaceType
  shell: string
  cwd: string
  pid: number
  busy: boolean
  exited: boolean
  createdAt: number
  lastActivityAt: number
  /** 该 worker 下已执行的命令总数 */
  commandCount: number
}

// ============ 工具函数 ============

function generateId(): string {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 获取默认 shell — 委托给 shellDetector
 * 优先级：用户设置 > 自动检测 (pwsh > powershell > cmd / $SHELL > bash)
 */
function getDefaultShell(): string {
  return resolveDefaultShell()
}

/**
 * Shell 白名单
 */
const ALLOWED_SHELLS_WIN = ['powershell.exe', 'pwsh.exe', 'cmd.exe']
const ALLOWED_SHELLS_UNIX = [
  '/bin/bash',
  '/bin/sh',
  '/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  'bash',
  'sh',
  'zsh'
]

export function isAllowedShell(shell: string): boolean {
  const normalized = shell.toLowerCase()
  if (os.platform() === 'win32') {
    return ALLOWED_SHELLS_WIN.some((s) => normalized.endsWith(s))
  }
  return ALLOWED_SHELLS_UNIX.some((s) => normalized === s || normalized.endsWith('/' + s))
}

/**
 * 过滤环境变量 — 剥离敏感信息
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upperKey = key.toUpperCase()
    const isBlocked = BLOCKED_ENV_PATTERNS.some((p) => upperKey.includes(p))
    if (!isBlocked) {
      safe[key] = value
    }
  }
  return safe
}

/** 确保终端日志目录存在，返回路径 */
function ensureTerminalLogsDir(): string {
  ensureDataDir()
  const dir = path.join(getDataDir(), 'terminal-logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 为终端创建日志文件写入流 */
function createLogStream(termId: string, sessionType: TerminalSessionType): fs.WriteStream | null {
  try {
    const dir = ensureTerminalLogsDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${sessionType}_${termId}_${ts}.log`
    const filePath = path.join(dir, filename)
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
    stream.write(
      `# Terminal Log: ${termId}\n# Type: ${sessionType}\n# Started: ${new Date().toISOString()}\n---\n`
    )
    return stream
  } catch (err) {
    logger.error('Failed to create terminal log file:', err)
    return null
  }
}

/** 为 exec 命令创建日志文件写入流 */
function createExecLogStream(execId: string): fs.WriteStream | null {
  try {
    const dir = ensureTerminalLogsDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `exec_${execId}_${ts}.log`
    const filePath = path.join(dir, filename)
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
    return stream
  } catch (err) {
    logger.error('Failed to create exec log file:', err)
    return null
  }
}

// ============ TerminalSessionManager ============

export class TerminalSessionManager {
  /** interactive 终端 */
  private terminals = new Map<string, ManagedTerminal>()
  /** exec worker 池：`${agentSessionId}:${workspaceType}` → ExecWorker */
  private execWorkers = new Map<string, ExecWorker>()
  /** exec 命令历史（最近 N 条，供事后查询） */
  private execHistory: ExecRecord[] = []
  private readonly maxExecHistory = 200
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

    // exec 类型走 worker 池，不在这里创建
    // 但保留兼容：如果外部显式传了 sessionType='exec'，仍按 interactive 对待
    // （exec 命令应走 executeCommand 方法）

    // 全局限额 — 仅计算 interactive 终端
    const interactiveCount = this.getInteractiveCount()
    if (interactiveCount >= MAX_INTERACTIVE_TOTAL) {
      throw new Error(`全局终端数已达上限 (${MAX_INTERACTIVE_TOTAL})`)
    }

    // 单 Session 限额 — 仅计算 interactive 终端
    const sessionInteractive = this.listTerminals(opts.agentSessionId).filter(
      (t) => t.sessionType === 'interactive'
    )
    if (sessionInteractive.length >= MAX_INTERACTIVE_PER_SESSION) {
      throw new Error(`此会话终端数已达上限 (${MAX_INTERACTIVE_PER_SESSION})`)
    }

    const shell = opts.shell || getDefaultShell()
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

    // 创建日志文件
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

    // 监听输出
    managed.dataDisposable = ptyProcess.onData((data: string) => {
      // 追加到缓冲区（滚动窗口）
      managed.outputBuffer += data
      if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX_SIZE) {
        managed.outputBuffer = managed.outputBuffer.slice(-OUTPUT_BUFFER_MAX_SIZE)
      }
      managed.session.lastActivityAt = Date.now()
      // 写入日志文件
      if (managed.logStream && !managed.logStream.destroyed) {
        managed.logStream.write(data)
      }
      // 通知所有监听器
      for (const listener of managed.outputListeners) {
        try {
          listener(data)
        } catch (err) {
          logger.error('Output listener error:', err)
        }
      }
    })

    // 监听退出
    managed.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      managed.session.status = 'exited'
      managed.session.exitCode = exitCode
      managed.session.signal = signal
      logger.info(`Terminal ${id} exited: code=${exitCode}, signal=${signal}`)
      // 关闭日志流
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

  // ---- 写入输入 ----

  writeToTerminal(termId: string, data: string): void {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    if (managed.session.status !== 'running') throw new Error(`Terminal ${termId} is not running`)
    managed.ptyProcess.write(data)
    managed.session.lastActivityAt = Date.now()
  }

  // ---- 调整尺寸 ----

  resizeTerminal(termId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(termId)
    if (!managed) throw new Error(`Terminal not found: ${termId}`)
    if (managed.session.status !== 'running') return
    managed.ptyProcess.resize(cols, rows)
    managed.session.cols = cols
    managed.session.rows = rows
  }

  // ---- 杀死终端 ----

  killTerminal(termId: string): void {
    const managed = this.terminals.get(termId)
    if (!managed) return
    this.destroyManagedTerminal(managed)
    this.terminals.delete(termId)
    logger.info(`Terminal killed: ${termId}`)
  }

  // ---- 查询 ----

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

  /** 获取指定终端最近的输出缓冲区内容 */
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

  // ---- 事件监听 ----

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
  //  Exec Worker 池 — 一次性命令的复用执行器
  // ================================================================

  /**
   * 获取或创建指定 session + 工作区类型的 exec worker
   * 每个 agent session 按工作区类型最多两个常驻 exec worker PTY
   */
  private getOrCreateExecWorker(
    agentSessionId: string,
    scope: string,
    cwd: string,
    workspaceType: ExecWorkspaceType
  ): ExecWorker {
    const key = execWorkerKey(agentSessionId, workspaceType)
    const existing = this.execWorkers.get(key)
    if (existing && !existing.exited) {
      existing.lastActivityAt = Date.now()
      return existing
    }

    // 清理旧的
    if (existing) {
      this.destroyExecWorker(existing)
      this.execWorkers.delete(key)
    }

    const shell = getDefaultShell()
    const resolvedCwd = path.resolve(cwd)
    const now = Date.now()

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: resolvedCwd,
        env: sanitizeEnv(process.env)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`无法启动 exec worker: ${msg}`)
    }

    const worker: ExecWorker = {
      agentSessionId,
      scope,
      workspaceType,
      ptyProcess,
      shell,
      cwd: resolvedCwd,
      busy: false,
      lastActivityAt: now,
      createdAt: now,
      dataDisposable: null as unknown as pty.IDisposable,
      exitDisposable: null as unknown as pty.IDisposable,
      exited: false
    }

    // 如果 worker 意外退出，标记它
    worker.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      worker.exited = true
      logger.info(
        `Exec worker [${workspaceType}] for session ${agentSessionId} exited: code=${exitCode}, signal=${signal}`
      )
    })

    // onData 的 disposable 在每次命令执行时单独管理
    worker.dataDisposable = ptyProcess.onData(() => {
      worker.lastActivityAt = Date.now()
    })

    this.execWorkers.set(key, worker)
    logger.info(
      `Exec worker [${workspaceType}] created for session ${agentSessionId} (shell=${shell}, cwd=${resolvedCwd}, pid=${ptyProcess.pid})`
    )
    return worker
  }

  private destroyExecWorker(worker: ExecWorker): void {
    try {
      worker.dataDisposable.dispose()
    } catch {
      /* ignore */
    }
    try {
      worker.exitDisposable.dispose()
    } catch {
      /* ignore */
    }
    if (!worker.exited) {
      try {
        worker.ptyProcess.kill()
      } catch {
        /* ignore */
      }
    }
    worker.exited = true
  }

  // ================================================================
  //  executeCommand — 一次性命令执行（使用 exec worker）
  // ================================================================

  /**
   * 执行一次性命令并返回输出
   * 使用复用的 exec worker PTY，不计入终端限额
   *
   * 实现策略：
   * - 按 workspaceType 分配独立 worker（main / session），防止工作目录互相污染
   * - 在 worker shell 中通过特殊标记分隔命令输出
   * - 使用 echo 写入开始/结束标记 + 退出码
   * - 超时后强制杀死 worker（会自动重建）
   */
  async executeCommand(
    opts: CreateTerminalOptions & {
      command: string
      timeoutMs?: number
      /** 工作区类型，决定分配哪个 exec worker，默认 main */
      workspaceType?: ExecWorkspaceType
    }
  ): Promise<{ output: string; exitCode: number; timedOut: boolean; execId: string }> {
    const timeoutMs = opts.timeoutMs ?? 30000
    const execId = generateId()
    const cwd = opts.cwd || process.cwd()
    const wsType: ExecWorkspaceType = opts.workspaceType ?? 'main'
    const startedAt = Date.now()

    // 创建 exec 命令的日志流
    const logStream = createExecLogStream(execId)
    if (logStream) {
      logStream.write(
        `# Exec: ${execId}\n# Session: ${opts.agentSessionId}\n# Workspace: ${wsType}\n# Command: ${
          opts.command
        }\n# CWD: ${cwd}\n# Started: ${new Date().toISOString()}\n---\n`
      )
    }

    const workerKey = execWorkerKey(opts.agentSessionId, wsType)
    let worker: ExecWorker
    try {
      worker = this.getOrCreateExecWorker(opts.agentSessionId, opts.scope, cwd, wsType)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (logStream) {
        logStream.write(`\n---\n# Error: ${msg}\n`)
        logStream.end()
      }
      return { output: `无法启动终端: ${msg}`, exitCode: -1, timedOut: false, execId }
    }

    // 如果 worker 正忙，重建一个新 worker
    if (worker.busy) {
      this.destroyExecWorker(worker)
      this.execWorkers.delete(workerKey)
      try {
        worker = this.getOrCreateExecWorker(opts.agentSessionId, opts.scope, cwd, wsType)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (logStream) {
          logStream.write(`\n---\n# Error: ${msg}\n`)
          logStream.end()
        }
        return { output: `无法启动终端: ${msg}`, exitCode: -1, timedOut: false, execId }
      }
    }

    worker.busy = true
    const lineEnd = os.platform() === 'win32' ? '\r\n' : '\n'

    // 使用唯一标记来识别命令输出的边界
    const startMarker = `__PRIZM_EXEC_START_${execId}__`
    const endMarker = `__PRIZM_EXEC_END_${execId}__`

    return new Promise<{ output: string; exitCode: number; timedOut: boolean; execId: string }>(
      (resolve) => {
        let settled = false
        let outputChunks: string[] = []
        let capturing = false
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        let dataHandler: ((data: string) => void) | null = null

        const finish = (exitCode: number, timedOut: boolean) => {
          if (settled) return
          settled = true
          worker.busy = false

          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
            timeoutHandle = null
          }

          // 移除 data handler
          if (dataHandler) {
            // 因为 worker.dataDisposable 是全局的，我们用 ptyProcess 的额外 onData
            // 这里通过标志位 settled 控制
          }

          const rawOutput = outputChunks.join('')
          // 清理标记行和多余的 shell prompt
          const output = cleanExecOutput(rawOutput, startMarker, endMarker)

          // 写入日志
          if (logStream && !logStream.destroyed) {
            logStream.write(
              `\n---\n# Finished: code=${exitCode}, timedOut=${timedOut}\n# Duration: ${
                Date.now() - startedAt
              }ms\n`
            )
            logStream.end()
          }

          // 记录到 exec history
          const record: ExecRecord = {
            id: execId,
            agentSessionId: opts.agentSessionId,
            workspaceType: wsType,
            command: opts.command,
            output,
            exitCode,
            timedOut,
            startedAt,
            finishedAt: Date.now()
          }
          this.pushExecRecord(record)

          resolve({ output, exitCode, timedOut, execId })
        }

        // 监听 worker 输出
        // 对每个 chunk 先 stripAnsi 再做标记检测和内容收集，
        // 确保输出干净、标记匹配可靠（ANSI 码不会干扰 includes 检测）。
        const execDataDisposable = worker.ptyProcess.onData((rawData: string) => {
          if (settled) return
          worker.lastActivityAt = Date.now()

          // 写入日志文件（保留原始数据，含 ANSI，供调试）
          if (logStream && !logStream.destroyed) {
            logStream.write(rawData)
          }

          // 剥离 ANSI 转义后处理
          const data = stripAnsi(rawData)

          // 检测开始标记
          if (!capturing && data.includes(startMarker)) {
            capturing = true
            // 取 startMarker 之后的部分
            const idx = data.indexOf(startMarker) + startMarker.length
            const rest = data.slice(idx)
            if (rest) outputChunks.push(rest)
            return
          }

          if (capturing) {
            // 检测结束标记 (格式: __PRIZM_EXEC_END_xxx__:exitCode)
            if (data.includes(endMarker)) {
              const idx = data.indexOf(endMarker)
              // 取结束标记之前的输出
              const before = data.slice(0, idx)
              if (before) outputChunks.push(before)

              // 解析退出码
              const afterMarker = data.slice(idx + endMarker.length)
              const codeMatch = afterMarker.match(/:(\d+)/)
              const code = codeMatch ? parseInt(codeMatch[1], 10) : 0

              execDataDisposable.dispose()
              finish(code, false)
              return
            }
            outputChunks.push(data)
          }
        })

        // 如果 worker PTY 意外退出
        const exitWatcher = worker.ptyProcess.onExit(() => {
          if (!settled) {
            execDataDisposable.dispose()
            exitWatcher.dispose()
            finish(-1, false)
          }
        })

        // 超时处理
        timeoutHandle = setTimeout(() => {
          if (settled) return
          execDataDisposable.dispose()
          exitWatcher.dispose()
          // 超时时销毁 worker（下次会重建）
          this.destroyExecWorker(worker)
          this.execWorkers.delete(workerKey)
          finish(-1, true)
        }, timeoutMs)

        // 构造带标记的执行命令
        // 策略：echo 开始标记 → cd 到目标目录 → 执行命令 → 捕获退出码 → echo 结束标记
        //
        // 关键：将标记拆为两段字符串拼接输出，防止 PTY 回显中包含完整标记文本。
        // 回显是 shell 对输入行的原样重现（带语法高亮），其中标记被 '' 分割，
        // 不会被 includes(marker) 匹配到。而 Write-Host / echo 的实际输出是拼接后
        // 的完整标记，可以被正确检测。
        const isWin = os.platform() === 'win32'
        const resolvedCwd = path.resolve(cwd)

        // 拆分标记：取中间位置断开
        const sSplit = Math.floor(startMarker.length / 2)
        const sA = startMarker.slice(0, sSplit)
        const sB = startMarker.slice(sSplit)
        const eSplit = Math.floor(endMarker.length / 2)
        const eA = endMarker.slice(0, eSplit)
        const eB = endMarker.slice(eSplit)

        let wrappedCmd: string
        if (isWin) {
          // PowerShell: 用字符串拼接运算符输出标记
          wrappedCmd = [
            `Write-Host ('${sA}' + '${sB}')`,
            `Set-Location -LiteralPath '${resolvedCwd.replace(/'/g, "''")}'`,
            `${opts.command}`,
            `Write-Host (('${eA}' + '${eB}') + ':' + $LASTEXITCODE)`
          ].join('; ')
        } else {
          // Bash/Zsh: 用相邻单引号字符串拼接标记
          const escapedCwd = resolvedCwd.replace(/'/g, "'\\''")
          wrappedCmd = [
            `echo '${sA}''${sB}'`,
            `cd '${escapedCwd}' && ${opts.command}`,
            `echo '${eA}''${eB}'":$?"`
          ].join('; ')
        }

        worker.ptyProcess.write(wrappedCmd + lineEnd)
      }
    )
  }

  // ================================================================
  //  Exec 历史
  // ================================================================

  private pushExecRecord(record: ExecRecord): void {
    this.execHistory.push(record)
    if (this.execHistory.length > this.maxExecHistory) {
      this.execHistory.splice(0, this.execHistory.length - this.maxExecHistory)
    }
  }

  /** 获取指定 session 下所有 exec worker 的状态 */
  getExecWorkerInfos(agentSessionId: string): ExecWorkerInfo[] {
    const results: ExecWorkerInfo[] = []
    for (const wsType of ['main', 'session'] as ExecWorkspaceType[]) {
      const key = execWorkerKey(agentSessionId, wsType)
      const worker = this.execWorkers.get(key)
      if (!worker) continue
      const commandCount = this.execHistory.filter(
        (r) => r.agentSessionId === agentSessionId && r.workspaceType === wsType
      ).length
      results.push({
        agentSessionId: worker.agentSessionId,
        workspaceType: wsType,
        shell: worker.shell,
        cwd: worker.cwd,
        pid: worker.ptyProcess.pid,
        busy: worker.busy,
        exited: worker.exited,
        createdAt: worker.createdAt,
        lastActivityAt: worker.lastActivityAt,
        commandCount
      })
    }
    return results
  }

  /** 查询 exec 命令历史 */
  getExecHistory(agentSessionId?: string, limit?: number): ExecRecord[] {
    let records = agentSessionId
      ? this.execHistory.filter((r) => r.agentSessionId === agentSessionId)
      : [...this.execHistory]
    if (limit && records.length > limit) {
      records = records.slice(-limit)
    }
    return records
  }

  /** 按 ID 查找单条 exec 记录 */
  getExecRecord(execId: string): ExecRecord | undefined {
    return this.execHistory.find((r) => r.id === execId)
  }

  // ================================================================
  //  Session 级联清理
  // ================================================================

  cleanupSession(agentSessionId: string): void {
    // 清理 interactive 终端
    const toRemove: string[] = []
    for (const [id, managed] of this.terminals) {
      if (managed.session.agentSessionId === agentSessionId) {
        toRemove.push(id)
      }
    }
    for (const id of toRemove) {
      this.killTerminal(id)
    }

    // 清理 exec workers（main + session）
    let workersCleaned = 0
    for (const wsType of ['main', 'session'] as ExecWorkspaceType[]) {
      const key = execWorkerKey(agentSessionId, wsType)
      const worker = this.execWorkers.get(key)
      if (worker) {
        this.destroyExecWorker(worker)
        this.execWorkers.delete(key)
        workersCleaned++
      }
    }

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
    const workerCount = this.execWorkers.size
    if (termCount === 0 && workerCount === 0) return

    logger.info(`Shutting down ${termCount} terminals + ${workerCount} exec workers...`)

    // 先发 SIGTERM
    for (const managed of this.terminals.values()) {
      if (managed.session.status === 'running') {
        try {
          managed.ptyProcess.kill()
        } catch {
          /* 忽略 */
        }
      }
    }
    for (const worker of this.execWorkers.values()) {
      if (!worker.exited) {
        try {
          worker.ptyProcess.kill()
        } catch {
          /* 忽略 */
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))

    // 强制清理
    for (const [id, managed] of this.terminals) {
      this.destroyManagedTerminal(managed)
      this.terminals.delete(id)
    }
    for (const [id, worker] of this.execWorkers) {
      this.destroyExecWorker(worker)
      this.execWorkers.delete(id)
    }

    logger.info('All terminals shut down')
  }

  // ================================================================
  //  统计
  // ================================================================

  get totalCount(): number {
    return this.terminals.size
  }

  /** 仅计数 interactive 终端（running 状态） */
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
    return this.execWorkers.size
  }

  private getInteractiveCount(): number {
    let count = 0
    for (const managed of this.terminals.values()) {
      if (managed.session.sessionType === 'interactive' && managed.session.status === 'running') {
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
    // 关闭日志流
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
      this.reapIdleExecWorkers()
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

  /** 回收空闲的 exec worker */
  private reapIdleExecWorkers(): void {
    const now = Date.now()
    const toRemove: string[] = []

    for (const [sessionId, worker] of this.execWorkers) {
      if (worker.exited) {
        toRemove.push(sessionId)
        continue
      }
      if (!worker.busy && now - worker.lastActivityAt > EXEC_WORKER_IDLE_MS) {
        logger.info(`Reaping idle exec worker for session ${sessionId}`)
        toRemove.push(sessionId)
      }
    }

    for (const id of toRemove) {
      const worker = this.execWorkers.get(id)
      if (worker) {
        this.destroyExecWorker(worker)
        this.execWorkers.delete(id)
      }
    }
  }
}

// ============ 输出清理工具 ============

/**
 * 清理 exec 命令输出中的标记行和 shell prompt 噪声
 */
/**
 * 剥离 ANSI 转义序列（SGR 颜色、光标定位、擦除、模式切换等）。
 * 覆盖 CSI (ESC [)、OSC (ESC ])、以及常见的单字符转义。
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /[\u001b\u009b](?:\[[0-9;?]*[A-Za-z@~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()#][A-B012]|[>=])/g,
    ''
  )
}

function cleanExecOutput(raw: string, startMarker: string, endMarker: string): string {
  let output = raw
  // 剥离 ANSI 转义序列
  output = stripAnsi(output)
  // 移除可能残留的标记文本
  output = output.replace(new RegExp(escapeRegExp(startMarker) + '\\r?\\n?', 'g'), '')
  output = output.replace(new RegExp(escapeRegExp(endMarker) + ':\\d*\\r?\\n?', 'g'), '')
  // 去除首尾空白行
  output = output.replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '')
  return output
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

// Shell 检测相关功能已移至 shellDetector.ts
export { resolveDefaultShell, getAvailableShells, resetShellCache } from './shellDetector'
