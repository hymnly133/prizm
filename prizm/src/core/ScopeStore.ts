/**
 * Prizm ScopeStore - 按 scope 隔离存储数据，支持持久化
 */

import fs from 'fs'
import path from 'path'
import type { StickyNote, StickyNoteGroup } from '../types'

export const DEFAULT_SCOPE = 'default'

export interface ScopeData {
  notes: StickyNote[]
  groups: StickyNoteGroup[]
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), '.prizm-data')
const SCOPES_DIR = 'scopes'

function safeScopeFilename(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
}

export class ScopeStore {
  private store = new Map<string, ScopeData>()
  private dataDir: string

  constructor(dataDir?: string) {
    this.dataDir = path.join(dataDir ?? DEFAULT_DATA_DIR, SCOPES_DIR)
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
    const filePath = path.join(this.dataDir, `${safeScopeFilename(scope)}.json`)
    if (!fs.existsSync(filePath)) return
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content) as ScopeData
      if (Array.isArray(data.notes) && Array.isArray(data.groups)) {
        this.store.set(scope, data)
      }
    } catch (e) {
      console.error(`[Prizm ScopeStore] Failed to load scope ${scope}:`, e)
    }
  }

  private loadAll(): void {
    if (!fs.existsSync(this.dataDir)) {
      this.store.set(DEFAULT_SCOPE, { notes: [], groups: [] })
      return
    }
    const files = fs.readdirSync(this.dataDir)
    for (const f of files) {
      if (f.endsWith('.json')) {
        const scope = path.basename(f, '.json') === '_' ? DEFAULT_SCOPE : path.basename(f, '.json')
        this.loadScope(scope)
      }
    }
    if (!this.store.has(DEFAULT_SCOPE)) {
      this.store.set(DEFAULT_SCOPE, { notes: [], groups: [] })
      this.saveScope(DEFAULT_SCOPE)
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
        JSON.stringify({ notes: data.notes, groups: data.groups }, null, 2),
        'utf-8'
      )
    } catch (e) {
      console.error(`[Prizm ScopeStore] Failed to save scope ${scope}:`, e)
    }
  }

  /**
   * 获取 scope 数据，不存在则创建
   */
  getScopeData(scope: string): ScopeData {
    let data = this.store.get(scope)
    if (!data) {
      data = { notes: [], groups: [] }
      this.store.set(scope, data)
      this.saveScope(scope)
    }
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
   */
  getAllScopes(): string[] {
    const keys = new Set(this.store.keys())
    if (fs.existsSync(this.dataDir)) {
      for (const f of fs.readdirSync(this.dataDir)) {
        if (f.endsWith('.json')) {
          const base = path.basename(f, '.json')
          keys.add(base === '_' ? DEFAULT_SCOPE : base)
        }
      }
    }
    const list = Array.from(keys).filter(Boolean)
    if (!list.includes(DEFAULT_SCOPE)) list.unshift(DEFAULT_SCOPE)
    return [...new Set(list)].sort()
  }
}

export const scopeStore = new ScopeStore()
