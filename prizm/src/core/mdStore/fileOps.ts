/**
 * Layer 0: generic file operations (read, write, list, move, delete, stat).
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { FileEntry, FileReadResult } from '../../types'
import { ensureDir, readPrizmType } from './utils'

/** 验证相对路径安全性，防止路径遍历 */
export function validateRelativePath(relativePath: string): boolean {
  const normalized = path.normalize(relativePath)
  if (path.isAbsolute(normalized)) return false
  if (normalized.startsWith('..')) return false
  if (normalized.includes('\0')) return false
  return true
}

/** 检查路径是否在 .prizm 系统目录内 */
export function isSystemPath(relativePath: string): boolean {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/')
  return normalized.startsWith('.prizm/') || normalized === '.prizm'
}

/** 通用文件读取 */
export function readFileByPath(
  scopeRoot: string,
  relativePath: string
): FileReadResult | null {
  if (!validateRelativePath(relativePath)) return null
  const fullPath = path.join(scopeRoot, relativePath)
  if (!fs.existsSync(fullPath)) return null
  try {
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) return null
    const result: FileReadResult = {
      relativePath,
      size: stat.size,
      lastModified: stat.mtimeMs
    }
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      if (fullPath.endsWith('.md')) {
        const parsed = matter(raw)
        const data = parsed.data as Record<string, unknown>
        const prizmType = readPrizmType(data)
        if (prizmType) {
          result.frontmatter = data
          result.prizmType = prizmType
        }
        result.content = parsed.content.trim()
      } else {
        result.content = raw
      }
    } catch {
      // Binary or unreadable file - return metadata only
    }
    return result
  } catch {
    return null
  }
}

/** 通用文件写入 */
export function writeFileByPath(
  scopeRoot: string,
  relativePath: string,
  content: string
): boolean {
  if (!validateRelativePath(relativePath)) return false
  const fullPath = path.join(scopeRoot, relativePath)
  const dir = path.dirname(fullPath)
  ensureDir(dir)
  fs.writeFileSync(fullPath, content, 'utf-8')
  return true
}

/** 列出目录内容 */
export function listDirectory(
  scopeRoot: string,
  relativePath: string,
  options?: { recursive?: boolean; includeSystem?: boolean }
): FileEntry[] {
  const dirPath = relativePath ? path.join(scopeRoot, relativePath) : scopeRoot
  if (!fs.existsSync(dirPath)) return []

  const recursive = options?.recursive ?? false
  const includeSystem = options?.includeSystem ?? false
  const result: FileEntry[] = []

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const e of entries) {
      const entryRelPath = relativePath ? `${relativePath}/${e.name}` : e.name

      if (!includeSystem && e.name.startsWith('.')) continue

      const fullPath = path.join(dirPath, e.name)
      const entry: FileEntry = {
        name: e.name,
        relativePath: entryRelPath.replace(/\\/g, '/'),
        isDir: e.isDirectory(),
        isFile: e.isFile()
      }

      if (e.isFile()) {
        try {
          const stat = fs.statSync(fullPath)
          entry.size = stat.size
          entry.lastModified = stat.mtimeMs
        } catch {}

        if (e.name.endsWith('.md')) {
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8')
            const parsed = matter(raw)
            const data = parsed.data as Record<string, unknown>
            const prizmType = readPrizmType(data)
            if (prizmType) {
              entry.prizmType = prizmType
              entry.prizmId = typeof data.id === 'string' ? data.id : undefined
            }
          } catch {}
        }
      }

      if (e.isDirectory() && recursive) {
        entry.children = listDirectory(scopeRoot, entryRelPath, options)
      }

      result.push(entry)
    }
  } catch {}

  return result
}

/** 创建目录 */
export function mkdirByPath(scopeRoot: string, relativePath: string): boolean {
  if (!validateRelativePath(relativePath)) return false
  if (isSystemPath(relativePath)) return false
  const fullPath = path.join(scopeRoot, relativePath)
  ensureDir(fullPath)
  return true
}

/** 移动/重命名文件或目录 */
export function moveFile(
  scopeRoot: string,
  fromRelPath: string,
  toRelPath: string
): boolean {
  if (!validateRelativePath(fromRelPath) || !validateRelativePath(toRelPath))
    return false
  const fromFull = path.join(scopeRoot, fromRelPath)
  const toFull = path.join(scopeRoot, toRelPath)
  if (!fs.existsSync(fromFull)) return false
  const toDir = path.dirname(toFull)
  ensureDir(toDir)
  fs.renameSync(fromFull, toFull)
  return true
}

/** 删除文件或目录 */
export function deleteByPath(scopeRoot: string, relativePath: string): boolean {
  if (!validateRelativePath(relativePath)) return false
  if (isSystemPath(relativePath)) return false
  const fullPath = path.join(scopeRoot, relativePath)
  if (!fs.existsSync(fullPath)) return false
  const stat = fs.statSync(fullPath)
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true })
  } else {
    fs.unlinkSync(fullPath)
  }
  return true
}

/** 获取文件元信息 */
export function statByPath(
  scopeRoot: string,
  relativePath: string
): { size: number; lastModified: number; isDir: boolean; isFile: boolean } | null {
  if (!validateRelativePath(relativePath)) return null
  const fullPath = path.join(scopeRoot, relativePath)
  if (!fs.existsSync(fullPath)) return null
  try {
    const stat = fs.statSync(fullPath)
    return {
      size: stat.size,
      lastModified: stat.mtimeMs,
      isDir: stat.isDirectory(),
      isFile: stat.isFile()
    }
  } catch {
    return null
  }
}
