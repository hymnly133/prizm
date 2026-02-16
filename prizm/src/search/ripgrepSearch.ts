/**
 * ripgrep 全文搜索封装 - 直接扫描 Markdown 文件，字节级匹配，保证不漏
 * 基于 @vscode/ripgrep（VSCode 同款方案）
 */

import { spawn } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import { createLogger } from '../logger'

const log = createLogger('RipgrepSearch')

export interface RipgrepMatch {
  /** 匹配到的文件绝对路径 */
  filePath: string
  /** 匹配行号 */
  lineNumber: number
  /** 匹配行内容 */
  lineText: string
}

export interface RipgrepFileMatch {
  /** 文件绝对路径 */
  filePath: string
  /** 该文件中的匹配行（取前 maxMatchesPerFile 条） */
  matches: { lineNumber: number; lineText: string }[]
}

export interface RipgrepSearchOptions {
  /** 文件 glob 过滤，默认 "*.md" */
  glob?: string
  /** 每文件最多匹配数，默认 3 */
  maxMatchesPerFile?: number
  /** 最多返回文件数，默认 100 */
  maxFiles?: number
  /** 大小写不敏感，默认 true */
  ignoreCase?: boolean
  /** 超时毫秒，默认 5000 */
  timeoutMs?: number
}

/**
 * 使用 ripgrep 在指定目录中搜索文本，按文件分组返回
 * @param query 搜索文本（固定字符串，非正则）
 * @param directory 搜索目录
 * @param options 搜索选项
 */
export async function ripgrepSearch(
  query: string,
  directory: string,
  options: RipgrepSearchOptions = {}
): Promise<RipgrepFileMatch[]> {
  if (!query.trim()) return []

  const {
    glob = '*.md',
    maxMatchesPerFile = 3,
    maxFiles = 100,
    ignoreCase = true,
    timeoutMs = 5000
  } = options

  const args = [
    '--json',
    '--fixed-strings',
    '--max-count',
    String(maxMatchesPerFile),
    '--glob',
    glob,
    '--no-heading'
  ]
  if (ignoreCase) args.push('--ignore-case')
  args.push('--', query, directory)

  return new Promise<RipgrepFileMatch[]>((resolve) => {
    const fileMap = new Map<string, RipgrepFileMatch>()
    let stdout = ''

    const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const timer = setTimeout(() => {
      log.warn('ripgrep search timed out', { query, directory, timeoutMs })
      proc.kill('SIGTERM')
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    proc.on('close', () => {
      clearTimeout(timer)
      try {
        const lines = stdout.split('\n').filter((l) => l.length > 0)
        for (const line of lines) {
          let parsed: RipgrepJsonMessage
          try {
            parsed = JSON.parse(line)
          } catch {
            continue
          }
          if (parsed.type !== 'match') continue
          const data = parsed.data
          const filePath = data.path?.text
          if (!filePath) continue
          const lineNumber = data.line_number ?? 0
          const lineText = (data.lines?.text ?? '').trimEnd()

          let entry = fileMap.get(filePath)
          if (!entry) {
            if (fileMap.size >= maxFiles) continue
            entry = { filePath, matches: [] }
            fileMap.set(filePath, entry)
          }
          entry.matches.push({ lineNumber, lineText })
        }
      } catch (err) {
        log.warn('ripgrep output parse error', err)
      }
      resolve([...fileMap.values()])
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      log.error('ripgrep spawn error', err)
      resolve([])
    })
  })
}

/** ripgrep --json 输出行类型 */
interface RipgrepJsonMessage {
  type: 'begin' | 'match' | 'end' | 'summary' | 'context'
  data: {
    path?: { text: string }
    line_number?: number
    lines?: { text: string }
    submatches?: { match: { text: string }; start: number; end: number }[]
  }
}
