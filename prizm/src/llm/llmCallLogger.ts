/**
 * LLM 调用详细日志（Prompt Cache 分析专用）
 *
 * 写入 {dataDir}/logs/llm-calls.jsonl，JSONL 格式（每行一个 JSON）。
 * 记录每次 LLM API 调用的消息结构、缓存命中、耗时等完整上下文，
 * 方便离线分析 prompt cache 命中率和优化效果。
 *
 * 文件轮转：5MB 上限，7 天保留。
 */

import fs from 'fs'
import path from 'path'
import { getDataDir } from '../core/PathProviderCore'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_AGE_DAYS = 7
const LOG_FILE_NAME = 'llm-calls.jsonl'
const ARCHIVE_PREFIX = 'llm-calls-'
const PREVIEW_LEN = 80

// ─── Types ───

export interface LLMCallLogEntry {
  ts: string
  category: string
  sessionId?: string
  scope: string
  model: string

  promptCacheKey?: string
  messages: MessageSummary[]
  toolCount?: number

  usage: {
    input: number
    output: number
    cached: number
    cacheRate: string
  }

  durationMs: number
  error?: string
}

export interface MessageSummary {
  role: string
  chars: number
  tokenEstimate: number
  toolCalls?: number
  preview?: string
}

// ─── File rotation ───

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
  _logFilePath = path.join(dir, LOG_FILE_NAME)
  return _logFilePath
}

function rotateLogs(): void {
  const filePath = getLogFilePath()
  try {
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size < MAX_FILE_SIZE) return

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const archivePath = path.join(ensureLogDir(), `${ARCHIVE_PREFIX}${ts}.jsonl`)
    fs.renameSync(filePath, archivePath)
    _logFilePath = null

    cleanOldArchives()
  } catch {
    // 轮转失败不阻断业务
  }
}

function cleanOldArchives(): void {
  try {
    const dir = ensureLogDir()
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(ARCHIVE_PREFIX) || !name.endsWith('.jsonl')) continue
      const fullPath = path.join(dir, name)
      try {
        if (fs.statSync(fullPath).mtimeMs < cutoff) fs.unlinkSync(fullPath)
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

// ─── Token estimate ───

/**
 * 粗估 token 数。中英混合场景下平均 1 char ≈ 0.6 token
 * （中文 1 字 ≈ 1.5-2 tokens，英文 1 word ≈ 1-1.3 tokens）
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length * 0.6)
}

// ─── Public API ───

/**
 * 从消息数组构建摘要（不含完整内容，避免日志膨胀）。
 * 兼容 { role, content, tool_calls? } 格式。
 */
export function buildMessagesSummary(
  messages: Array<{ role: string; content?: string | null | unknown[]; tool_calls?: unknown[] }>
): MessageSummary[] {
  return messages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : ''
    const chars = content.length
    const entry: MessageSummary = {
      role: m.role,
      chars,
      tokenEstimate: estimateTokens(content)
    }
    if (m.tool_calls?.length) {
      entry.toolCalls = m.tool_calls.length
    }
    if (chars > 0) {
      entry.preview = content.slice(0, PREVIEW_LEN).replace(/\n/g, '\\n')
    }
    return entry
  })
}

/**
 * 从 usage 数据构建 cacheRate 字符串。
 */
export function formatUsage(usage?: {
  totalInputTokens?: number
  totalOutputTokens?: number
  cachedInputTokens?: number
}): LLMCallLogEntry['usage'] {
  const input = usage?.totalInputTokens ?? 0
  const output = usage?.totalOutputTokens ?? 0
  const cached = usage?.cachedInputTokens ?? 0
  const rate = input > 0 ? ((cached / input) * 100).toFixed(1) + '%' : '0%'
  return { input, output, cached, cacheRate: rate }
}

/**
 * 写入一条 LLM 调用日志。
 */
export function logLLMCall(entry: LLMCallLogEntry): void {
  try {
    rotateLogs()
    const clean = JSON.parse(JSON.stringify(entry))
    fs.appendFileSync(getLogFilePath(), JSON.stringify(clean) + '\n', 'utf-8')
  } catch {
    // 日志写入不阻断业务
  }
}

/**
 * 读取最近 N 条日志（调试用）。
 */
export function readRecentLLMCallLogs(limit = 50): LLMCallLogEntry[] {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line) as LLMCallLogEntry
      } catch {
        return {
          ts: '',
          category: 'error',
          scope: '',
          model: '',
          messages: [],
          usage: { input: 0, output: 0, cached: 0, cacheRate: '0%' },
          durationMs: 0,
          error: `Invalid log line: ${line.slice(0, 100)}`
        }
      }
    })
  } catch {
    return []
  }
}
