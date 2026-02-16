/**
 * @ 引用可扩展注册表
 * 开发时注册内置类型；生产时可从配置加载用户自定义引用类型
 */

import type { ScopeRefItem, ScopeRefItemDetail } from './scopeItemRegistry'
import { getScopeRefItem, listRefItems } from './scopeItemRegistry'
import type { ScopeRefKind } from './scopeItemRegistry'

export interface AtReferenceDef {
  key: string
  aliases?: string[]
  label: string
  resolveRef(scope: string, id: string): Promise<ScopeRefItemDetail | null>
  listCandidates?(scope: string, query?: string): Promise<ScopeRefItem[]>
  builtin: boolean
}

const registry = new Map<string, AtReferenceDef>()
const aliasToKey = new Map<string, string>()

function registerAliases(key: string, aliases: string[]): void {
  for (const a of aliases) {
    aliasToKey.set(a.toLowerCase(), key)
  }
}

function unregisterAliases(key: string, def: AtReferenceDef): void {
  if (def.aliases) {
    for (const a of def.aliases) {
      if (aliasToKey.get(a.toLowerCase()) === key) aliasToKey.delete(a.toLowerCase())
    }
  }
}

export function registerAtReference(def: AtReferenceDef): void {
  const k = def.key.toLowerCase()
  const existing = registry.get(k)
  if (existing) unregisterAliases(k, existing)
  registry.set(k, def)
  if (def.aliases?.length) registerAliases(k, def.aliases)
}

export function unregisterAtReference(key: string): void {
  const k = key.toLowerCase()
  const def = registry.get(k)
  if (def) {
    unregisterAliases(k, def)
    registry.delete(k)
  }
}

export function getAtReference(keyOrAlias: string): AtReferenceDef | null {
  const k = keyOrAlias.toLowerCase()
  const resolved = registry.get(k) ?? (aliasToKey.has(k) ? registry.get(aliasToKey.get(k)!) : null)
  return resolved ?? null
}

export function listAtReferences(): AtReferenceDef[] {
  return Array.from(registry.values())
}

/** 解析 @ 后面的 key（可能是 key 或 alias） */
export function resolveKey(keyOrAlias: string): string | null {
  const def = getAtReference(keyOrAlias)
  return def ? def.key : null
}

// ---------- 内置引用类型 ----------

function builtinNoteResolve(scope: string, id: string) {
  const detail = getScopeRefItem(scope, 'document', id)
  return Promise.resolve(detail)
}

function builtinNoteList(scope: string, query?: string) {
  let items = listRefItems(scope, 'document')
  if (query?.trim()) {
    const q = query.trim().toLowerCase()
    items = items.filter((r) => r.title.toLowerCase().includes(q) || r.id.includes(q))
  }
  return Promise.resolve(items)
}

function builtinTodoResolve(scope: string, id: string) {
  const detail = getScopeRefItem(scope, 'todo', id)
  return Promise.resolve(detail)
}

function builtinTodoList(scope: string, query?: string) {
  let items = listRefItems(scope, 'todo')
  if (query?.trim()) {
    const q = query.trim().toLowerCase()
    items = items.filter((r) => r.title.toLowerCase().includes(q) || r.id.includes(q))
  }
  return Promise.resolve(items)
}

function builtinDocResolve(scope: string, id: string) {
  const detail = getScopeRefItem(scope, 'document', id)
  return Promise.resolve(detail)
}

function builtinDocList(scope: string, query?: string) {
  let items = listRefItems(scope, 'document')
  if (query?.trim()) {
    const q = query.trim().toLowerCase()
    items = items.filter((r) => r.title.toLowerCase().includes(q) || r.id.includes(q))
  }
  return Promise.resolve(items)
}

/** 是否已注册内置引用 */
let builtinAtRefsRegistered = false

/** 注册内置 @ 引用类型（note、doc、todo）；首次调用时执行 */
export function registerBuiltinAtReferences(): void {
  if (builtinAtRefsRegistered) return
  builtinAtRefsRegistered = true
  registerAtReference({
    key: 'note',
    aliases: ['便签'],
    label: '便签',
    resolveRef: builtinNoteResolve,
    listCandidates: builtinNoteList,
    builtin: true
  })
  registerAtReference({
    key: 'doc',
    aliases: ['文档'],
    label: '文档',
    resolveRef: builtinDocResolve,
    listCandidates: builtinDocList,
    builtin: true
  })
  registerAtReference({
    key: 'todo',
    aliases: ['待办'],
    label: '待办',
    resolveRef: builtinTodoResolve,
    listCandidates: builtinTodoList,
    builtin: true
  })
}
