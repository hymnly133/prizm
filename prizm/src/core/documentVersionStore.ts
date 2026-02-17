/**
 * 文档版本控制 - 轻量级全量快照
 * 每个文档一个 JSON 文件，存于 {scopeRoot}/.prizm/doc-versions/{documentId}.json
 * 结构化设计便于未来专业化重构（git-like branching、增量存储等）
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getPrizmDir } from './PathProviderCore'
import { createLogger } from '../logger'

const log = createLogger('DocVersionStore')

const DOC_VERSIONS_DIR = 'doc-versions'

/** 文档版本快照 */
export interface DocumentVersion {
  /** 自增版本号 */
  version: number
  /** 快照时间 ISO */
  timestamp: string
  /** 文档完整内容 */
  content: string
  /** 文档标题（快照时） */
  title: string
  /** 内容 hash（用于快速判断是否有变更） */
  contentHash: string
}

/** 单个文档的版本历史 */
export interface DocumentVersionHistory {
  documentId: string
  /** 版本列表，按 version 升序 */
  versions: DocumentVersion[]
}

function getDocVersionsDir(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), DOC_VERSIONS_DIR)
}

function getDocVersionFilePath(scopeRoot: string, documentId: string): string {
  const safe = documentId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
  return path.join(getDocVersionsDir(scopeRoot), `${safe}.json`)
}

/** 计算内容 hash（SHA-256 前 16 位十六进制） */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

/** 读取文档版本历史，文件不存在返回空历史 */
function readHistory(scopeRoot: string, documentId: string): DocumentVersionHistory {
  const filePath = getDocVersionFilePath(scopeRoot, documentId)
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8')
      const data = JSON.parse(raw) as DocumentVersionHistory
      if (data && Array.isArray(data.versions)) {
        return data
      }
    }
  } catch (e) {
    log.warn('Failed to read doc version history:', documentId, e)
  }
  return { documentId, versions: [] }
}

/** 写入文档版本历史 */
function writeHistory(scopeRoot: string, history: DocumentVersionHistory): void {
  const dir = getDocVersionsDir(scopeRoot)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const filePath = getDocVersionFilePath(scopeRoot, history.documentId)
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8')
}

/**
 * 保存新版本快照。若内容与最新版本相同（hash 一致），跳过保存并返回最新版本。
 * @returns 保存的（或已存在的）版本快照
 */
export function saveVersion(
  scopeRoot: string,
  documentId: string,
  title: string,
  content: string
): DocumentVersion {
  const history = readHistory(scopeRoot, documentId)
  const contentHash = computeContentHash(content)

  const latest = history.versions.length > 0 ? history.versions[history.versions.length - 1] : null
  if (latest && latest.contentHash === contentHash) {
    return latest
  }

  const version: DocumentVersion = {
    version: (latest?.version ?? 0) + 1,
    timestamp: new Date().toISOString(),
    content,
    title,
    contentHash
  }
  history.versions.push(version)
  writeHistory(scopeRoot, history)
  log.info('Doc version saved: %s v%d scope=%s', documentId, version.version, scopeRoot)
  return version
}

/** 获取最新版本，无则返回 null */
export function getLatestVersion(scopeRoot: string, documentId: string): DocumentVersion | null {
  const history = readHistory(scopeRoot, documentId)
  return history.versions.length > 0 ? history.versions[history.versions.length - 1] : null
}

/** 获取上一个版本（倒数第二个），无则返回 null */
export function getPreviousVersion(scopeRoot: string, documentId: string): DocumentVersion | null {
  const history = readHistory(scopeRoot, documentId)
  return history.versions.length >= 2 ? history.versions[history.versions.length - 2] : null
}

/** 获取完整版本历史 */
export function getVersionHistory(scopeRoot: string, documentId: string): DocumentVersionHistory {
  return readHistory(scopeRoot, documentId)
}

/**
 * 计算两个版本内容之间的人类可读差异摘要。
 * 按行对比，输出增删改行的摘要文本，供迁移记忆的 LLM prompt 使用。
 */
export function computeDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  const added: string[] = []
  const removed: string[] = []

  for (const line of newLines) {
    if (line.trim() && !oldSet.has(line)) {
      added.push(line.trim())
    }
  }
  for (const line of oldLines) {
    if (line.trim() && !newSet.has(line)) {
      removed.push(line.trim())
    }
  }

  const parts: string[] = []
  if (removed.length > 0) {
    const display = removed.slice(0, 30)
    parts.push('--- 删除的内容 ---')
    for (const l of display) parts.push(`- ${l}`)
    if (removed.length > 30) parts.push(`... 等共 ${removed.length} 行`)
  }
  if (added.length > 0) {
    const display = added.slice(0, 30)
    parts.push('+++ 新增的内容 +++')
    for (const l of display) parts.push(`+ ${l}`)
    if (added.length > 30) parts.push(`... 等共 ${added.length} 行`)
  }

  if (parts.length === 0) return '（无显著变更）'

  const stats = `变更统计：删除 ${removed.length} 行，新增 ${added.length} 行（共 ${oldLines.length} → ${newLines.length} 行）`
  return `${stats}\n\n${parts.join('\n')}`
}
