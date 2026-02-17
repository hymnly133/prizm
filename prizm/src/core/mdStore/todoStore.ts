/**
 * Layer 1: TodoList (prizm_type: todo_list) CRUD.
 */

import fs from 'fs'
import path from 'path'
import type { TodoList, TodoItem, TodoItemStatus } from '../../types'
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

function parseTodoItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  const title = typeof r.title === 'string' ? r.title : '(无标题)'
  if (!id) return null
  const status = (
    r.status === 'todo' || r.status === 'doing' || r.status === 'done' ? r.status : 'todo'
  ) as TodoItemStatus
  return {
    id,
    title,
    description: typeof r.description === 'string' ? r.description : undefined,
    status,
    createdAt: (r.createdAt as number) ?? 0,
    updatedAt: (r.updatedAt as number) ?? 0
  }
}

function parseTodoList(
  fp: string,
  d: Record<string, unknown>,
  _content: string,
  scopeRoot: string
): TodoList | null {
  const id = typeof d.id === 'string' ? d.id : null
  if (!id) return null
  let items: TodoItem[] = []
  if (Array.isArray(d.items) && d.items.length > 0) {
    items = d.items.map(parseTodoItem).filter((it): it is TodoItem => it !== null)
  }
  items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const relativePath = path.relative(scopeRoot, fp).replace(/\\/g, '/')
  return {
    id,
    title: typeof d.title === 'string' ? d.title : '待办',
    items,
    relativePath,
    createdAt: (d.createdAt as number) ?? 0,
    updatedAt: (d.updatedAt as number) ?? 0
  }
}

export function readTodoLists(scopeRoot: string): TodoList[] {
  const lists = readUserFilesByType(scopeRoot, 'todo_list', (fp, d, c) =>
    parseTodoList(fp, d, c, scopeRoot)
  )
  return lists.sort((a, b) => a.createdAt - b.createdAt)
}

export function writeTodoLists(scopeRoot: string, lists: TodoList[]): void {
  const excludes = getScopeExcludePatterns(scopeRoot)
  const existing = new Map<string, string>()
  for (const fp of scanUserFiles(scopeRoot, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'todo_list') {
      const id = p.data.id as string
      if (id) existing.set(id, fp)
    }
  }
  const ids = new Set(lists.map((l) => l.id))
  for (const list of lists) {
    const frontmatter: Record<string, unknown> = {
      prizm_type: 'todo_list',
      id: list.id,
      title: list.title,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      items: list.items.map((it) => ({
        id: it.id,
        title: it.title,
        status: it.status,
        ...(it.description && { description: it.description }),
        createdAt: it.createdAt ?? 0,
        updatedAt: it.updatedAt ?? 0
      }))
    }
    const existingPath = existing.get(list.id)
    let fp: string
    if (existingPath) {
      const oldBaseName = path.basename(existingPath, EXT)
      const expectedBaseName = sanitizeFileName(list.title)
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
      const dir = list.relativePath
        ? path.dirname(path.join(scopeRoot, list.relativePath))
        : scopeRoot
      ensureDir(dir)
      fp = resolveConflict(dir, sanitizeFileName(list.title), EXT)
    }
    writeMd(fp, frontmatter, '')
  }
  for (const [id, fp] of existing) {
    if (!ids.has(id)) {
      try {
        fs.unlinkSync(fp)
      } catch {}
    }
  }
}

/** Read a single todo list by ID from the given root directory */
export function readSingleTodoListById(root: string, listId: string): TodoList | null {
  const excludes = getScopeExcludePatterns(root)
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'todo_list' && p.data.id === listId) {
      return parseTodoList(fp, p.data, p.content, root)
    }
  }
  return null
}

/** Write a single todo list (for create/update operations) */
export function writeSingleTodoList(root: string, list: TodoList): string {
  const frontmatter: Record<string, unknown> = {
    prizm_type: 'todo_list',
    id: list.id,
    title: list.title,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    items: list.items.map((it) => ({
      id: it.id,
      title: it.title,
      status: it.status,
      ...(it.description && { description: it.description }),
      createdAt: it.createdAt ?? 0,
      updatedAt: it.updatedAt ?? 0
    }))
  }

  const excludes = getScopeExcludePatterns(root)
  let existingPath: string | undefined
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'todo_list' && p.data.id === list.id) {
      existingPath = fp
      break
    }
  }

  let fp: string
  if (existingPath) {
    const oldBaseName = path.basename(existingPath, EXT)
    const expectedBaseName = sanitizeFileName(list.title)
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
    const dir = list.relativePath ? path.dirname(path.join(root, list.relativePath)) : root
    ensureDir(dir)
    fp = resolveConflict(dir, sanitizeFileName(list.title), EXT)
  }

  writeMd(fp, frontmatter, '')
  return path.relative(root, fp).replace(/\\/g, '/')
}

/** Delete a single todo list by ID */
export function deleteSingleTodoList(root: string, listId: string): boolean {
  const excludes = getScopeExcludePatterns(root)
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'todo_list' && p.data.id === listId) {
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
