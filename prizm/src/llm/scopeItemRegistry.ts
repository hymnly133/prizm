/**
 * Scope 统一项目注册表
 * 顶层元素：便签列表(notes)、待办列表(todoList)、文档(document)、会话列表(sessions)
 * 可引用项：便签项(note)、待办项(todo)、文档(document)，具备统一 id 结构
 */

import { scopeStore } from '../core/ScopeStore'
import type { ScopeData } from '../core/ScopeStore'

/** 顶层聚合类型 */
export type ScopeTopLevelKind = 'notes' | 'todoList' | 'document' | 'sessions'

/** 可引用项类型（用于 @ 与工具）；会话暂不可引用详情 */
export type ScopeRefKind = 'note' | 'todo' | 'document'

/** 短内容阈值（字符） */
const SHORT_CONTENT_THRESHOLD = 500

/** 顶层元素：列表/集合级或单文档 */
export interface ScopeTopLevelItem {
  kind: ScopeTopLevelKind
  id: string
  title: string
  itemCount: number
  totalCharCount: number
  updatedAt: number
  /** false 表示仅元信息，不提供详情（如 sessions） */
  dataAvailable?: boolean
}

/** 可引用的单条项 */
export interface ScopeRefItem {
  id: string
  kind: ScopeRefKind
  title: string
  charCount: number
  isShort: boolean
  updatedAt: number
  groupOrStatus?: string
}

/** 可引用项详情（含全文） */
export interface ScopeRefItemDetail extends ScopeRefItem {
  content: string
  summary?: string
}

/** 工作区统计 */
export interface ScopeStats {
  totalItems: number
  totalChars: number
  byKind: Record<ScopeTopLevelKind, { count: number; chars: number }>
}

function getData(scope: string): ScopeData {
  return scopeStore.getScopeData(scope)
}

function noteToRefItem(
  n: { id: string; content: string; updatedAt: number; groupId?: string },
  groupName?: string
): ScopeRefItem {
  const content = (n.content ?? '').trim()
  const charCount = content.length
  return {
    id: n.id,
    kind: 'note',
    title: content.slice(0, 30) + (content.length > 30 ? '…' : ''),
    charCount,
    isShort: charCount < SHORT_CONTENT_THRESHOLD,
    updatedAt: n.updatedAt ?? 0,
    groupOrStatus: groupName
  }
}

function todoToRefItem(it: {
  id: string
  title: string
  status: string
  updatedAt?: number
}): ScopeRefItem {
  const desc = (it as { description?: string }).description ?? ''
  const charCount = (it.title?.length ?? 0) + desc.length
  return {
    id: it.id,
    kind: 'todo',
    title: (it.title ?? '').trim() || '(无标题)',
    charCount,
    isShort: charCount < SHORT_CONTENT_THRESHOLD,
    updatedAt: (it.updatedAt as number) ?? 0,
    groupOrStatus: it.status
  }
}

function docToRefItem(d: {
  id: string
  title: string
  content?: string
  updatedAt: number
  llmSummary?: string
}): ScopeRefItem {
  const content = (d.content ?? '').trim()
  const charCount = content.length
  return {
    id: d.id,
    kind: 'document',
    title: (d.title ?? '').trim() || '(无标题)',
    charCount,
    isShort: charCount < SHORT_CONTENT_THRESHOLD,
    updatedAt: d.updatedAt ?? 0,
    groupOrStatus: undefined
  }
}

/**
 * 返回顶层元素列表（notes、todoList、各 document、sessions）
 */
export function listTopLevel(scope: string): ScopeTopLevelItem[] {
  const data = getData(scope)
  const result: ScopeTopLevelItem[] = []

  // notes：便签列表作为一个顶层
  const notesCharCount = data.notes.reduce((sum, n) => sum + ((n.content ?? '').length || 0), 0)
  const notesUpdated = data.notes.length ? Math.max(...data.notes.map((n) => n.updatedAt ?? 0)) : 0
  result.push({
    kind: 'notes',
    id: 'notes',
    title: '便签',
    itemCount: data.notes.length,
    totalCharCount: notesCharCount,
    updatedAt: notesUpdated,
    dataAvailable: true
  })

  // todoList：每个 list 一个顶层项
  for (const list of data.todoLists ?? []) {
    const items = list.items ?? []
    const todoCharCount = items.reduce(
      (sum, it) =>
        sum + (it.title?.length ?? 0) + ((it as { description?: string }).description?.length ?? 0),
      0
    )
    result.push({
      kind: 'todoList',
      id: list.id,
      title: list.title ?? '待办',
      itemCount: items.length,
      totalCharCount: todoCharCount,
      updatedAt: list.updatedAt ?? 0,
      dataAvailable: true
    })
  }

  // documents：每个文档一个顶层
  for (const d of data.documents) {
    const content = (d.content ?? '').trim()
    result.push({
      kind: 'document',
      id: d.id,
      title: (d.title ?? '').trim() || '(无标题)',
      itemCount: 1,
      totalCharCount: content.length,
      updatedAt: d.updatedAt ?? 0,
      dataAvailable: true
    })
  }

  // sessions：仅元信息，不提供详情（TODO）
  const sessionsUpdated = data.agentSessions.length
    ? Math.max(...data.agentSessions.map((s) => s.updatedAt ?? 0))
    : 0
  result.push({
    kind: 'sessions',
    id: 'sessions',
    title: '会话',
    itemCount: data.agentSessions.length,
    totalCharCount: 0,
    updatedAt: sessionsUpdated,
    dataAvailable: false
  })

  return result
}

