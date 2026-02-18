/**
 * Exec Worker pool — 一次性命令的复用执行器
 * 每个 agent session 按工作区类型最多两个常驻 exec worker PTY（main / session）。
 * 供 TerminalSessionManager 委托 executeCommand 与相关查询/清理。
 */

import * as pty from 'node-pty'
import * as os from 'os'
import * as path from 'path'
import type { CreateTerminalOptions } from '@prizm/shared'
import { createLogger } from '../logger'
import {
  execWorkerKey,
  generateId,
  sanitizeEnv,
  stripAnsi,
  escapeRegExp,
  EXEC_WORKER_IDLE_MS,
  type ExecWorkspaceType,
  type ExecRecord,
  type ExecWorkerInfo
} from './terminalConstants'
import { createExecLogStream } from './terminalLogger'
import { resolveDefaultShell } from './shellDetector'

const logger = createLogger('TerminalManager')

/**
 * exec worker 专用环境变量 —— 禁用分页器和交互式提示，
 * 防止 git log / man 等命令阻塞等待用户输入。
 */
const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_PAGER: '',
  PAGER: '',
  GIT_TERMINAL_PROMPT: '0',
  NO_COLOR: '1'
}

/** Exec Worker：每个 agent session + 工作区类型 复用的一次性命令执行器 */
interface ExecWorker {
  agentSessionId: string
  scope: string
  workspaceType: ExecWorkspaceType
  ptyProcess: pty.IPty
  shell: string
  cwd: string
  busy: boolean
  lastActivityAt: number
  createdAt: number
  dataDisposable: pty.IDisposable
  exitDisposable: pty.IDisposable
  exited: boolean
}

/**
 * 为独立 git 命令自动注入 --no-pager，防止分页器阻塞。
 * 仅匹配 `git ...` 开头的简单命令，不处理管道/链式命令中的 git 调用。
 */
function injectNoPager(command: string): string {
  const trimmed = command.trimStart()
  if (/^git\s/i.test(trimmed) && !trimmed.includes('--no-pager')) {
    return trimmed.replace(/^git\s/i, 'git --no-pager ')
  }
  return command
}

function cleanExecOutput(raw: string, startMarker: string, endMarker: string): string {
  let output = stripAnsi(raw)
  output = output.replace(new RegExp(escapeRegExp(startMarker) + '\\r?\\n?', 'g'), '')
  output = output.replace(new RegExp(escapeRegExp(endMarker) + ':\\d*\\r?\\n?', 'g'), '')
  output = output.replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '')
  return output
}

export class ExecWorkerPool {
  private execWorkers = new Map<string, ExecWorker>()
  private execHistory: ExecRecord[] = []
  private readonly maxExecHistory = 200

  /**
   * 获取或创建指定 session + 工作区类型的 exec worker
   */
  getOrCreateExecWorker(
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

    if (existing) {
      this.destroyExecWorker(existing)
      this.execWorkers.delete(key)
    }

    const shell = resolveDefaultShell()
    const resolvedCwd = path.resolve(cwd)
    const now = Date.now()

    let ptyProcess: pty.IPty
    try {
      const env = sanitizeEnv(process.env)
      Object.assign(env, NON_INTERACTIVE_ENV)
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: resolvedCwd,
        env
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

    worker.exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
      worker.exited = true
      logger.info(
        `Exec worker [${workspaceType}] for session ${agentSessionId} exited: code=${exitCode}, signal=${signal}`
      )
    })

    worker.dataDisposable = ptyProcess.onData(() => {
      worker.lastActivityAt = Date.now()
    })

