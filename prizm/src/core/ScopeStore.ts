/**
 * Prizm ScopeStore - 按 scope 隔离存储数据，支持持久化
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'

const log = createLogger('ScopeStore')
import { getConfig } from '../config'
import type {
  StickyNote,
  StickyNoteGroup,
  Task,
  PomodoroSession,
  ClipboardItem,
  Document,
  AgentSession
} from '../types'

export const DEFAULT_SCOPE = 'default'
/** 语义 scope：用户实时上下文，Electron 客户端常驻显示其 TODO 和便签 */
export const ONLINE_SCOPE = 'online'

/** 内置 scope，始终在列表中可用 */
const BUILTIN_SCOPES = [DEFAULT_SCOPE, ONLINE_SCOPE] as const

export interface ScopeData {
  /** 便签数据（沿用现有 StickyNote 结构） */
  notes: StickyNote[]
  /** 便签分组 */
  groups: StickyNoteGroup[]
  /** 任务 / TODO 列表 */
  tasks: Task[]
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

function safeScopeFilename(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
}

function createEmptyScopeData(): ScopeData {
  return {
    notes: [],
    groups: [],
    tasks: [],
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

  private scopeFilePath(scope: string): string {
    return path.join(this.dataDir, `${safeScopeFilename(scope)}.json`)
  }

  private loadScope(scope: string): void {
    const filePath = this.scopeFilePath(scope)
    if (!fs.existsSync(filePath)) return
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const raw = JSON.parse(content) as Partial<ScopeData>

      const data: ScopeData = {
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        groups: Array.isArray(raw.groups) ? raw.groups : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        pomodoroSessions: Array.isArray(raw.pomodoroSessions) ? raw.pomodoroSessions : [],
        clipboard: Array.isArray(raw.clipboard) ? raw.clipboard : [],
        documents: Array.isArray(raw.documents) ? raw.documents : [],
        agentSessions: Array.isArray(raw.agentSessions) ? raw.agentSessions : []
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
    const files = fs.readdirSync(this.dataDir)
    for (const f of files) {
      if (f.endsWith('.json')) {
        const scope = path.basename(f, '.json') === '_' ? DEFAULT_SCOPE : path.basename(f, '.json')
        this.loadScope(scope)
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
   * 持久化指定 scope 到磁盘
   */
  saveScope(scope: string): void {
    const data = this.store.get(scope)
    if (!data) return
    const filePath = this.scopeFilePath(scope)
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            notes: data.notes,
            groups: data.groups,
            tasks: data.tasks,
            pomodoroSessions: data.pomodoroSessions,
            clipboard: data.clipboard,
            documents: data.documents,
            agentSessions: data.agentSessions
          },
          null,
          2
        ),
        'utf-8'
      )
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
    if (!Array.isArray(data.tasks)) data.tasks = []
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
      for (const f of fs.readdirSync(this.dataDir)) {
        if (f.endsWith('.json')) {
          const base = path.basename(f, '.json')
          keys.add(base === '_' ? DEFAULT_SCOPE : base)
        }
      }
    }
    const list = Array.from(keys).filter(Boolean)
    return [...new Set(list)].sort()
  }
}

export const scopeStore = new ScopeStore()
