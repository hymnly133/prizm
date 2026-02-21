/**
 * @ 引用可扩展注册表
 * 自动从 resourceRefRegistry 同步所有已注册资源类型
 * 保留 note/doc/todo/file 的向后兼容别名
 */

import type { ScopeRefItem, ScopeRefItemDetail } from './scopeItemRegistry'
import type { ScopeRefKind } from './scopeItemRegistry'
import { RESOURCE_TYPE_META } from '@prizm/shared'
import type { ResourceType } from '@prizm/shared'
import {
  registerBuiltinResourceRefs,
  listRegisteredTypes,
  getResourceRefDef,
  listResources,
  resolveResource
} from '../core/resourceRef'

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

// ---------- 从 resourceRefRegistry 自动同步 ----------

/** ResourceRefDetail → 旧版 ScopeRefItemDetail 适配 */
const TYPE_TO_KIND: Record<string, ScopeRefKind> = {
  doc: 'document',
  todo: 'todo',
  file: 'document'
}

function refDetailToScopeDetail(
  type: ResourceType,
  detail: { id: string; title: string; charCount: number; updatedAt: number; content: string; groupOrStatus?: string }
): ScopeRefItemDetail {
  const kind = TYPE_TO_KIND[type] ?? (type as ScopeRefKind)
  return {
    id: detail.id,
    kind,
    title: detail.title,
    charCount: detail.charCount,
    isShort: detail.charCount < 500,
    updatedAt: detail.updatedAt,
    groupOrStatus: detail.groupOrStatus,
    content: detail.content
  }
}

function refItemToScopeItem(
  type: ResourceType,
  item: { id: string; title: string; charCount: number; updatedAt: number; groupOrStatus?: string }
): ScopeRefItem {
  const kind = TYPE_TO_KIND[type] ?? (type as ScopeRefKind)
  return {
    id: item.id,
    kind,
    title: item.title,
    charCount: item.charCount,
    isShort: item.charCount < 500,
    updatedAt: item.updatedAt,
    groupOrStatus: item.groupOrStatus
  }
}

function makeAtRefFromResourceType(type: ResourceType): AtReferenceDef {
  const meta = RESOURCE_TYPE_META[type]
  const def = getResourceRefDef(type)

  const resolveRef = async (scope: string, id: string): Promise<ScopeRefItemDetail | null> => {
    const detail = await resolveResource(scope, type, id)
    return detail ? refDetailToScopeDetail(type, detail) : null
  }

  const listCandidates = def?.list
    ? async (scope: string, query?: string): Promise<ScopeRefItem[]> => {
        const items = await listResources(scope, type, 100)
        const mapped = items.map((it) => refItemToScopeItem(type, it))
        if (!query?.trim()) return mapped
        const q = query.trim().toLowerCase()
        return mapped.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q)
        )
      }
    : undefined

  return {
    key: type,
    aliases: meta.aliases,
    label: meta.label,
    resolveRef,
    listCandidates,
    builtin: true
  }
}

let builtinAtRefsRegistered = false

/**
 * 注册内置 @ 引用类型 — 从 resourceRefRegistry 自动同步所有已注册类型
 * 同时保留 note alias → doc 的兼容映射
 */
export function registerBuiltinAtReferences(): void {
  if (builtinAtRefsRegistered) return
  builtinAtRefsRegistered = true

  registerBuiltinResourceRefs()

  for (const type of listRegisteredTypes()) {
    registerAtReference(makeAtRefFromResourceType(type))
  }

  // note → doc 兼容别名（note 不是独立类型，只是 doc 的别名）
  const docDef = getAtReference('doc')
  if (docDef) {
    registerAtReference({
      ...docDef,
      key: 'note',
      aliases: ['便签'],
      label: '便签'
    })
  }
}