    this.execWorkers.set(key, worker)
    logger.info(
      `Exec worker [${workspaceType}] created for session ${agentSessionId} (shell=${shell}, cwd=${resolvedCwd}, pid=${ptyProcess.pid})`
    )
    return worker
  }

  destroyExecWorker(worker: ExecWorker): void {
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

  /**
   * 执行一次性命令并返回输出
   */
  async executeCommand(
    opts: CreateTerminalOptions & {
      command: string
      timeoutMs?: number
      workspaceType?: ExecWorkspaceType
    }
  ): Promise<{ output: string; exitCode: number; timedOut: boolean; execId: string }> {
    const timeoutMs = opts.timeoutMs ?? 30000
    const execId = generateId()
    const cwd = opts.cwd || process.cwd()
    const wsType: ExecWorkspaceType = opts.workspaceType ?? 'main'
    const startedAt = Date.now()

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
    const startMarker = `__PRIZM_EXEC_START_${execId}__`
    const endMarker = `__PRIZM_EXEC_END_${execId}__`

    return new Promise<{ output: string; exitCode: number; timedOut: boolean; execId: string }>(
      (resolve) => {
        let settled = false
        const outputChunks: string[] = []
        let capturing = false
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null

        const finish = (exitCode: number, timedOut: boolean) => {
          if (settled) return
          settled = true
          worker.busy = false

          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
            timeoutHandle = null
          }

          const rawOutput = outputChunks.join('')
          const output = cleanExecOutput(rawOutput, startMarker, endMarker)

          if (logStream && !logStream.destroyed) {
            logStream.write(
              `\n---\n# Finished: code=${exitCode}, timedOut=${timedOut}\n# Duration: ${
                Date.now() - startedAt
              }ms\n`
            )
            logStream.end()
          }

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

        const execDataDisposable = worker.ptyProcess.onData((rawData: string) => {
          if (settled) return
          worker.lastActivityAt = Date.now()

          if (logStream && !logStream.destroyed) {
            logStream.write(rawData)
          }

          const data = stripAnsi(rawData)

          if (!capturing && data.includes(startMarker)) {
            capturing = true
            const idx = data.indexOf(startMarker) + startMarker.length
            const rest = data.slice(idx)
            if (rest) outputChunks.push(rest)
            return
          }

          if (capturing) {
            if (data.includes(endMarker)) {
              const idx = data.indexOf(endMarker)
              const before = data.slice(0, idx)
              if (before) outputChunks.push(before)

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

        const exitWatcher = worker.ptyProcess.onExit(() => {
          if (!settled) {
            execDataDisposable.dispose()
            exitWatcher.dispose()
            finish(-1, false)
          }
        })

        timeoutHandle = setTimeout(() => {
          if (settled) return
          execDataDisposable.dispose()
          exitWatcher.dispose()
          this.destroyExecWorker(worker)
          this.execWorkers.delete(workerKey)
          finish(-1, true)
        }, timeoutMs)

        const isWin = os.platform() === 'win32'
        const resolvedCwd = path.resolve(cwd)
        const safeCommand = injectNoPager(opts.command)
        const sSplit = Math.floor(startMarker.length / 2)
        const sA = startMarker.slice(0, sSplit)
        const sB = startMarker.slice(sSplit)
        const eSplit = Math.floor(endMarker.length / 2)
        const eA = endMarker.slice(0, eSplit)
        const eB = endMarker.slice(eSplit)

        let wrappedCmd: string
        if (isWin) {
          wrappedCmd = [
            `Write-Host ('${sA}' + '${sB}')`,
            `Set-Location -LiteralPath '${resolvedCwd.replace(/'/g, "''")}'`,
            `${safeCommand}`,
            `Write-Host (('${eA}' + '${eB}') + ':' + $LASTEXITCODE)`
          ].join('; ')
        } else {
          const escapedCwd = resolvedCwd.replace(/'/g, "'\\''")
          wrappedCmd = [
            `echo '${sA}''${sB}'`,
            `cd '${escapedCwd}' && ${safeCommand}`,
            `echo '${eA}''${eB}'":$?"`
          ].join('; ')
        }

        worker.ptyProcess.write(wrappedCmd + lineEnd)
      }
    )
  }

  private pushExecRecord(record: ExecRecord): void {
    this.execHistory.push(record)
    if (this.execHistory.length > this.maxExecHistory) {
      this.execHistory.splice(0, this.execHistory.length - this.maxExecHistory)
    }
  }

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

  getExecHistory(agentSessionId?: string, limit?: number): ExecRecord[] {
    let records = agentSessionId
      ? this.execHistory.filter((r) => r.agentSessionId === agentSessionId)
      : [...this.execHistory]
    if (limit && records.length > limit) {
      records = records.slice(-limit)
    }
    return records
  }

  getExecRecord(execId: string): ExecRecord | undefined {
    return this.execHistory.find((r) => r.id === execId)
  }

  /** 仅清理该 session 的 exec workers */
  cleanupSession(agentSessionId: string): number {
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
    return workersCleaned
  }

  /** 回收空闲的 exec worker */
  reapIdleExecWorkers(): void {
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

  /** 仅发送 kill 信号，不清理（用于 graceful shutdown 第一阶段） */
  killAll(): void {
    for (const worker of this.execWorkers.values()) {
      if (!worker.exited) {
        try {
          worker.ptyProcess.kill()
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 关闭所有 exec workers（dispose + 从池中移除） */
  shutdown(): void {
    for (const [id, worker] of this.execWorkers) {
      this.destroyExecWorker(worker)
      this.execWorkers.delete(id)
    }
  }

  get size(): number {
    return this.execWorkers.size
  }
}
