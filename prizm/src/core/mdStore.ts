/**
 * Markdown 单文件存储 - 使用 .md 文件 + YAML frontmatter 存储元数据
 * 每个实体一个文件，便于人工编辑与版本管理
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type {
  StickyNote,
  StickyNoteGroup,
  TodoList,
  TodoItem,
  TodoItemStatus,
  PomodoroSession,
  ClipboardItem,
  Document,
  AgentSession,
  AgentMessage
} from '../types'

const EXT = '.md'

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
}

/** 写入 MD 文件 */
function writeMd(filePath: string, frontmatter: Record<string, unknown>, body = ''): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = matter.stringify(body, frontmatter, { lineWidth: -1 })
  fs.writeFileSync(filePath, content, 'utf-8')
}

/** 读取 MD 文件 */
function readMd(filePath: string): { data: Record<string, unknown>; content: string } | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = matter(raw)
    return { data: parsed.data as Record<string, unknown>, content: parsed.content.trim() }
  } catch {
    return null
  }
}

/** 列出目录下所有 .md 文件（不含子目录） */
function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(EXT))
    .map((e) => path.join(dir, e.name))
}

/** 列出子目录名 */
function listSubdirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}

// ============ Notes ============

export function readNotes(dir: string): StickyNote[] {
  const notesDir = path.join(dir, 'notes')
  const files = listMdFiles(notesDir)
  const notes: StickyNote[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    notes.push({
      id,
      content: parsed.content,
      imageUrls: Array.isArray(d.imageUrls) ? (d.imageUrls as string[]) : undefined,
      createdAt: (d.createdAt as number) ?? 0,
      updatedAt: (d.updatedAt as number) ?? 0,
      groupId: typeof d.groupId === 'string' ? d.groupId : undefined,
      fileRefs: Array.isArray(d.fileRefs) ? (d.fileRefs as { path: string }[]) : undefined
    })
  }
  return notes.sort((a, b) => a.createdAt - b.createdAt)
}

export function writeNotes(dir: string, notes: StickyNote[]): void {
  const notesDir = path.join(dir, 'notes')
  const existing = new Set(listMdFiles(notesDir).map((fp) => path.basename(fp, EXT)))
  const ids = new Set(notes.map((n) => n.id))
  for (const n of notes) {
    const fp = path.join(notesDir, `${safeId(n.id)}${EXT}`)
    writeMd(
      fp,
      {
        id: n.id,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        ...(n.groupId && { groupId: n.groupId }),
        ...(n.imageUrls?.length && { imageUrls: n.imageUrls }),
        ...(n.fileRefs?.length && { fileRefs: n.fileRefs })
      },
      n.content
    )
  }
  for (const old of existing) {
    if (!ids.has(old)) {
      try {
        fs.unlinkSync(path.join(notesDir, `${old}${EXT}`))
      } catch {}
    }
  }
}

// ============ Groups ============

export function readGroups(dir: string): StickyNoteGroup[] {
  const groupsDir = path.join(dir, 'groups')
  const files = listMdFiles(groupsDir)
  const groups: StickyNoteGroup[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    const name = typeof d.name === 'string' ? d.name : parsed.content || '(未命名)'
    groups.push({ id, name })
  }
  return groups
}

export function writeGroups(dir: string, groups: StickyNoteGroup[]): void {
  const groupsDir = path.join(dir, 'groups')
  const existing = new Set(listMdFiles(groupsDir).map((fp) => path.basename(fp, EXT)))
  const ids = new Set(groups.map((g) => g.id))
  for (const g of groups) {
    const fp = path.join(groupsDir, `${safeId(g.id)}${EXT}`)
    writeMd(fp, { id: g.id, name: g.name }, '')
  }
  for (const old of existing) {
    if (!ids.has(old)) {
      try {
        fs.unlinkSync(path.join(groupsDir, `${old}${EXT}`))
      } catch {}
    }
  }
}

// ============ TodoList ============
// 存储格式：一个 list 一个文件，items 在 frontmatter 内部

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

