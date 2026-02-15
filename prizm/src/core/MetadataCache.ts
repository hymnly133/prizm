/**
 * MetadataCache - scope 内 .md 文件的元数据索引
 * 用于加速 getScopeData 查询，支持增量更新
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { createLogger } from '../logger'
import { getCacheJsonPath } from './PathProviderCore'

const log = createLogger('MetadataCache')

export interface CachedFile {
  relativePath: string
  mtime: number
  size: number
  frontmatter: Record<string, unknown>
  prizmType: string | null
  tags: string[]
}

export interface ScopeMetadataCache {
  version: number
  files: CachedFile[]
  lastFullScan: number
}

function extractTags(data: Record<string, unknown>): string[] {
  const tags = data.tags
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === 'string')
  }
  if (typeof tags === 'string') {
    return [tags]
  }
  return []
}

function readPrizmType(data: Record<string, unknown>): string | null {
  const t = data.prizm_type
  return typeof t === 'string' && t ? t : null
}

/**
 * 递归扫描 scope root 下所有 .md 文件，排除 .prizm、.git 等
 */
export function scanUserFiles(
  scopeRoot: string,
  excludePatterns: string[] = ['.prizm', '.git', 'node_modules', 'dist']
): string[] {
  const result: string[] = []
  if (!fs.existsSync(scopeRoot)) return result

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const rel = path.relative(scopeRoot, full)
      if (e.isDirectory()) {
        const base = e.name
        if (base.startsWith('.')) continue
        if (excludePatterns.some((p) => base === p || rel.includes(p))) continue
        walk(full)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        result.push(full)
      }
    }
  }

  walk(scopeRoot)
  return result
}

/**
 * 从文件解析 frontmatter 并提取 prizm_type、tags
 */
export function parseFileMetadata(filePath: string): CachedFile | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const stat = fs.statSync(filePath)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const tags = extractTags(data)
    const prizmType = readPrizmType(data)
    return {
      relativePath: filePath,
      mtime: stat.mtimeMs,
      size: stat.size,
      frontmatter: data,
      prizmType,
      tags
    }
  } catch (e) {
    log.warn('Failed to parse file', filePath, e)
    return null
  }
}

/**
 * 加载或构建 scope 的 MetadataCache
 */
export function loadScopeCache(
  scopeRoot: string,
  _scopePrizmDir?: string,
  excludePatterns?: string[]
): ScopeMetadataCache {
  const cachePath = getCacheJsonPath(scopeRoot)
  const excludes = excludePatterns ?? ['.prizm', '.git', 'node_modules', 'dist']
  const files = scanUserFiles(scopeRoot, excludes)
  const now = Date.now()

  let cached: ScopeMetadataCache | null = null
  if (fs.existsSync(cachePath)) {
    try {
      const raw = fs.readFileSync(cachePath, 'utf-8')
      cached = JSON.parse(raw) as ScopeMetadataCache
    } catch {
      cached = null
    }
  }

  const cacheMap = new Map<string, CachedFile>()
  if (cached?.files) {
    for (const f of cached.files) {
      cacheMap.set(f.relativePath, f)
    }
  }

  const result: CachedFile[] = []
  for (const fp of files) {
    const rel = path.relative(scopeRoot, fp).replace(/\\/g, '/')
    const stat = fs.statSync(fp)
    const existing = cacheMap.get(rel)
    if (existing && existing.mtime === stat.mtimeMs && existing.size === stat.size) {
      result.push({ ...existing, relativePath: rel })
      continue
    }
    const parsed = parseFileMetadata(fp)
    if (parsed) {
      parsed.relativePath = rel
      result.push(parsed)
    }
  }

  return {
    version: 1,
    files: result,
    lastFullScan: now
  }
}

/**
 * 持久化 cache 到 .prizm/cache.json
 */
export function saveScopeCache(scopeRootOrPrizmDir: string, cache: ScopeMetadataCache): void {
  const cachePath =
    path.basename(scopeRootOrPrizmDir) === '.prizm'
      ? path.join(scopeRootOrPrizmDir, 'cache.json')
      : getCacheJsonPath(scopeRootOrPrizmDir)
  const dir = path.dirname(cachePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const toSave = {
    ...cache,
    files: cache.files.map((f) => ({
      ...f,
      relativePath: f.relativePath
    }))
  }
  fs.writeFileSync(cachePath, JSON.stringify(toSave, null, 2), 'utf-8')
}
