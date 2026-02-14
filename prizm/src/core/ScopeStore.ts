/**
 * Prizm ScopeStore - 按 scope 隔离存储数据，支持持久化
 * 存储结构：.prizm-data/scopes/{scope}/ 目录下按类型分 .md 文件存储
 * 每个实体一个 .md 文件，YAML frontmatter 存元数据，body 存正文
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { genUniqueId } from '../id'

const log = createLogger('ScopeStore')
import { getConfig } from '../config'
import * as mdStore from './mdStore'
import { DEFAULT_SCOPE, ONLINE_SCOPE, BUILTIN_SCOPES } from '@prizm/shared'
import type {
  StickyNote,
  StickyNoteGroup,
  TodoList,
  TodoItem,
  TodoItemStatus,
  PomodoroSession,
  ClipboardItem,
  Document,
  AgentSession
} from '../types'

export { DEFAULT_SCOPE, ONLINE_SCOPE }

export interface ScopeData {
  /** 便签数据（沿用现有 StickyNote 结构） */
  notes: StickyNote[]
  /** 便签分组 */
  groups: StickyNoteGroup[]
  /** TODO 列表（每个 scope 一个） */
  todoList: TodoList | null
  /** 番茄钟会话记录 */
  pomodoroSessions: PomodoroSession[]
  /** 剪贴板历史记录 */
  clipboard: ClipboardItem[]
  /** 文档（正式信息文档） */
  documents: Document[]
  /** Agent 会话列表 */
  agentSessions: AgentSession[]
}

const SCOPES_DIR = 'scopes'

function getDefaultDataDir(): string {
  return getConfig().dataDir
}

function safeScopeDirname(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
}

/** 将旧版 tasks 数组迁移为 TodoList */
function migrateTasksToTodoList(tasks: unknown[]): TodoList {
  const now = Date.now()
  const items: TodoItem[] = tasks
    .filter((t): t is { title?: string; description?: string } =>
      Boolean(t && typeof t === 'object')
    )
    .map((t) => ({
      id: genUniqueId(),
      title: typeof t.title === 'string' ? t.title : '(无标题)',
      ...(typeof t.description === 'string' && t.description && { description: t.description }),
      status: 'todo' as TodoItemStatus,
      createdAt: now,
      updatedAt: now
    }))
  return {
    id: genUniqueId(),
    title: '待办',
    items,
    createdAt: now,
    updatedAt: now
  }
}

/** 数据迁移：补全 item 缺的 id、status */
function migrateTodoListItems(list: TodoList): TodoList {
  const now = Date.now()
  const items = list.items.map((it) => {
    const raw = it as unknown as Record<string, unknown>
    const hasId = typeof raw.id === 'string' && raw.id.length > 0
    const hasStatus = raw.status === 'todo' || raw.status === 'doing' || raw.status === 'done'
    if (hasId && hasStatus) return it
    return {
      id: hasId ? (raw.id as string) : genUniqueId(),
      title: typeof raw.title === 'string' ? raw.title : '(无标题)',
      ...(typeof raw.description === 'string' &&
        raw.description && { description: raw.description }),
      status: (hasStatus ? raw.status : 'todo') as TodoItemStatus,
      createdAt: (raw.createdAt as number | undefined) ?? now,
      updatedAt: (raw.updatedAt as number | undefined) ?? now
    } as TodoItem
  })
  return { ...list, items }
}

function createEmptyScopeData(): ScopeData {
  return {
    notes: [],
    groups: [],
    todoList: null,
    pomodoroSessions: [],
    clipboard: [],
    documents: [],
    agentSessions: []
  }
}

export class ScopeStore {
  private store = new Map<string, ScopeData>()
  private dataDir: string

  constructor(dataDir?: string) {
    this.dataDir = path.join(dataDir ?? getDefaultDataDir(), SCOPES_DIR)
    this.ensureDataDir()
    this.loadAll()
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
  }

  /** scope 对应的目录路径 */
  private scopeDirPath(scope: string): string {
    return path.join(this.dataDir, safeScopeDirname(scope))
  }

  /** 旧版单文件 JSON 路径（用于迁移） */
  private legacyJsonPath(scope: string): string {
    return path.join(this.dataDir, `${safeScopeDirname(scope)}.json`)
  }

  /** 从 JSON 解析 ScopeData */
  private parseScopeData(raw: Partial<ScopeData>): ScopeData {
    return {
      notes: Array.isArray(raw.notes) ? raw.notes : [],
      groups: Array.isArray(raw.groups) ? raw.groups : [],
      todoList: (() => {
        let list: TodoList | null = null
        if (raw.todoList && typeof raw.todoList === 'object') {
          list = raw.todoList as TodoList
        } else if (
          Array.isArray((raw as { tasks?: unknown[] }).tasks) &&
          (raw as { tasks: unknown[] }).tasks.length > 0
        ) {
          list = migrateTasksToTodoList((raw as { tasks: unknown[] }).tasks)
        }
        return list ? migrateTodoListItems(list) : null
      })(),
      pomodoroSessions: Array.isArray(raw.pomodoroSessions) ? raw.pomodoroSessions : [],
      clipboard: Array.isArray(raw.clipboard) ? raw.clipboard : [],
      documents: Array.isArray(raw.documents) ? raw.documents : [],
      agentSessions: Array.isArray(raw.agentSessions) ? raw.agentSessions : []
    }
  }

  /** 从 JSON 迁移到 MD 并保存 */
  private migrateFromJson(scope: string, raw: Partial<ScopeData>): void {
    const data = this.parseScopeData(raw)
    this.store.set(scope, data)
    this.saveScope(scope)
    log.info('Migrated scope to MD storage:', scope)
  }

