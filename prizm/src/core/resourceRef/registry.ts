/**
 * 全局资源引用注册表
 *
 * 所有资源类型在此注册，提供统一的 list / resolve / search 接口。
 * 由 builtinRefs.ts 在服务启动时注册内置资源类型。
 */

import type { ResourceType } from '@prizm/shared'
import { RESOURCE_TYPE_META, LISTABLE_RESOURCE_TYPES } from '@prizm/shared'
import type { ResourceRefDef, ResourceRefItem, ResourceRefDetail } from './types'
import { createLogger } from '../../logger'

const log = createLogger('ResourceRefRegistry')

const registry = new Map<ResourceType, ResourceRefDef>()

export function registerResourceRef(def: ResourceRefDef): void {
  registry.set(def.type, def)
}

export function unregisterResourceRef(type: ResourceType): void {
  registry.delete(type)
}

export function getResourceRefDef(type: ResourceType): ResourceRefDef | undefined {
  return registry.get(type)
}

export function listRegisteredTypes(): ResourceType[] {
  return Array.from(registry.keys())
}

/**
 * 列出指定 scope 内指定类型的资源
 */
export async function listResources(
  scope: string,
  type: ResourceType,
  limit?: number
): Promise<ResourceRefItem[]> {
  const def = registry.get(type)
  if (!def?.list) return []
  try {
    return await def.list(scope, limit)
  } catch (err) {
    log.error(`list ${type} in scope ${scope} failed:`, err)
    return []
  }
}

/**
 * 列出指定 scope 内所有可列出类型的资源
 */
export async function listAllResources(
  scope: string,
  options?: { types?: ResourceType[]; limit?: number }
): Promise<ResourceRefItem[]> {
  const types = options?.types?.length
    ? options.types.filter((t) => RESOURCE_TYPE_META[t]?.listable)
    : LISTABLE_RESOURCE_TYPES
  const limit = options?.limit ?? 50

  const results = await Promise.allSettled(
    types.map(async (type) => {
      const def = registry.get(type)
      if (!def?.list) return []
      return def.list(scope, limit)
    })
  )

  const items: ResourceRefItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value)
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 在指定 scope 内按 ID 解析单个资源
 */
export async function resolveResource(
  scope: string,
  type: ResourceType,
  id: string
): Promise<ResourceRefDetail | null> {
  const def = registry.get(type)
  if (!def) return null
  try {
    return await def.resolve(scope, id)
  } catch (err) {
    log.error(`resolve ${type}:${id} in scope ${scope} failed:`, err)
    return null
  }
}

/**
 * 跨 scope 按 ID 解析资源（遍历所有 scope 查找）
 */
export async function resolveResourceAcrossScopes(
  type: ResourceType,
  id: string
): Promise<{ scope: string; detail: ResourceRefDetail } | null> {
  const def = registry.get(type)
  if (!def) return null
  if (def.crossScopeResolve) {
    try {
      return await def.crossScopeResolve(id)
    } catch (err) {
      log.error(`crossScopeResolve ${type}:${id} failed:`, err)
      return null
    }
  }
  return null
}

/**
 * 在指定 scope 内搜索所有可列出资源（简单文本匹配）
 */
export async function searchResources(
  scope: string,
  query: string,
  options?: { types?: ResourceType[]; limit?: number }
): Promise<ResourceRefItem[]> {
  const all = await listAllResources(scope, options)
  if (!query?.trim()) return all
  const q = query.trim().toLowerCase()
  return all.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      (item.groupOrStatus && item.groupOrStatus.toLowerCase().includes(q))
  )
}
