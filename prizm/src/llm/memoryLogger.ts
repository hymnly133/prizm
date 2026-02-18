/**
 * 记忆系统持久化日志
 *
 * 将记忆系统的关键事件写入 {dataDir}/logs/memory.jsonl，方便调试。
 * 每条日志为一个 JSON 对象，格式：
 * { ts, event, scope?, documentId?, sessionId?, detail?, error? }
 *
 * 日志自动按日期轮转（保留最近 7 天），单文件最大 5MB。
 */

import fs from 'fs'
import path from 'path'
import { getDataDir } from '../core/PathProviderCore'
import { createLogger } from '../logger'

const log = createLogger('MemoryLogger')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_AGE_DAYS = 7

/** 日志事件类型 */
export type MemoryLogEvent =
  // 文档记忆编排
  | 'doc_memory:schedule'
  | 'doc_memory:start'
  | 'doc_memory:skip'
  | 'doc_memory:delete_old'
  | 'doc_memory:extract_start'
  | 'doc_memory:extract_done'
  | 'doc_memory:migration_start'
  | 'doc_memory:migration_done'
  | 'doc_memory:migration_skip'
  | 'doc_memory:complete'
  | 'doc_memory:version_backfill'
  | 'doc_memory:error'
  // 对话记忆（会话缓冲 → 抽取）
  | 'conv_memory:buffer_append'
  | 'conv_memory:buffer_skip_flush'
  | 'conv_memory:buffer_time_gap_flush'
  | 'conv_memory:flush_start'
  | 'conv_memory:flush_result'
  | 'conv_memory:flush_error'
  | 'conv_memory:session_flush'
  | 'conv_memory:chat_trigger'
  | 'conv_memory:compression_trigger'
  // 双流水线
  | 'pipeline:p1_start'
  | 'pipeline:p1_done'
  | 'pipeline:p1_error'
  | 'pipeline:p2_threshold_check'
  | 'pipeline:p2_start'
  | 'pipeline:p2_done'
  | 'pipeline:p2_error'
  | 'pipeline:accumulator_append'
  | 'pipeline:accumulator_reset'
  | 'pipeline:accumulator_rollback_reset'
  | 'pipeline:session_flush'
  // EverMemService 记忆操作
  | 'memory:store'
  | 'memory:delete'
  | 'memory:clear'
  | 'memory:query'
  // MemoryManager 写入
  | 'manager:unified_result'
  | 'manager:insert'
  | 'manager:dedup'
  | 'manager:error'
  // 事件处理器
  | 'handler:document_saved'
  | 'handler:document_deleted'
  | 'handler:document_deleted_error'
  | 'handler:session_deleted'
  | 'handler:session_rolledBack'
  | 'handler:session_rolledBack_p1_cleanup'
  | 'handler:session_rolledBack_doc_cleanup'
  // 缓存操作
  | 'cache:init'
  | 'cache:invalidate'

export interface MemoryLogEntry {
  ts: string
  event: MemoryLogEvent
  scope?: string
  documentId?: string
  sessionId?: string
  detail?: Record<string, unknown>
  error?: string
}

let _logDir: string | null = null
let _logFilePath: string | null = null

function ensureLogDir(): string {
  if (_logDir) return _logDir
  _logDir = path.join(getDataDir(), 'logs')
  if (!fs.existsSync(_logDir)) {
    fs.mkdirSync(_logDir, { recursive: true })
  }
  return _logDir
}

function getLogFilePath(): string {
  if (_logFilePath) return _logFilePath
  const dir = ensureLogDir()
  _logFilePath = path.join(dir, 'memory.jsonl')
  return _logFilePath
}

function rotateLogs(): void {
  const filePath = getLogFilePath()
  try {
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size < MAX_FILE_SIZE) return

    // 轮转：重命名为带时间戳的归档文件
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const archivePath = path.join(ensureLogDir(), `memory-${timestamp}.jsonl`)
    fs.renameSync(filePath, archivePath)
    _logFilePath = null

    // 清理过期归档
    cleanOldArchives()
  } catch (e) {
    log.warn('Log rotation failed:', e)
  }
}

function cleanOldArchives(): void {
  try {
    const dir = ensureLogDir()
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    const entries = fs.readdirSync(dir)
    for (const name of entries) {
      if (!name.startsWith('memory-') || !name.endsWith('.jsonl')) continue
      const fullPath = path.join(dir, name)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath)
        }
      } catch {
        // 忽略
      }
    }
  } catch {
    // 忽略
  }
}

/**
 * 写入一条持久化日志
 */
export function memLog(
  event: MemoryLogEvent,
  opts?: {
    scope?: string
    documentId?: string
    sessionId?: string
    detail?: Record<string, unknown>
    error?: unknown
  }
): void {
  try {
    rotateLogs()
    const entry: MemoryLogEntry = {
      ts: new Date().toISOString(),
      event,
      scope: opts?.scope,
      documentId: opts?.documentId,
      sessionId: opts?.sessionId,
      detail: opts?.detail,
      error: opts?.error
        ? opts.error instanceof Error
          ? `${opts.error.message}\n${opts.error.stack ?? ''}`
          : String(opts.error)
        : undefined
    }
    // 移除 undefined 字段以减少日志体积
    const clean = JSON.parse(JSON.stringify(entry))
    const line = JSON.stringify(clean) + '\n'
    fs.appendFileSync(getLogFilePath(), line, 'utf-8')
  } catch (e) {
    // 日志写入本身不应阻断业务
    log.warn('Memory log write failed:', e)
  }
}

/**
 * 读取最近 N 条日志（用于调试 API）
 */
export function readRecentLogs(limit = 50): MemoryLogEntry[] {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const recent = lines.slice(-limit)
    return recent.map((line) => {
      try {
        return JSON.parse(line) as MemoryLogEntry
      } catch {
        return {
          ts: '',
          event: 'manager:error' as MemoryLogEvent,
          error: `Invalid log line: ${line.slice(0, 100)}`
        }
      }
    })
  } catch {
    return []
  }
}
