/**
 * Prizm 客户端统一日志工具
 * 格式与服务端对齐: [timestamp] [Prizm][module][LEVEL] message
 * 支持 Transport 机制：默认 console 输出，可注册额外 transport（如 IPC 写文件）
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

let minLevel: LogLevel = 'info'

const levelTagMap: Record<LogLevel, string> = {
  debug: ' [DEBUG] ',
  info: '',
  warn: ' [WARN] ',
  error: ' [ERROR] '
}

export type LogTransport = (level: LogLevel, module: string, message: string) => void

const transports: LogTransport[] = []

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel]
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? arg.message
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

function formatMessage(module: string, level: LogLevel, args: unknown[]): string {
  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [Prizm][${module}]`
  const msg = args.map(formatArg).join(' ')
  const levelTag = levelTagMap[level] ?? ''
  return `${prefix}${levelTag}${msg}`
}

export interface ClientLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/**
 * 设置最小日志级别
 */
export function setLogLevel(level: LogLevel): void {
  if (level in LEVELS) {
    minLevel = level
  }
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): LogLevel {
  return minLevel
}

/**
 * 注册额外的日志 transport（如 IPC 写文件）
 */
export function addTransport(transport: LogTransport): void {
  transports.push(transport)
}

/**
 * 移除指定的日志 transport
 */
export function removeTransport(transport: LogTransport): void {
  const idx = transports.indexOf(transport)
  if (idx !== -1) {
    transports.splice(idx, 1)
  }
}

function dispatch(level: LogLevel, module: string, formatted: string): void {
  for (const transport of transports) {
    try {
      transport(level, module, formatted)
    } catch {
      // transport 自身错误不能导致日志系统崩溃
    }
  }
}

/**
 * 创建带模块名的日志器
 */
export function createClientLogger(module: string): ClientLogger {
  return {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) {
        const msg = formatMessage(module, 'debug', args)
        console.log(msg)
        dispatch('debug', module, msg)
      }
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) {
        const msg = formatMessage(module, 'info', args)
        console.log(msg)
        dispatch('info', module, msg)
      }
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) {
        const msg = formatMessage(module, 'warn', args)
        console.warn(msg)
        dispatch('warn', module, msg)
      }
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) {
        const msg = formatMessage(module, 'error', args)
        console.error(msg)
        dispatch('error', module, msg)
      }
    }
  }
}
