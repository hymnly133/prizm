/**
 * Terminal log file writing.
 * Creates and manages log streams under .prizm-data/terminal-logs/
 */

import * as fs from 'fs'
import * as path from 'path'
import type { TerminalSessionType } from '@prizm/shared'
import { createLogger } from '../logger'
import { getDataDir, ensureDataDir } from '../core/PathProviderCore'

const logger = createLogger('TerminalManager')

/** 确保终端日志目录存在，返回路径 */
export function ensureTerminalLogsDir(): string {
  ensureDataDir()
  const dir = path.join(getDataDir(), 'terminal-logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 为终端创建日志文件写入流 */
export function createLogStream(
  termId: string,
  sessionType: TerminalSessionType
): fs.WriteStream | null {
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
export function createExecLogStream(execId: string): fs.WriteStream | null {
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
