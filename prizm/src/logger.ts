/**
 * Prizm 统一日志工具
 * 格式: [timestamp] [LEVEL] [module] message
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

function getMinLevel(): LogLevel {
  const level = process.env.PRIZM_LOG_LEVEL as LogLevel
  return level in LEVELS ? level : 'info'
}

const levelTagMap: Record<LogLevel, string> = {
  debug: ' [DEBUG] ',
  info: '',
  warn: ' [WARN] ',
  error: ' [ERROR] '
}

const minLevel: LogLevel = getMinLevel()

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel]
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? arg.message
  }
  if (typeof arg === 'object' && arg !== null) {
    return JSON.stringify(arg)
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

export interface PrizmLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/**
 * 创建带模块名的日志器
 */
export function createLogger(module: string): PrizmLogger {
  return {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) {
        console.log(formatMessage(module, 'debug', args))
      }
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) {
        console.log(formatMessage(module, 'info', args))
      }
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) {
        console.warn(formatMessage(module, 'warn', args))
      }
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) {
        console.error(formatMessage(module, 'error', args))
      }
    }
  }
}
