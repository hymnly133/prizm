/**
 * Scope 从请求参数提取，不依赖全局 header
 * 规则：创建默认 default；List 必须指明；读取 by id 可不提供（跨 scope 查找）
 */

import type { Request, Response } from 'express'
import { DEFAULT_SCOPE, scopeStore } from './core/ScopeStore'

function toStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 ? s : null
}

/** Express 5: params/query 可能为 string | string[]，统一转为 string */
export function ensureStringParam(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length > 0) return String(v[0])
  return ''
}

/** 从 query 提取 scope */
export function getScopeFromQuery(req: Request): string | null {
  return toStr(req.query.scope)
}

/** 从 body 提取 scope */
export function getScopeFromBody(req: Request): string | null {
  return toStr(req.body?.scope)
}

/** 检查客户端是否有权访问该 scope */
export function hasScopeAccess(req: Request, scope: string): boolean {
  const client = req.prizmClient
  if (!client) return true // 无鉴权或豁免路径
  const { allowedScopes } = client
  return allowedScopes.includes('*') || allowedScopes.includes(scope)
}

/** 解析 scope 并校验权限，无权限时回退 default */
function resolveScope(req: Request, scope: string | null): string {
  const resolved = scope ?? DEFAULT_SCOPE
  return hasScopeAccess(req, resolved) ? resolved : DEFAULT_SCOPE
}

/** 创建操作：scope 从 body，未指明则 default */
export function getScopeForCreate(req: Request): string {
  return resolveScope(req, getScopeFromBody(req))
}

/** List 操作：scope 必须从 query 提供，缺失返回 400 */
export function requireScopeForList(req: Request, res: Response): string | null {
  const scope = getScopeFromQuery(req)
  if (!scope) {
    res.status(400).json({ error: 'scope is required for list' })
    return null
  }
  if (!hasScopeAccess(req, scope)) {
    res.status(403).json({ error: 'scope access denied' })
    return null
  }
  return scope
}

/** 读取 by id：scope 可选，用于精确查找；未提供时将跨 scope 查找 */
export function getScopeForReadById(req: Request): string | null {
  const scope = getScopeFromQuery(req)
  if (!scope) return null
  return hasScopeAccess(req, scope) ? scope : null
}

/** 获取客户端可访问的 scope 列表（用于跨 scope 查找） */
export function getAllowedScopes(req: Request): string[] {
  const client = req.prizmClient
  if (!client) return [DEFAULT_SCOPE]
  const { allowedScopes } = client
  if (allowedScopes.includes('*')) {
    return scopeStore.getAllScopes()
  }
  return allowedScopes
}

/** 按 id 跨 scope 查找（scope 未提供时用） */
export async function findAcrossScopes<T>(
  req: Request,
  lookup: (scope: string) => Promise<T | null>
): Promise<{ item: T; scope: string } | null> {
  const scopes = getAllowedScopes(req)
  for (const scope of scopes) {
    const item = await lookup(scope)
    if (item) return { item, scope }
  }
  return null
}