  /** 检测并执行从 JSON 的迁移（单文件或分文件目录） */
  private tryMigrateFromJson(scope: string): boolean {
    const legacySingle = this.legacyJsonPath(scope)
    if (fs.existsSync(legacySingle)) {
      try {
        const content = fs.readFileSync(legacySingle, 'utf-8')
        const raw = JSON.parse(content) as Partial<ScopeData>
        this.migrateFromJson(scope, raw)
        fs.unlinkSync(legacySingle)
        return true
      } catch (e) {
        log.error('Failed to migrate from legacy JSON', scope, e)
      }
    }
    const dirPath = this.scopeDirPath(scope)
    const notesJson = path.join(dirPath, 'notes.json')
    if (fs.existsSync(notesJson)) {
      try {
        const raw: Partial<ScopeData> = {}
        const keys = [
          'notes',
          'groups',
          'todoList',
          'pomodoroSessions',
          'clipboard',
          'documents',
          'agentSessions'
        ] as const
        for (const k of keys) {
          const fp = path.join(dirPath, `${k}.json`)
          if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, 'utf-8')
            ;(raw as Record<string, unknown>)[k] = JSON.parse(content)
          }
        }
        this.migrateFromJson(scope, raw)
        for (const k of keys) {
          const fp = path.join(dirPath, `${k}.json`)
          if (fs.existsSync(fp)) fs.unlinkSync(fp)
        }
        return true
      } catch (e) {
        log.error('Failed to migrate from JSON dir', scope, e)
      }
    }
    return false
  }

  private loadScope(scope: string): void {
    const dirPath = this.scopeDirPath(scope)

    if (this.tryMigrateFromJson(scope)) return

    if (!fs.existsSync(dirPath)) return

    try {
      const data: ScopeData = {
        notes: mdStore.readNotes(dirPath),
        groups: mdStore.readGroups(dirPath),
        todoList: mdStore.readTodoList(dirPath),
        pomodoroSessions: mdStore.readPomodoroSessions(dirPath),
        clipboard: mdStore.readClipboard(dirPath),
        documents: mdStore.readDocuments(dirPath),
        agentSessions: mdStore.readAgentSessions(dirPath)
      }
      this.store.set(scope, data)
    } catch (e) {
      log.error('Failed to load scope', scope, e)
    }
  }

  private loadAll(): void {
    if (!fs.existsSync(this.dataDir)) {
      for (const scope of BUILTIN_SCOPES) {
        this.store.set(scope, createEmptyScopeData())
      }
      return
    }
    const entries = fs.readdirSync(this.dataDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        const scope = e.name === '_' ? DEFAULT_SCOPE : e.name
        this.loadScope(scope)
      } else if (e.isFile() && e.name.endsWith('.json')) {
        const scope =
          path.basename(e.name, '.json') === '_' ? DEFAULT_SCOPE : path.basename(e.name, '.json')
        if (!this.store.has(scope)) this.loadScope(scope)
      }
    }
    for (const scope of BUILTIN_SCOPES) {
      if (!this.store.has(scope)) {
        this.store.set(scope, createEmptyScopeData())
        this.saveScope(scope)
      }
    }
  }

  /**
   * 持久化指定 scope 到磁盘（MD 单文件格式）
   */
  saveScope(scope: string): void {
    const data = this.store.get(scope)
    if (!data) return
    const dirPath = this.scopeDirPath(scope)
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      mdStore.writeNotes(dirPath, data.notes)
      mdStore.writeGroups(dirPath, data.groups)
      mdStore.writeTodoList(dirPath, data.todoList)
      mdStore.writePomodoroSessions(dirPath, data.pomodoroSessions)
      mdStore.writeClipboard(dirPath, data.clipboard)
      mdStore.writeDocuments(dirPath, data.documents)
      mdStore.writeAgentSessions(dirPath, data.agentSessions)
    } catch (e) {
      log.error('Failed to save scope', scope, e)
    }
  }

  /**
   * 获取 scope 数据，不存在则创建
   */
  getScopeData(scope: string): ScopeData {
    let data = this.store.get(scope)
    if (!data) {
      data = createEmptyScopeData()
      this.store.set(scope, data)
      this.saveScope(scope)
      return data
    }

    // 容错：老版本数据文件可能缺少新字段或字段被意外修改，这里补齐默认值
    if (!Array.isArray(data.notes)) data.notes = []
    if (!Array.isArray(data.groups)) data.groups = []
    if (data.todoList === undefined) data.todoList = null
    if (!Array.isArray(data.pomodoroSessions)) data.pomodoroSessions = []
    if (!Array.isArray(data.clipboard)) data.clipboard = []
    if (!Array.isArray(data.documents)) data.documents = []
    if (!Array.isArray(data.agentSessions)) data.agentSessions = []

    return data
  }

  /**
   * 确保 scope 存在
   */
  ensureScope(scope: string): ScopeData {
    return this.getScopeData(scope)
  }

  /**
   * 获取所有 scope 列表（含已持久化但未加载的）
   * 内置 scope（default、online）始终包含
   */
  getAllScopes(): string[] {
    const keys = new Set<string>(BUILTIN_SCOPES)
    for (const k of this.store.keys()) {
      keys.add(k)
    }
    if (fs.existsSync(this.dataDir)) {
      for (const e of fs.readdirSync(this.dataDir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          keys.add(e.name === '_' ? DEFAULT_SCOPE : e.name)
        } else if (e.isFile() && e.name.endsWith('.json')) {
          const base = path.basename(e.name, '.json')
          keys.add(base === '_' ? DEFAULT_SCOPE : base)
        }
      }
    }
    const list = Array.from(keys).filter(Boolean)
    return [...new Set(list)].sort()
  }
}

export const scopeStore = new ScopeStore()