/**
 * 返回可引用项列表（便签项、待办项、文档），用于 @ 补全与工具
 */
export function listRefItems(scope: string, kind?: ScopeRefKind): ScopeRefItem[] {
  const data = getData(scope)
  const out: ScopeRefItem[] = []
  const groupMap = new Map(data.groups.map((g) => [g.id, g.name]))

  if (!kind || kind === 'note') {
    for (const n of data.notes) {
      out.push(noteToRefItem(n, n.groupId ? groupMap.get(n.groupId) : undefined))
    }
  }
  if (!kind || kind === 'todo') {
    for (const list of data.todoLists ?? []) {
      for (const it of list.items ?? []) {
        out.push(todoToRefItem(it))
      }
    }
  }
  if (!kind || kind === 'document') {
    for (const d of data.documents) {
      out.push(docToRefItem(d))
    }
  }

  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/**
 * 获取单条可引用项详情；sessions 不提供详情（TODO）
 */
export function getScopeRefItem(
  scope: string,
  kind: ScopeRefKind,
  id: string
): ScopeRefItemDetail | null {
  const data = getData(scope)
  const groupMap = new Map(data.groups.map((g) => [g.id, g.name]))

  if (kind === 'note') {
    const n = data.notes.find((x) => x.id === id)
    if (!n) return null
    const content = (n.content ?? '').trim()
    const base = noteToRefItem(n, n.groupId ? groupMap.get(n.groupId) : undefined)
    return { ...base, content, summary: undefined }
  }

  if (kind === 'todo') {
    for (const list of data.todoLists ?? []) {
      const it = (list.items ?? []).find((x) => x.id === id)
      if (it) {
        const desc = (it as { description?: string }).description ?? ''
        const content = `${it.title ?? ''}\n${desc}`.trim()
        const base = todoToRefItem(it)
        return { ...base, content, summary: undefined }
      }
    }
    return null
  }

  if (kind === 'document') {
    const d = data.documents.find((x) => x.id === id)
    if (!d) return null
    const content = (d.content ?? '').trim()
    const base = docToRefItem(d)
    return { ...base, content, summary: d.llmSummary }
  }

  return null
}

/**
 * 工作区统计
 */
export function getScopeStats(scope: string): ScopeStats {
  const data = getData(scope)
  const byKind: ScopeStats['byKind'] = {
    notes: {
      count: data.notes.length,
      chars: data.notes.reduce((s, n) => s + (n.content ?? '').length, 0)
    },
    todoList: {
      count: (data.todoLists ?? []).reduce((n, l) => n + (l.items?.length ?? 0), 0),
      chars: (data.todoLists ?? []).reduce(
        (s, l) =>
          s +
          (l.items ?? []).reduce(
            (a, it) =>
              a +
              (it.title?.length ?? 0) +
              ((it as { description?: string }).description?.length ?? 0),
            0
          ),
        0
      )
    },
    document: {
      count: data.documents.length,
      chars: data.documents.reduce((s, d) => s + (d.content ?? '').length, 0)
    },
    sessions: { count: data.agentSessions.length, chars: 0 }
  }

  const totalItems =
    byKind.notes.count + byKind.todoList.count + byKind.document.count + byKind.sessions.count
  const totalChars = byKind.notes.chars + byKind.todoList.chars + byKind.document.chars

  return { totalItems, totalChars, byKind }
}

/**
 * 全文搜索（便签项、待办、文档）
 */
export function searchScopeItems(scope: string, query: string): ScopeRefItem[] {
  if (!query?.trim()) return listRefItems(scope)
  const q = query.trim().toLowerCase()
  const candidates = listRefItems(scope)
  const data = getData(scope)
  const groupMap = new Map(data.groups.map((g) => [g.id, g.name]))
  const matched = new Set<string>()

  for (const ref of candidates) {
    const detail = getScopeRefItem(scope, ref.kind, ref.id)
    if (!detail) continue
    const searchable = `${ref.title} ${detail.content}`.toLowerCase()
    if (searchable.includes(q)) matched.add(`${ref.kind}:${ref.id}`)
  }

  return candidates.filter((r) => matched.has(`${r.kind}:${r.id}`))
}
