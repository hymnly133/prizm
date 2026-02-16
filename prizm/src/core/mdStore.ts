/**
 * Markdown 单文件存储 V3 - 双层架构
 * Layer 0: 通用文件读写（readFileByPath, writeFileByPath, listDirectory, moveFile）
 * Layer 1: Prizm 知识库（readDocuments, writeDocuments, readTodoLists, writeTodoLists）
 *   - 标题驱动文件名，frontmatter 存元数据
 *   - 用户内容：scope 根及任意子目录，按 prizm_type 过滤
 *   - 系统内容：.prizm/ 下固定子目录
 */

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import {
  getScopeJsonPath,
  getAgentSessionsDir,
  getClipboardDir,
  getTokenUsagePath,
  getSessionDir,
  getSessionFilePath,
  getSessionSummaryPath,
  getSessionTokenUsagePath,
  getSessionActivitiesPath,
  getSessionMemoriesPath,
  getSessionWorkspaceDir,
  getPrizmDir
} from './PathProviderCore'
import type {
  StickyNote,
  TodoList,
  TodoItem,
  TodoItemStatus,
  ClipboardItem,
  Document,
  AgentSession,
  AgentMessage,
  MessagePart,
  TokenUsageRecord,
  FileEntry,
  FileReadResult
} from '../types'
import { scanUserFiles } from './MetadataCache'

const EXT = '.md'

// ============ 工具函数 ============

function safeId(id: string): string {
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
function resolveConflict(dir: string, baseName: string, ext: string, excludePath?: string): string {
  let candidate = path.join(dir, baseName + ext)
  if (!fs.existsSync(candidate) || candidate === excludePath) return candidate
  let counter = 2
  while (true) {
    candidate = path.join(dir, `${baseName} (${counter})${ext}`)
    if (!fs.existsSync(candidate) || candidate === excludePath) return candidate
    counter++
  }
}

function writeMd(filePath: string, frontmatter: Record<string, unknown>, body = ''): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = matter.stringify(body, frontmatter, { lineWidth: -1 } as any)
  fs.writeFileSync(filePath, content, 'utf-8')
}

function readMd(filePath: string): { data: Record<string, unknown>; content: string } | null {
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

function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(EXT))
    .map((e) => path.join(dir, e.name))
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readPrizmType(data: Record<string, unknown>): string | null {
  const t = data.prizm_type
  return typeof t === 'string' && t ? t : null
}

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

