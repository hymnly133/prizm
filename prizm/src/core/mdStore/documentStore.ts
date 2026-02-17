/**
 * Layer 1: Documents (prizm_type: document) CRUD and legacy notes.
 */

import fs from 'fs'
import path from 'path'
import type { Document, StickyNote } from '../../types'
import { scanUserFiles } from '../MetadataCache'
import {
  EXT,
  readMd,
  writeMd,
  readUserFilesByType,
  getScopeExcludePatterns,
  sanitizeFileName,
  resolveConflict,
  ensureDir,
  readPrizmType
} from './utils'

function parseDocument(
  fp: string,
  d: Record<string, unknown>,
  content: string,
  scopeRoot: string
): Document | null {
  const id = typeof d.id === 'string' ? d.id : null
  if (!id) return null
  const title = typeof d.title === 'string' ? d.title : path.basename(fp, EXT)
  const tags = d.tags
  const tagList = Array.isArray(tags)
    ? (tags as string[]).filter((t): t is string => typeof t === 'string')
    : []
  const relativePath = path.relative(scopeRoot, fp).replace(/\\/g, '/')
  return {
    id,
    title,
    content: content || undefined,
    tags: tagList.length ? tagList : undefined,
    /** @deprecated 兼容读取存量数据，新文档不再写入此字段 */
    llmSummary: typeof d.llmSummary === 'string' ? d.llmSummary : undefined,
    relativePath,
    createdAt: (d.createdAt as number) ?? 0,
    updatedAt: (d.updatedAt as number) ?? 0
  }
}

export function readDocuments(scopeRoot: string): Document[] {
  const docs = readUserFilesByType(scopeRoot, 'document', (fp, d, c) =>
    parseDocument(fp, d, c, scopeRoot)
  )
  return docs.sort((a, b) => a.createdAt - b.createdAt)
}

export function writeDocuments(scopeRoot: string, docs: Document[]): void {
  const excludes = getScopeExcludePatterns(scopeRoot)
  const existing = new Map<string, string>()
  for (const fp of scanUserFiles(scopeRoot, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'document') {
      const id = p.data.id as string
      if (id) existing.set(id, fp)
    }
  }
  const ids = new Set(docs.map((d) => d.id))
  for (const d of docs) {
    const frontmatter: Record<string, unknown> = {
      prizm_type: 'document',
      id: d.id,
      title: d.title,
      ...(d.tags?.length && { tags: d.tags }),
      // @deprecated llmSummary: 兼容回写存量数据，新文档不再产生此字段
      ...(d.llmSummary != null && { llmSummary: d.llmSummary }),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt
    }
    const existingPath = existing.get(d.id)
    let fp: string
    if (existingPath) {
      const oldBaseName = path.basename(existingPath, EXT)
      const expectedBaseName = sanitizeFileName(d.title)
      if (oldBaseName !== expectedBaseName) {
        const dir = path.dirname(existingPath)
        fp = resolveConflict(dir, expectedBaseName, EXT, existingPath)
        if (existingPath !== fp) {
          try {
            fs.unlinkSync(existingPath)
          } catch {}
        }
      } else {
        fp = existingPath
      }
    } else {
      const dir = d.relativePath ? path.dirname(path.join(scopeRoot, d.relativePath)) : scopeRoot
      ensureDir(dir)
      fp = resolveConflict(dir, sanitizeFileName(d.title), EXT)
    }
    writeMd(fp, frontmatter, d.content ?? '')
  }
  for (const [id, fp] of existing) {
    if (!ids.has(id)) {
      try {
        fs.unlinkSync(fp)
      } catch {}
    }
  }
}

/** Write a single document (for create/update operations) */
export function writeSingleDocument(scopeRoot: string, doc: Document): string {
  const frontmatter: Record<string, unknown> = {
    prizm_type: 'document',
    id: doc.id,
    title: doc.title,
    ...(doc.tags?.length && { tags: doc.tags }),
    // @deprecated llmSummary: 兼容回写存量数据，新文档不再产生此字段
    ...(doc.llmSummary != null && { llmSummary: doc.llmSummary }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }

  const excludes = getScopeExcludePatterns(scopeRoot)
  let existingPath: string | undefined
  for (const fp of scanUserFiles(scopeRoot, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'document' && p.data.id === doc.id) {
      existingPath = fp
      break
    }
  }

  let fp: string
  if (existingPath) {
    const oldBaseName = path.basename(existingPath, EXT)
    const expectedBaseName = sanitizeFileName(doc.title)
    if (oldBaseName !== expectedBaseName) {
      const dir = path.dirname(existingPath)
      fp = resolveConflict(dir, expectedBaseName, EXT, existingPath)
      if (existingPath !== fp) {
        try {
          fs.unlinkSync(existingPath)
        } catch {}
      }
    } else {
      fp = existingPath
    }
  } else {
    const dir = doc.relativePath ? path.dirname(path.join(scopeRoot, doc.relativePath)) : scopeRoot
    ensureDir(dir)
    fp = resolveConflict(dir, sanitizeFileName(doc.title), EXT)
  }

  writeMd(fp, frontmatter, doc.content ?? '')
  return path.relative(scopeRoot, fp).replace(/\\/g, '/')
}

/** Delete a single document by ID */
export function deleteSingleDocument(scopeRoot: string, docId: string): boolean {
  const excludes = getScopeExcludePatterns(scopeRoot)
  for (const fp of scanUserFiles(scopeRoot, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'document' && p.data.id === docId) {
      try {
        fs.unlinkSync(fp)
        return true
      } catch {
        return false
      }
    }
  }
  return false
}

/** Read a single document by ID from the given root directory */
export function readSingleDocumentById(root: string, docId: string): Document | null {
  const excludes = getScopeExcludePatterns(root)
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'document' && p.data.id === docId) {
      return parseDocument(fp, p.data, p.content, root)
    }
  }
  return null
}

// ============ Legacy: Notes 读取（仅用于迁移） ============

/** @deprecated 仅用于迁移，读取旧的 note 类型文件 */
export function readLegacyNotes(scopeRoot: string): StickyNote[] {
  function parseNote(_fp: string, d: Record<string, unknown>, content: string): StickyNote | null {
    const id = typeof d.id === 'string' ? d.id : null
    if (!id) return null
    const tags = d.tags
    const tagList = Array.isArray(tags)
      ? (tags as string[]).filter((t): t is string => typeof t === 'string')
      : []
    return {
      id,
      content,
      imageUrls: Array.isArray(d.imageUrls) ? (d.imageUrls as string[]) : undefined,
      createdAt: (d.createdAt as number) ?? 0,
      updatedAt: (d.updatedAt as number) ?? 0,
      tags: tagList.length ? tagList : undefined,
      fileRefs: Array.isArray(d.fileRefs) ? (d.fileRefs as { path: string }[]) : undefined
    }
  }
  return readUserFilesByType(scopeRoot, 'note', parseNote)
}
