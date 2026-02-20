/**
 * Terminal configuration constants and shared type definitions.
 * Used by TerminalSessionManager and ExecWorkerPool.
 */

import * as os from 'os'

// ============ 配置常量 ============

/** 单 Agent Session 最大 **interactive** 终端数 */
export const MAX_INTERACTIVE_PER_SESSION = 5
/** 全局最大 **interactive** 终端数 */
export const MAX_INTERACTIVE_TOTAL = 20
/** 空闲超时 (ms) — 30 分钟无输入自动 kill */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000
/** 最大生命周期 (ms) — 8 小时硬性上限 */
export const MAX_LIFETIME_MS = 8 * 60 * 60 * 1000
/** reaper 扫描间隔 (ms) */
export const REAPER_INTERVAL_MS = 60 * 1000
/** 输出缓冲区最大大小 (bytes) */
export const OUTPUT_BUFFER_MAX_SIZE = 100 * 1024
/** Graceful shutdown 等待时间 (ms) */
export const SHUTDOWN_GRACE_MS = 3000
/** Exec worker 空闲超时 (ms) — 10 分钟无执行自动回收 */
export const EXEC_WORKER_IDLE_MS = 10 * 60 * 1000

/** 需要从 env 中剥离的关键词（大写比较） */
export const BLOCKED_ENV_PATTERNS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'PRIVATE']

// ============ 类型定义 ============

export interface Disposable {
  dispose(): void
}

/** 工作区类型：main = scope 根目录, session = session 临时工作区, workflow = 工作流工作区 */
export type ExecWorkspaceType = 'main' | 'session' | 'workflow'

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

// ============ Shell 白名单 ============

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

// ============ 工具函数 ============

export function generateId(): string {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 生成 exec worker 的复合 key */
export function execWorkerKey(agentSessionId: string, workspaceType: ExecWorkspaceType): string {
  return `${agentSessionId}:${workspaceType}`
}

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

/**
 * 剥离 ANSI 转义序列（SGR 颜色、光标定位、擦除、模式切换等）。
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /[\u001b\u009b](?:\[[0-9;?]*[A-Za-z@~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()#][A-B012]|[>=])/g,
    ''
  )
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