export function readTodoList(dir: string): TodoList | null {
  const listPath = path.join(dir, 'todo', 'list.md')
  const parsed = readMd(listPath)
  if (!parsed) return null
  const d = parsed.data
  const id = typeof d.id === 'string' ? d.id : 'list'
  const title = typeof d.title === 'string' ? d.title : '待办'
  const createdAt = (d.createdAt as number) ?? 0
  const updatedAt = (d.updatedAt as number) ?? 0

  let items: TodoItem[] = []

  // 新格式：items 在 frontmatter 内
  if (Array.isArray(d.items) && d.items.length > 0) {
    items = d.items.map(parseTodoItem).filter((it): it is TodoItem => it !== null)
  } else {
    // 旧格式迁移：从 items/ 目录读取
    const itemsDir = path.join(dir, 'todo', 'items')
    if (fs.existsSync(itemsDir)) {
      const itemFiles = listMdFiles(itemsDir)
      for (const fp of itemFiles) {
        const p = readMd(fp)
        if (!p) continue
        const fd = p.data
        const itemId = typeof fd.id === 'string' ? fd.id : path.basename(fp, EXT)
        const status = (
          fd.status === 'todo' || fd.status === 'doing' || fd.status === 'done' ? fd.status : 'todo'
        ) as TodoItemStatus
        const desc = typeof fd.description === 'string' ? fd.description : p.content || undefined
        items.push({
          id: itemId,
          title: typeof fd.title === 'string' ? fd.title : '(无标题)',
          description: desc || undefined,
          status,
          createdAt: (fd.createdAt as number) ?? 0,
          updatedAt: (fd.updatedAt as number) ?? 0
        })
      }
    }
  }

  items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return { id, title, items, createdAt, updatedAt }
}