/** 按 prizm_type 读取用户文件 */
function readUserFilesByType<T>(
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
function readSystemFiles<T>(
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

// ============ Layer 0: 通用文件操作 ============

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
export function readFileByPath(scopeRoot: string, relativePath: string): FileReadResult | null {
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
export function writeFileByPath(scopeRoot: string, relativePath: string, content: string): boolean {
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
export function moveFile(scopeRoot: string, fromRelPath: string, toRelPath: string): boolean {
  if (!validateRelativePath(fromRelPath) || !validateRelativePath(toRelPath)) return false
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

// ============ Layer 1: Documents (prizm_type: document) ============

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
      ...(d.llmSummary != null && { llmSummary: d.llmSummary }),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt
    }
    const existingPath = existing.get(d.id)
    let fp: string
    if (existingPath) {
      // Check if title changed -> rename
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
      // New file: place in specified directory or scopeRoot
      const dir = d.relativePath ? path.dirname(path.join(scopeRoot, d.relativePath)) : scopeRoot
      fp = resolveConflict(fs.existsSync(dir) ? dir : scopeRoot, sanitizeFileName(d.title), EXT)
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
    ...(doc.llmSummary != null && { llmSummary: doc.llmSummary }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }

  // Find existing file by ID
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
    fp = resolveConflict(fs.existsSync(dir) ? dir : scopeRoot, sanitizeFileName(doc.title), EXT)
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

// ============ Layer 1: TodoList (prizm_type: todo_list) ============

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
      fp = resolveConflict(fs.existsSync(dir) ? dir : scopeRoot, sanitizeFileName(list.title), EXT)
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

// ============ Clipboard (.prizm/clipboard/) ============

function parseClipboard(
  fp: string,
  d: Record<string, unknown>,
  content: string
): ClipboardItem | null {
  const id = typeof d.id === 'string' ? d.id : path.basename(fp, EXT)
  const type = (
    d.type === 'text' || d.type === 'image' || d.type === 'file' || d.type === 'other'
      ? d.type
      : 'text'
  ) as ClipboardItem['type']
  return {
    id,
    type,
    content,
    sourceApp: typeof d.sourceApp === 'string' ? d.sourceApp : undefined,
    createdAt: (d.createdAt as number) ?? 0
  }
}

export function readClipboard(scopeRoot: string): ClipboardItem[] {
  const items = readSystemFiles(scopeRoot, getClipboardDir, (fp, d, c) => parseClipboard(fp, d, c))
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export function writeClipboard(scopeRoot: string, items: ClipboardItem[]): void {
  const dir = getClipboardDir(scopeRoot)
  const existing = new Map<string, string>()
  if (fs.existsSync(dir)) {
    for (const fp of listMdFiles(dir)) {
      const p = readMd(fp)
      if (p) {
        const id = p.data.id as string
        if (id) existing.set(id, fp)
      }
    }
  }
  const ids = new Set(items.map((i) => i.id))
  for (const it of items) {
    const frontmatter: Record<string, unknown> = {
      prizm_type: 'clipboard_item',
      id: it.id,
      type: it.type,
      createdAt: it.createdAt,
      ...(it.sourceApp && { sourceApp: it.sourceApp })
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const fp = path.join(dir, `${safeId(it.id)}${EXT}`)
    writeMd(fp, frontmatter, it.content)
  }
  for (const [id, fp] of existing) {
    if (!ids.has(id)) {
      try {
        fs.unlinkSync(fp)
      } catch {}
    }
  }
}

// ============ Agent Sessions (.prizm/agent-sessions/) ============

function parseMessagePart(p: unknown): MessagePart | null {
  if (!p || typeof p !== 'object') return null
  const x = p as Record<string, unknown>
  if (x.type === 'text' && typeof x.content === 'string') {
    return { type: 'text', content: x.content }
  }
  if (
    x.type === 'tool' &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.arguments === 'string' &&
    typeof x.result === 'string'
  ) {
    return {
      type: 'tool',
      id: x.id,
      name: x.name,
      arguments: x.arguments,
      result: x.result,
      ...(x.isError === true && { isError: true })
    }
  }
  return null
}

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
  let parts: AgentMessage['parts']
  if (Array.isArray(r.parts) && r.parts.length > 0) {
    const parsed = r.parts
      .map(parseMessagePart)
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (parsed.length > 0) parts = parsed
  }
  const res: AgentMessage = {
    id,
    role,
    content,
    createdAt,
    ...(typeof r.model === 'string' ? { model: r.model } : {}),
    ...(Array.isArray(r.toolCalls) ? { toolCalls: r.toolCalls } : {}),
    ...(r.usage && typeof r.usage === 'object' ? { usage: r.usage as AgentMessage['usage'] } : {}),
    ...(typeof r.reasoning === 'string' ? { reasoning: r.reasoning } : {}),
    ...(r.memoryGrowth && typeof r.memoryGrowth === 'object'
      ? { memoryGrowth: r.memoryGrowth as AgentMessage['memoryGrowth'] }
      : {})
  }
  if (parts) {
    res.parts = parts
  }
  return res
}

function parseAgentSession(
  fp: string,
  d: Record<string, unknown>,
  _content: string,
  sessionIdHint?: string
): AgentSession | null {
  const id = typeof d.id === 'string' ? d.id : sessionIdHint ?? path.basename(fp, EXT)
  const scope = typeof d.scope === 'string' ? d.scope : ''
  const createdAt = (d.createdAt as number) ?? 0
  const updatedAt = (d.updatedAt as number) ?? 0
  let messages: AgentMessage[] = []
  if (Array.isArray(d.messages) && d.messages.length > 0) {
    messages = d.messages.map(parseAgentMessage).filter((m): m is AgentMessage => m !== null)
  }
  messages.sort((a, b) => a.createdAt - b.createdAt)
  const llmSummary = typeof d.llmSummary === 'string' ? d.llmSummary : undefined
  const compressedThroughRound =
    typeof d.compressedThroughRound === 'number' ? d.compressedThroughRound : undefined
  return {
    id,
    scope,
    messages,
    createdAt,
    updatedAt,
    ...(llmSummary != null && { llmSummary }),
    ...(compressedThroughRound != null && { compressedThroughRound })
  }
}

function readSingleSession(
  scopeRoot: string,
  sessionIdOrPath: string,
  isDir: boolean
): AgentSession | null {
  let fp: string
  let sessionIdHint: string | undefined
  if (isDir) {
    fp = path.join(sessionIdOrPath, 'session.md')
    sessionIdHint = path.basename(sessionIdOrPath)
  } else {
    fp = sessionIdOrPath
  }
  const parsed = readMd(fp)
  if (!parsed) return null
  const session = parseAgentSession(fp, parsed.data, parsed.content, sessionIdHint)
  if (!session) return null
  const summary = readSessionSummary(scopeRoot, session.id)
  if (summary != null) {
    session.llmSummary = summary
  } else if (typeof parsed.data.llmSummary === 'string') {
    session.llmSummary = parsed.data.llmSummary
  }
  return session
}

export function readAgentSessions(scopeRoot: string): AgentSession[] {
  const dir = getAgentSessionsDir(scopeRoot)
  if (!fs.existsSync(dir)) return []

  const byId = new Map<string, AgentSession>()
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const e of entries) {
    const fullPath = path.join(dir, e.name)
    const isDir = e.isDirectory()
    if (isDir || (e.isFile() && e.name.endsWith(EXT))) {
      const session = readSingleSession(scopeRoot, fullPath, isDir)
      if (session) {
        if (isDir) byId.set(session.id, session)
        else if (!byId.has(session.id)) byId.set(session.id, session)
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function writeAgentSessions(
  scopeRoot: string,
  sessions: AgentSession[],
  scopeId?: string
): void {
  const dir = getAgentSessionsDir(scopeRoot)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const existingDirs = new Set<string>()
  const existingFiles = new Set<string>()
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) existingDirs.add(full)
    else if (e.isFile() && e.name.endsWith(EXT)) existingFiles.add(full)
  }

  const ids = new Set(sessions.map((s) => s.id))
  const scope = scopeId ?? ''

  for (const s of sessions) {
    const sessionDir = getSessionDir(scopeRoot, s.id)
    const sessionFilePath = getSessionFilePath(scopeRoot, s.id)
    ensureDir(path.dirname(sessionFilePath))

    const frontmatter: Record<string, unknown> = {
      prizm_type: 'agent_session',
      id: s.id,
      scope: scope || s.scope,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...(s.compressedThroughRound != null && { compressedThroughRound: s.compressedThroughRound }),
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.model && { model: m.model }),
        ...(m.toolCalls?.length && { toolCalls: m.toolCalls }),
        ...(m.usage && { usage: m.usage }),
        ...(m.reasoning && { reasoning: m.reasoning }),
        ...(m.parts && m.parts.length > 0 && { parts: m.parts }),
        ...(m.memoryGrowth && { memoryGrowth: m.memoryGrowth })
      }))
    }
    writeMd(sessionFilePath, frontmatter, '')
    if (s.llmSummary != null) {
      writeSessionSummary(scopeRoot, s.id, s.llmSummary)
    }
    existingDirs.delete(sessionDir)
    existingFiles.delete(path.join(dir, `${safeId(s.id)}${EXT}`))
  }

  for (const d of existingDirs) {
    try {
      fs.rmSync(d, { recursive: true })
    } catch {}
  }
  for (const f of existingFiles) {
    try {
      fs.unlinkSync(f)
    } catch {}
  }
}

// ============ Session 级子文件 ============

export function readSessionSummary(scopeRoot: string, sessionId: string): string | null {
  const fp = getSessionSummaryPath(scopeRoot, sessionId)
  const parsed = readMd(fp)
  if (!parsed || !parsed.content.trim()) return null
  return parsed.content.trim()
}

export function writeSessionSummary(scopeRoot: string, sessionId: string, summary: string): void {
  const fp = getSessionSummaryPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  writeMd(fp, { prizm_type: 'agent_session_summary' }, summary)
}

export function readSessionTokenUsage(scopeRoot: string, sessionId: string): TokenUsageRecord[] {
  const fp = getSessionTokenUsagePath(scopeRoot, sessionId)
  const parsed = readMd(fp)
  if (!parsed || !Array.isArray(parsed.data.records)) return []
  return (parsed.data.records as unknown[]).filter(isTokenUsageRecord)
}

export function writeSessionTokenUsage(
  scopeRoot: string,
  sessionId: string,
  records: TokenUsageRecord[]
): void {
  const fp = getSessionTokenUsagePath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  writeMd(fp, { records }, '')
}

export function appendSessionTokenUsage(
  scopeRoot: string,
  sessionId: string,
  record: TokenUsageRecord
): void {
  const existing = readSessionTokenUsage(scopeRoot, sessionId)
  existing.push(record)
  writeSessionTokenUsage(scopeRoot, sessionId, existing)
}

export function readSessionActivities(
  scopeRoot: string,
  sessionId: string
): Array<Record<string, unknown>> {
  const fp = getSessionActivitiesPath(scopeRoot, sessionId)
  if (!fs.existsSync(fp)) return []
  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function appendSessionActivities(
  scopeRoot: string,
  sessionId: string,
  activities: unknown[]
): void {
  const existing = readSessionActivities(scopeRoot, sessionId)
  const merged = [...existing, ...activities]
  const fp = getSessionActivitiesPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  fs.writeFileSync(fp, JSON.stringify(merged, null, 2), 'utf-8')
}

export function readSessionMemories(scopeRoot: string, sessionId: string): string {
  const fp = getSessionMemoriesPath(scopeRoot, sessionId)
  if (!fs.existsSync(fp)) return ''
  try {
    return fs.readFileSync(fp, 'utf-8')
  } catch {
    return ''
  }
}

export function appendSessionMemories(scopeRoot: string, sessionId: string, content: string): void {
  const fp = getSessionMemoriesPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  const existing = readSessionMemories(scopeRoot, sessionId)
  const separator = existing ? '\n\n---\n\n' : ''
  fs.appendFileSync(fp, separator + content, 'utf-8')
}

export function deleteSessionDir(scopeRoot: string, sessionId: string): void {
  const dir = getSessionDir(scopeRoot, sessionId)
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true })
    } catch {}
  }
}

