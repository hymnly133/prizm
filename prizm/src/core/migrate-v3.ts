/**
 * Scope 存储结构迁移 V3
 * - StickyNote -> Document: prizm_type note -> document, 标题驱动文件名
 * - ID 文件名 -> 标题文件名: document 文件从 ID 命名改为标题命名
 * - 移除 .prizm/pomodoro/
 *
 * 在 ScopeStore 初始化时自动执行
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { getScopeJsonPath, getPomodoroDir } from './PathProviderCore'
import { sanitizeFileName } from './mdStore'
import { createLogger } from '../logger'
import { genUniqueId } from '../id'
import { scanUserFiles } from './MetadataCache'

const log = createLogger('migrate-v3')
const EXT = '.md'
const ID_FILENAME_REGEX = /^[a-zA-Z0-9_-]{8,}\.md$/

function getScopeExcludePatterns(scopeRoot: string): string[] {
  const scopeJsonPath = getScopeJsonPath(scopeRoot)
  if (!fs.existsSync(scopeJsonPath)) return ['.prizm', '.git', 'node_modules', 'dist']
  try {
    const raw = fs.readFileSync(scopeJsonPath, 'utf-8')
    const json = JSON.parse(raw) as { settings?: { excludePatterns?: string[] } }
    const patterns = json.settings?.excludePatterns
    if (Array.isArray(patterns)) return ['.prizm', '.git', ...patterns]
  } catch {}
  return ['.prizm', '.git', 'node_modules', 'dist']
}

/** 生成不冲突的文件路径，若已存在则加 (2), (3) 等后缀 */
function resolveConflict(
  dir: string,
  baseName: string,
  ext: string,
  excludePath?: string
): string {
  let candidate = path.join(dir, baseName + ext)
  if (!fs.existsSync(candidate) || candidate === excludePath) return candidate
  let counter = 2
  while (true) {
    candidate = path.join(dir, `${baseName} (${counter})${ext}`)
    if (!fs.existsSync(candidate) || candidate === excludePath) return candidate
    counter++
  }
}

function readScopeDataVersion(scopeRoot: string): number {
  const scopeJsonPath = getScopeJsonPath(scopeRoot)
  if (!fs.existsSync(scopeJsonPath)) return 0
  try {
    const raw = fs.readFileSync(scopeJsonPath, 'utf-8')
    const json = JSON.parse(raw) as { dataVersion?: number }
    return typeof json.dataVersion === 'number' ? json.dataVersion : 0
  } catch {
    return 0
  }
}

function writeDataVersion3(scopeRoot: string): void {
  const scopeJsonPath = getScopeJsonPath(scopeRoot)
  const prizmDir = path.dirname(scopeJsonPath)
  if (!fs.existsSync(prizmDir)) {
    fs.mkdirSync(prizmDir, { recursive: true })
  }
  let json: Record<string, unknown> = {}
  if (fs.existsSync(scopeJsonPath)) {
    try {
      const raw = fs.readFileSync(scopeJsonPath, 'utf-8')
      json = JSON.parse(raw) as Record<string, unknown>
    } catch {}
  }
  json.dataVersion = 3
  fs.writeFileSync(scopeJsonPath, JSON.stringify(json, null, 2), 'utf-8')
  log.info('Wrote dataVersion 3 to scope.json')
}

/**
 * Migrate scope data to V3 format.
 * Runs during ScopeStore initialization.
 */
export function migrateToV3(scopeRoot: string): void {
  if (!fs.existsSync(scopeRoot)) return
  const dataVersion = readScopeDataVersion(scopeRoot)
  if (dataVersion >= 3) return

  log.info('Starting V3 migration for scope', scopeRoot)

  const excludes = getScopeExcludePatterns(scopeRoot)
  const files = scanUserFiles(scopeRoot, excludes)

  // 1. StickyNote -> Document migration
  for (const fp of files) {
    if (!fs.existsSync(fp)) continue
    let raw: string
    try {
      raw = fs.readFileSync(fp, 'utf-8')
    } catch (e) {
      log.warn('Failed to read file', fp, e)
      continue
    }
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    if (data.prizm_type !== 'note') continue

    const content = parsed.content.trim()
    const title =
      content.slice(0, 30).trim().replace(/\s+/g, ' ') || 'untitled'
    const id = typeof data.id === 'string' && data.id ? data.id : genUniqueId()

    const frontmatter: Record<string, unknown> = {
      prizm_type: 'document',
      id,
      title,
      createdAt: data.createdAt ?? 0,
      updatedAt: data.updatedAt ?? 0
    }
    if (data.tags != null && Array.isArray(data.tags)) {
      frontmatter.tags = data.tags
    }

    const dir = path.dirname(fp)
    const baseName = sanitizeFileName(title)
    const targetPath = resolveConflict(dir, baseName, EXT, fp)

    try {
      const out = matter.stringify(content, frontmatter, { lineWidth: -1 } as never)
      fs.writeFileSync(targetPath, out, 'utf-8')
      if (targetPath !== fp) {
        fs.unlinkSync(fp)
      }
      log.info('Migrated note -> document', fp, '->', targetPath, 'title:', title)
    } catch (e) {
      log.error('Failed to migrate note', fp, e)
    }
  }

  // 2. ID filename -> title filename for documents (re-scan after note migration)
  const filesAfterNotes = scanUserFiles(scopeRoot, excludes)
  for (const fp of filesAfterNotes) {
    if (!fs.existsSync(fp)) continue
    let raw: string
    try {
      raw = fs.readFileSync(fp, 'utf-8')
    } catch (e) {
      log.warn('Failed to read file', fp, e)
      continue
    }
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    if (data.prizm_type !== 'document') continue

    const baseName = path.basename(fp)
    if (!ID_FILENAME_REGEX.test(baseName)) continue

    const title = (typeof data.title === 'string' ? data.title : '').trim() || 'untitled'
    const expectedBaseName = sanitizeFileName(title) + EXT
    if (baseName === expectedBaseName) continue

    const dir = path.dirname(fp)
    const targetPath = resolveConflict(dir, sanitizeFileName(title), EXT, fp)

    try {
      fs.renameSync(fp, targetPath)
      log.info('Renamed ID-named document to title', fp, '->', targetPath)
    } catch (e) {
      log.warn('Failed to rename document (target may exist), copying', fp)
      try {
        fs.copyFileSync(fp, targetPath)
        fs.unlinkSync(fp)
        log.info('Copied and removed old file', fp, '->', targetPath)
      } catch (e2) {
        log.error('Failed to rename document', fp, e2)
      }
    }
  }

  // 3. Remove .prizm/pomodoro/
  const pomodoroDir = getPomodoroDir(scopeRoot)
  if (fs.existsSync(pomodoroDir)) {
    try {
      fs.rmSync(pomodoroDir, { recursive: true })
      log.info('Removed pomodoro directory', pomodoroDir)
    } catch (e) {
      log.warn('Failed to remove pomodoro directory', pomodoroDir, e)
    }
  }

  // 4. Write dataVersion: 3 to scope.json
  writeDataVersion3(scopeRoot)
  log.info('V3 migration complete for scope', scopeRoot)
}