export function writeTodoList(dir: string, list: TodoList | null): void {
  const todoDir = path.join(dir, 'todo')
  const itemsDir = path.join(todoDir, 'items')
  if (!list) {
    if (fs.existsSync(todoDir)) {
      fs.rmSync(todoDir, { recursive: true })
    }
    return
  }
  if (!fs.existsSync(todoDir)) fs.mkdirSync(todoDir, { recursive: true })

  // 单文件格式：list + items 全部写入 list.md
  const frontmatter: Record<string, unknown> = {
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
  writeMd(path.join(todoDir, 'list.md'), frontmatter, '')

  // 删除旧格式 items 目录
  if (fs.existsSync(itemsDir)) {
    fs.rmSync(itemsDir, { recursive: true })
  }
}

// ============ Pomodoro ============

export function readPomodoroSessions(dir: string): PomodoroSession[] {
  const pomoDir = path.join(dir, 'pomodoro')
  const files = listMdFiles(pomoDir)
  const sessions: PomodoroSession[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    sessions.push({
      id,
      taskId: typeof d.taskId === 'string' ? d.taskId : undefined,
      startedAt: (d.startedAt as number) ?? 0,
      endedAt: (d.endedAt as number) ?? 0,
      durationMinutes: (d.durationMinutes as number) ?? 0,
      tag: typeof d.tag === 'string' ? d.tag : undefined
    })
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt)
}

export function writePomodoroSessions(dir: string, sessions: PomodoroSession[]): void {
  const pomoDir = path.join(dir, 'pomodoro')
  const existing = new Set(listMdFiles(pomoDir).map((fp) => path.basename(fp, EXT)))
  const ids = new Set(sessions.map((s) => s.id))
  for (const s of sessions) {
    const fp = path.join(pomoDir, `${safeId(s.id)}${EXT}`)
    writeMd(
      fp,
      {
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes: s.durationMinutes,
        ...(s.taskId && { taskId: s.taskId }),
        ...(s.tag && { tag: s.tag })
      },
      ''
    )
  }
  for (const old of existing) {
    if (!ids.has(old)) {
      try {
        fs.unlinkSync(path.join(pomoDir, `${old}${EXT}`))
      } catch {}
    }
  }
}

// ============ Clipboard ============

export function readClipboard(dir: string): ClipboardItem[] {
  const clipDir = path.join(dir, 'clipboard')
  const files = listMdFiles(clipDir)
  const items: ClipboardItem[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    const type = (
      d.type === 'text' || d.type === 'image' || d.type === 'file' || d.type === 'other'
        ? d.type
        : 'text'
    ) as ClipboardItem['type']
    items.push({
      id,
      type,
      content: parsed.content,
      sourceApp: typeof d.sourceApp === 'string' ? d.sourceApp : undefined,
      createdAt: (d.createdAt as number) ?? 0
    })
  }
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export function writeClipboard(dir: string, items: ClipboardItem[]): void {
  const clipDir = path.join(dir, 'clipboard')
  const existing = new Set(listMdFiles(clipDir).map((fp) => path.basename(fp, EXT)))
  const ids = new Set(items.map((i) => i.id))
  for (const it of items) {
    const fp = path.join(clipDir, `${safeId(it.id)}${EXT}`)
    writeMd(
      fp,
      {
        id: it.id,
        type: it.type,
        createdAt: it.createdAt,
        ...(it.sourceApp && { sourceApp: it.sourceApp })
      },
      it.content
    )
  }
  for (const old of existing) {
    if (!ids.has(old)) {
      try {
        fs.unlinkSync(path.join(clipDir, `${old}${EXT}`))
      } catch {}
    }
  }
}

// ============ Documents ============

export function readDocuments(dir: string): Document[] {
  const docsDir = path.join(dir, 'documents')
  const files = listMdFiles(docsDir)
  const docs: Document[] = []
  for (const fp of files) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    docs.push({
      id,
      title: typeof d.title === 'string' ? d.title : '(未命名)',
      content: parsed.content || undefined,
      createdAt: (d.createdAt as number) ?? 0,
      updatedAt: (d.updatedAt as number) ?? 0
    })
  }
  return docs.sort((a, b) => a.createdAt - b.createdAt)
}

export function writeDocuments(dir: string, docs: Document[]): void {
  const docsDir = path.join(dir, 'documents')
  const existing = new Set(listMdFiles(docsDir).map((fp) => path.basename(fp, EXT)))
  const ids = new Set(docs.map((d) => d.id))
  for (const doc of docs) {
    const fp = path.join(docsDir, `${safeId(doc.id)}${EXT}`)
    writeMd(
      fp,
      {
        id: doc.id,
        title: doc.title,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      },
      doc.content ?? ''
    )
  }
  for (const old of existing) {
    if (!ids.has(old)) {
      try {
        fs.unlinkSync(path.join(docsDir, `${old}${EXT}`))
      } catch {}
    }
  }
}

// ============ Agent Sessions ============
// 存储格式：一个 session 一个文件，messages 在 frontmatter 内部

function parseAgentMessage(raw: unknown): AgentMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  const role = (
    r.role === 'user' || r.role === 'assistant' || r.role === 'system' ? r.role : 'user'
  ) as AgentMessage['role']
  const content = typeof r.content === 'string' ? r.content : ''
  const createdAt = (r.createdAt as number) ?? 0
  if (!id) return null
  return {
    id,
    role,
    content,
    createdAt,
    ...(typeof r.model === 'string' && { model: r.model }),
    ...(Array.isArray(r.toolCalls) && { toolCalls: r.toolCalls }),
    ...(r.usage && typeof r.usage === 'object' && { usage: r.usage as AgentMessage['usage'] }),
    ...(typeof r.reasoning === 'string' && { reasoning: r.reasoning })
  }
}

/**
 * 迁移 Agent Sessions 从旧格式（子目录）到新格式（单文件）
 * 仅用于一次性迁移，迁移后删除旧目录
 */
