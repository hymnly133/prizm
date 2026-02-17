/**
 * Shared utilities for mdStore: frontmatter helpers, file listing, path resolution.
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { getScopeJsonPath } from '../PathProviderCore'
import { scanUserFiles } from '../MetadataCache'
import { createLogger } from '../../logger'

const log = createLogger('mdStore')
export const EXT = '.md'

export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
}

/** 将标题清洗为合法文件名 */
export function sanitizeFileName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'untitled'
  )
}

/** 生成不冲突的文件路径，若已存在则加 (2), (3) 等后缀 */
export function resolveConflict(
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

/**
 * 递归移除对象中的 undefined 值，防止 js-yaml dump 报错。
 * 作为序列化边界的防御层，上游应尽量避免传入 undefined。
 * 返回清洗后的对象和检测到的 undefined 字段路径列表。
 */
export function stripUndefined(
  obj: unknown,
  keyPath = '',
  undefinedPaths?: string[]
): unknown {
  if (obj === undefined) {
    undefinedPaths?.push(keyPath || '(root)')
    return null
  }
  if (obj === null || typeof obj !== 'object' || obj instanceof Date) return obj
  if (Array.isArray(obj)) {
    return obj.map((v, i) =>
      stripUndefined(v, keyPath ? `${keyPath}[${i}]` : `[${i}]`, undefinedPaths)
    )
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key
    if (value === undefined) {
      undefinedPaths?.push(childPath)
      continue
    }
    result[key] = stripUndefined(value, childPath, undefinedPaths)
  }
  return result
}

export function writeMd(
  filePath: string,
  frontmatter: Record<string, unknown>,
  body = ''
): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const undefinedPaths: string[] = []
  const safeFrontmatter = stripUndefined(frontmatter, '', undefinedPaths) as Record<string, unknown>
  if (undefinedPaths.length > 0) {
    log.warn(`Frontmatter contains undefined values (stripped before write)`, {
      file: path.basename(filePath),
      paths: undefinedPaths
    })
  }
  const content = matter.stringify(body, safeFrontmatter, { lineWidth: -1 } as any)
  fs.writeFileSync(filePath, content, 'utf-8')
}

export function readMd(
  filePath: string
): { data: Record<string, unknown>; content: string } | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = matter(raw)
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content.trim()
    }
  } catch {
    return null
  }
}

export function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(EXT))
    .map((e) => path.join(dir, e.name))
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function readPrizmType(data: Record<string, unknown>): string | null {
  const t = data.prizm_type
  return typeof t === 'string' && t ? t : null
}

export function getScopeExcludePatterns(scopeRoot: string): string[] {
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

/** 按 prizm_type 读取用户文件 */
export function readUserFilesByType<T>(
  scopeRoot: string,
  prizmType: string,
  parser: (fp: string, data: Record<string, unknown>, content: string) => T | null
): T[] {
  const excludes = getScopeExcludePatterns(scopeRoot)
  const files = scanUserFiles(scopeRoot, excludes)
  const result: T[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed || readPrizmType(parsed.data) !== prizmType) continue
    const item = parser(fp, parsed.data, parsed.content)
    if (item) result.push(item)
  }
  return result
}

/** 读取 .prizm/ 下系统子目录的文件 */
export function readSystemFiles<T>(
  scopeRoot: string,
  subdirGetter: (scopeRoot: string) => string,
  parser: (fp: string, data: Record<string, unknown>, content: string) => T | null
): T[] {
  const dir = subdirGetter(scopeRoot)
  if (!fs.existsSync(dir)) return []
  const files = listMdFiles(dir)
  const result: T[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const item = parser(fp, parsed.data, parsed.content)
    if (item) result.push(item)
  }
  return result
}
