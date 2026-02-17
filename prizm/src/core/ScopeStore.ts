/**
 * Prizm ScopeStore V3 - 双层架构
 * scope 根目录可为任意路径，.prizm/ 存放配置与系统数据
 * 移除 notes/pomodoroSessions，保留 documents/todoLists/clipboard/agentSessions
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { genUniqueId } from '../id'
import { ScopeRegistry, scopeRegistry } from './ScopeRegistry'
import { getPrizmDir } from './PathProviderCore'
import { migrateToV3 } from './migrate-v3'
import * as mdStore from './mdStore'
import { DEFAULT_SCOPE, ONLINE_SCOPE, BUILTIN_SCOPES } from '@prizm/shared'
import type {
  TodoList,
  TodoItem,
  TodoItemStatus,
  ClipboardItem,
  Document,
  AgentSession
} from '../types'

const log = createLogger('ScopeStore')

export { DEFAULT_SCOPE, ONLINE_SCOPE }

export interface ScopeData {
  todoLists: TodoList[]
  clipboard: ClipboardItem[]
  documents: Document[]
  agentSessions: AgentSession[]
}

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
    todoLists: [],
    clipboard: [],
    documents: [],
    agentSessions: []
  }
}

export class ScopeStore {
  private store = new Map<string, ScopeData>()
  private registry: ScopeRegistry

  constructor(dataDir?: string) {
    this.registry = dataDir ? new ScopeRegistry(dataDir) : scopeRegistry
    this.ensureBuiltinScopes()
    this.loadAll()
  }

  private ensureBuiltinScopes(): void {
    const dataDir = this.registry.getDataDir()
    const scopesDir = path.join(dataDir, 'scopes')
    if (!fs.existsSync(scopesDir)) {
      fs.mkdirSync(scopesDir, { recursive: true })
    }
    for (const id of BUILTIN_SCOPES) {
      const rootPath = path.join(scopesDir, id)
      if (!fs.existsSync(rootPath)) {
        fs.mkdirSync(rootPath, { recursive: true })
      }
      const prizmDir = getPrizmDir(rootPath)
      if (!fs.existsSync(prizmDir)) {
        this.registry.initScopeDir(id, rootPath, id === DEFAULT_SCOPE ? '默认工作区' : '实时上下文')
      }
    }
  }

  getScopeRootPath(scopeId: string): string {
    const root = this.registry.getScopeRootPath(scopeId)
    if (root) return root
    const dataDir = this.registry.getDataDir()
    return path.join(dataDir, 'scopes', scopeId)
  }

  private loadScope(scopeId: string): void {
    const rootPath = this.getScopeRootPath(scopeId)
    const prizmDir = getPrizmDir(rootPath)
    if (!fs.existsSync(rootPath)) return
    if (!fs.existsSync(prizmDir)) {
      this.registry.initScopeDir(scopeId, rootPath)
    }
    migrateToV3(rootPath)
    try {
      const data: ScopeData = {
        todoLists: (mdStore.readTodoLists(rootPath) ?? []).map(migrateTodoListItems),
        clipboard: mdStore.readClipboard(rootPath),
        documents: mdStore.readDocuments(rootPath),
        agentSessions: mdStore.readAgentSessions(rootPath)
      }
      this.store.set(scopeId, data)
    } catch (e) {
      log.error('Failed to load scope', scopeId, e)
    }
  }

  private loadAll(): void {
    const list = this.registry.list()
    for (const e of list) {
      this.loadScope(e.id)
    }
    for (const scope of BUILTIN_SCOPES) {
      if (!this.store.has(scope)) {
        this.store.set(scope, createEmptyScopeData())
        this.saveScope(scope)
      }
    }
  }

  saveScope(scope: string): void {
    const data = this.store.get(scope)
    if (!data) return
    const rootPath = this.getScopeRootPath(scope)
    const prizmDir = getPrizmDir(rootPath)
    try {
      if (!fs.existsSync(rootPath)) {
        fs.mkdirSync(rootPath, { recursive: true })
      }
      if (!fs.existsSync(prizmDir)) {
        this.registry.initScopeDir(scope, rootPath)
      }
      mdStore.writeTodoLists(rootPath, data.todoLists)
      mdStore.writeClipboard(rootPath, data.clipboard)
      mdStore.writeDocuments(rootPath, data.documents)
      mdStore.writeAgentSessions(rootPath, data.agentSessions, scope)
    } catch (e) {
      log.error('Failed to save scope', scope, e)
    }
  }

  getScopeData(scope: string): ScopeData {
    let data = this.store.get(scope)
    if (!data) {
      const rootPath = this.getScopeRootPath(scope)
      if (!fs.existsSync(rootPath)) {
        fs.mkdirSync(rootPath, { recursive: true })
        this.registry.initScopeDir(scope, rootPath)
      }
      this.loadScope(scope)
      data = this.store.get(scope)
    }
    if (!data) {
      data = createEmptyScopeData()
      this.store.set(scope, data)
      this.saveScope(scope)
      return data
    }
    if (!Array.isArray(data.todoLists)) data.todoLists = []
    if (!Array.isArray(data.clipboard)) data.clipboard = []
    if (!Array.isArray(data.documents)) data.documents = []
    if (!Array.isArray(data.agentSessions)) data.agentSessions = []
    return data
  }

  ensureScope(scope: string): ScopeData {
    return this.getScopeData(scope)
  }

  getAllScopes(): string[] {
    const keys = new Set<string>(BUILTIN_SCOPES)
    for (const e of this.registry.list()) {
      keys.add(e.id)
    }
    return [...keys].filter(Boolean).sort()
  }

  registerScope(id: string, absPath: string, label?: string): void {
    const resolved = path.resolve(absPath)
    this.registry.register(id, resolved, label)
    this.registry.initScopeDir(id, resolved, label)
    this.loadScope(id)
  }

  unregisterScope(id: string): boolean {
    const ok = this.registry.unregister(id)
    if (ok) this.store.delete(id)
    return ok
  }

  deleteSessionDir(scope: string, sessionId: string): void {
    const rootPath = this.getScopeRootPath(scope)
    mdStore.deleteSessionDir(rootPath, sessionId)
  }

  /** Reload scope data from disk */
  reloadScope(scope: string): void {
    this.loadScope(scope)
  }
}

export const scopeStore = new ScopeStore()
