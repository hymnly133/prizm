/**
 * 会话级上下文追踪
 * 记录各 scope 数据项在会话中的提供状态（摘要/全量）、stale 检测、Agent 修改记录
 */

import type { ScopeRefKind } from './scopeItemRegistry'
import { getScopeRefItem } from './scopeItemRegistry'

export interface ItemProvision {
  itemId: string
  kind: ScopeRefKind
  mode: 'summary' | 'full'
  providedAt: number
  charCount: number
  version: number
  stale: boolean
}

export interface ModificationRecord {
  itemId: string
  type: ScopeRefKind
  action: 'create' | 'update' | 'delete'
  timestamp: number
}

export interface SessionContextState {
  sessionId: string
  scope: string
  provisions: ItemProvision[]
  totalProvidedChars: number
  modifications: ModificationRecord[]
}

const sessionMap = new Map<string, SessionContextState>()

function key(scope: string, sessionId: string): string {
  return `${scope}:${sessionId}`
}

function getOrCreate(scope: string, sessionId: string): SessionContextState {
  const k = key(scope, sessionId)
  let state = sessionMap.get(k)
  if (!state) {
    state = {
      sessionId,
      scope,
      provisions: [],
      totalProvidedChars: 0,
      modifications: []
    }
    sessionMap.set(k, state)
  }
  return state
}

/**
 * 记录某条可引用项已在本会话中提供（摘要或全量）
 */
export function recordProvision(
  scope: string,
  sessionId: string,
  opts: {
    itemId: string
    kind: ScopeRefKind
    mode: 'summary' | 'full'
    charCount: number
    version: number
  }
): void {
  const state = getOrCreate(scope, sessionId)
  const existing = state.provisions.find((p) => p.kind === opts.kind && p.itemId === opts.itemId)
  if (existing) {
    existing.mode = opts.mode
    existing.providedAt = Date.now()
    existing.charCount = opts.charCount
    existing.version = opts.version
    existing.stale = false
  } else {
    state.provisions.push({
      itemId: opts.itemId,
      kind: opts.kind,
      mode: opts.mode,
      providedAt: Date.now(),
      charCount: opts.charCount,
      version: opts.version,
      stale: false
    })
  }
  state.totalProvidedChars = state.provisions.reduce((s, p) => s + p.charCount, 0)
}

/**
 * 记录 Agent 通过工具对 scope 数据的修改
 */
export function recordModification(
  scope: string,
  sessionId: string,
  opts: { itemId: string; type: ScopeRefKind; action: 'create' | 'update' | 'delete' }
): void {
  const state = getOrCreate(scope, sessionId)
  state.modifications.push({
    itemId: opts.itemId,
    type: opts.type,
    action: opts.action,
    timestamp: Date.now()
  })
}

/**
 * 更新 stale 状态：对比当前 scope 中项的 updatedAt 与 provision 的 version
 */
export function refreshStale(scope: string, sessionId: string): void {
  const state = sessionMap.get(key(scope, sessionId))
  if (!state) return

  for (const p of state.provisions) {
    const current = getScopeRefItem(scope, p.kind, p.itemId)
    if (!current) {
      p.stale = true
      continue
    }
    p.stale = (current.updatedAt ?? 0) > p.version
  }
}

/**
 * 获取会话上下文状态（含最新 stale）
 */
export function getSessionContext(scope: string, sessionId: string): SessionContextState | null {
  refreshStale(scope, sessionId)
  return sessionMap.get(key(scope, sessionId)) ?? null
}

/**
 * 生成供 system prompt 使用的提供状态摘要文本
 */
export function buildProvisionSummary(scope: string, sessionId: string): string {
  const state = getSessionContext(scope, sessionId)
  if (!state || !state.provisions.length) return ''

  const lines: string[] = []
  for (const p of state.provisions) {
    const tag = p.mode === 'full' ? '全量' : '摘要'
    const staleTag = p.stale ? ' [已过期]' : ''
    lines.push(`- ${p.kind}:${p.itemId} (${tag}, ${p.charCount} 字)${staleTag}`)
  }
  if (state.modifications.length) {
    lines.push('')
    lines.push(
      '本会话内修改: ' +
        state.modifications.map((m) => `${m.action} ${m.type}:${m.itemId}`).join('; ')
    )
  }
  return lines.join('\n')
}