export function migrateAgentSessionsToSingleFile(dir: string): void {
  const sessionsDir = path.join(dir, 'agent-sessions')
  if (!fs.existsSync(sessionsDir)) return

  const subdirs = listSubdirs(sessionsDir)
  if (subdirs.length === 0) return

  const sessions: AgentSession[] = []
  for (const name of subdirs) {
    const metaPath = path.join(sessionsDir, name, 'meta.md')
    const parsed = readMd(metaPath)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : name
    const messagesDir = path.join(sessionsDir, name, 'messages')
    const msgFiles = listMdFiles(messagesDir)
    const messages: AgentMessage[] = []
    for (const mfp of msgFiles) {
      const mp = readMd(mfp)
      if (!mp) continue
      const md = mp.data
      const msgId = typeof md.id === 'string' ? md.id : path.basename(mfp, EXT)
      const role = (
        md.role === 'user' || md.role === 'assistant' || md.role === 'system' ? md.role : 'user'
      ) as AgentMessage['role']
      messages.push({
        id: msgId,
        role,
        content: mp.content,
        createdAt: (md.createdAt as number) ?? 0,
        model: typeof md.model === 'string' ? md.model : undefined,
        toolCalls: Array.isArray(md.toolCalls) ? md.toolCalls : undefined,
        usage:
          md.usage && typeof md.usage === 'object'
            ? (md.usage as AgentMessage['usage'])
            : undefined,
        reasoning: typeof md.reasoning === 'string' ? md.reasoning : undefined
      })
    }
    messages.sort((a, b) => a.createdAt - b.createdAt)
    sessions.push({
      id,
      title: typeof d.title === 'string' ? d.title : '新会话',
      scope: typeof d.scope === 'string' ? d.scope : '',
      messages,
      createdAt: (d.createdAt as number) ?? 0,
      updatedAt: (d.updatedAt as number) ?? 0
    })
  }
  if (sessions.length === 0) return

  writeAgentSessions(dir, sessions)
  for (const name of subdirs) {
    try {
      fs.rmSync(path.join(sessionsDir, name), { recursive: true })
    } catch {}
  }
}

export function readAgentSessions(dir: string): AgentSession[] {
  const sessionsDir = path.join(dir, 'agent-sessions')
  if (!fs.existsSync(sessionsDir)) return []

  migrateAgentSessionsToSingleFile(dir)

  const sessions: AgentSession[] = []
  const sessionFiles = listMdFiles(sessionsDir)
  for (const fp of sessionFiles) {
    const parsed = readMd(fp)
    if (!parsed) continue
    const d = parsed.data
    const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
    const title = typeof d.title === 'string' ? d.title : '新会话'
    const scope = typeof d.scope === 'string' ? d.scope : ''
    const createdAt = (d.createdAt as number) ?? 0
    const updatedAt = (d.updatedAt as number) ?? 0

    let messages: AgentMessage[] = []
    if (Array.isArray(d.messages) && d.messages.length > 0) {
      messages = d.messages.map(parseAgentMessage).filter((m): m is AgentMessage => m !== null)
    }
    messages.sort((a, b) => a.createdAt - b.createdAt)
    sessions.push({ id, title, scope, messages, createdAt, updatedAt })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function writeAgentSessions(dir: string, sessions: AgentSession[]): void {
  const sessionsDir = path.join(dir, 'agent-sessions')
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true })

  const ids = new Set(sessions.map((s) => s.id))

  // 新格式：每个 session 一个 .md 文件
  for (const s of sessions) {
    const fp = path.join(sessionsDir, `${safeId(s.id)}${EXT}`)
    const frontmatter: Record<string, unknown> = {
      id: s.id,
      title: s.title ?? '新会话',
      scope: s.scope,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.model && { model: m.model }),
        ...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
        ...(m.usage && { usage: m.usage }),
        ...(m.reasoning && { reasoning: m.reasoning })
      }))
    }
    writeMd(fp, frontmatter, '')
  }

  // 删除旧格式子目录（迁移后全部移除）
  const subdirs = listSubdirs(sessionsDir)
  for (const old of subdirs) {
    try {
      fs.rmSync(path.join(sessionsDir, old), { recursive: true })
    } catch {}
  }

  // 删除已不存在的 session 文件
  const existingFiles = listMdFiles(sessionsDir)
  for (const fp of existingFiles) {
    const base = path.basename(fp, EXT)
    if (!ids.has(base)) {
      try {
        fs.unlinkSync(fp)
      } catch {}
    }
  }
}
