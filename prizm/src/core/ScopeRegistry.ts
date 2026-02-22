/**
 * Scope 注册表 - 管理 scopeId 与文件夹路径的映射
 * 支持任意文件夹作为 scope，内置 scope 存放在 .prizm-data/scopes/
 */

import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'
import { BUILTIN_SCOPES } from '@prizm/shared'
import { SCOPE_INFOS } from '@prizm/shared'
import {
  getDataDir,
  getScopeRegistryPath,
  getPrizmDir,
  getScopeJsonPath,
  getTypesJsonPath
} from './PathProviderCore'

const log = createLogger('ScopeRegistry')
const SCOPE_JSON = 'scope.json'
const TYPES_JSON = 'types.json'

export interface ScopeEntry {
  path: string
  label: string
  builtin: boolean
  createdAt: number
}

export interface RegistryData {
  version: number
  scopes: Record<string, ScopeEntry>
}

const DEFAULT_TYPES_JSON = {
  types: {
    prizm_type: 'select',
    tags: 'tags',
    status: 'select',
    taskId: 'text',
    sourceApp: 'text',
    title: 'text',
    llmSummary: 'text', // @deprecated 兼容存量数据索引
    createdAt: 'number',
    updatedAt: 'number'
  },
  selectOptions: {
    prizm_type: ['note', 'document', 'todo_list', 'clipboard_item', 'agent_session'],
    status: ['todo', 'doing', 'done']
  }
}

export class ScopeRegistry {
  private dataDir: string
  private registryPath: string
  private data: RegistryData | null = null

  constructor(dataDir?: string) {
    this.dataDir = dataDir ? path.resolve(dataDir) : getDataDir()
    this.registryPath = dataDir
      ? path.join(this.dataDir, 'scope-registry.json')
      : getScopeRegistryPath()
    this.load()
  }

  private load(): void {
    if (fs.existsSync(this.registryPath)) {
      try {
        const raw = fs.readFileSync(this.registryPath, 'utf-8')
        this.data = JSON.parse(raw) as RegistryData
        if (!this.data.scopes) this.data.scopes = {}
        return
      } catch (e) {
        log.error('Failed to load scope registry', e)
      }
    }
    this.data = { version: 1, scopes: {} }
    this.ensureBuiltinScopes()
    this.save()
  }

  private save(): void {
    if (!this.data) return
    const dir = path.dirname(this.registryPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  private ensureBuiltinScopes(): void {
    const scopesDir = path.join(this.dataDir, 'scopes')
    const now = Date.now()
    for (const id of BUILTIN_SCOPES) {
      if (this.data!.scopes[id]) continue
      const relPath = path.join('scopes', id)
      const info = SCOPE_INFOS[id]
      this.data!.scopes[id] = {
        path: relPath,
        label: info?.label ?? id,
        builtin: true,
        createdAt: now
      }
    }
  }

  /**
   * 获取 scope 根目录的绝对路径
   */
  getScopeRootPath(id: string): string | null {
    const entry = this.data?.scopes[id]
    if (!entry) return null
    const p = entry.path
    if (path.isAbsolute(p)) return p
    return path.join(this.dataDir, p)
  }

  /**
   * 注册新 scope（绑定到文件夹）
   */
  register(id: string, absPath: string, label?: string): void {
    const resolved = path.resolve(absPath)
    if (!this.data) this.data = { version: 1, scopes: {} }
    const info = SCOPE_INFOS[id]
    this.data.scopes[id] = {
      path: resolved,
      label: label ?? info?.label ?? id,
      builtin: BUILTIN_SCOPES.includes(id as (typeof BUILTIN_SCOPES)[number]),
      createdAt: this.data.scopes[id]?.createdAt ?? Date.now()
    }
    this.save()
    log.info('Scope registered:', id, resolved)
  }

  /**
   * 列出所有已注册 scope
   */
  list(): Array<{ id: string; path: string; label: string; builtin: boolean }> {
    const scopes = this.data?.scopes ?? {}
    return Object.entries(scopes).map(([id, e]) => ({
      id,
      path: path.isAbsolute(e.path) ? e.path : path.join(this.dataDir, e.path),
      label: e.label,
      builtin: e.builtin
    }))
  }

  /**
   * 注销自定义 scope（不删除文件夹）
   */
  unregister(id: string): boolean {
    const entry = this.data?.scopes[id]
    if (!entry || entry.builtin) return false
    delete this.data!.scopes[id]
    this.save()
    log.info('Scope unregistered:', id)
    return true
  }

  /**
   * 初始化 scope 目录（创建 .prizm/ + scope.json + types.json）
   */
  initScopeDir(id: string, rootPath: string, label?: string): void {
    const resolved = path.resolve(rootPath)
    const prizmDir = getPrizmDir(resolved)
    if (!fs.existsSync(prizmDir)) {
      fs.mkdirSync(prizmDir, { recursive: true })
    }
    const info = SCOPE_INFOS[id]
    const scopeJson = {
      id,
      label: label ?? info?.label ?? id,
      createdAt: Date.now(),
      settings: {
        defaultPrizmType: null as string | null,
        excludePatterns: ['node_modules', 'dist', '.git'],
        newItemLocation: 'root'
      }
    }
    fs.writeFileSync(getScopeJsonPath(resolved), JSON.stringify(scopeJson, null, 2), 'utf-8')
    const typesPath = getTypesJsonPath(resolved)
    if (!fs.existsSync(typesPath)) {
      fs.writeFileSync(typesPath, JSON.stringify(DEFAULT_TYPES_JSON, null, 2), 'utf-8')
    }
    log.info('Scope dir initialized:', id, resolved)
  }

  /**
   * 获取 dataDir
   */
  getDataDir(): string {
    return this.dataDir
  }
}

export const scopeRegistry = new ScopeRegistry()