/** 确保会话临时工作区目录存在 */
export function ensureSessionWorkspace(scopeRoot: string, sessionId: string): string {
  const dir = getSessionWorkspaceDir(scopeRoot, sessionId)
  ensureDir(dir)
  return dir
}

// ============ Token Usage (.prizm/token_usage.md) ============

const VALID_USAGE_SCOPES = new Set(['chat', 'document_summary', 'conversation_summary', 'memory'])

function isTokenUsageRecord(r: unknown): r is TokenUsageRecord {
  if (typeof r !== 'object' || r === null) return false
  const o = r as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    VALID_USAGE_SCOPES.has(String(o.usageScope)) &&
    typeof o.timestamp === 'number' &&
    typeof o.model === 'string' &&
    typeof o.inputTokens === 'number' &&
    typeof o.outputTokens === 'number' &&
    typeof o.totalTokens === 'number'
  )
}

export function readTokenUsage(scopeRoot: string): TokenUsageRecord[] {
  const filePath = getTokenUsagePath(scopeRoot)
  const parsed = readMd(filePath)
  if (!parsed) return []
  const d = parsed.data
  if (!Array.isArray(d.records)) return []
  return (d.records as unknown[]).filter(isTokenUsageRecord)
}

export function writeTokenUsage(scopeRoot: string, records: TokenUsageRecord[]): void {
  const filePath = getTokenUsagePath(scopeRoot)
  const prizmDir = path.dirname(filePath)
  if (!fs.existsSync(prizmDir)) fs.mkdirSync(prizmDir, { recursive: true })
  writeMd(filePath, { records }, '')
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
