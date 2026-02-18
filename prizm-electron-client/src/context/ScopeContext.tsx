/**
 * ScopeContext — 全局 Scope 状态管理
 *
 * 解决问题：此前 useScope() 是独立 hook，17 处调用产生 17 份独立状态和 17 次 API 请求。
 * 集中到 Context 后，全应用共享一份 scope 状态，只发一次 API 调用，切换页面时 scope 同步。
 *
 * V2: 持久化 currentScope 到 localStorage；暴露 scopeDetails（path/label/builtin）和 createScope 方法。
 */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { DEFAULT_SCOPE, ONLINE_SCOPE } from '@prizm/client-core'
import { usePrizmContext } from './PrizmContext'

const STORAGE_KEY_SCOPE = 'prizm.currentScope'

function loadPersistedScope(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCOPE)
    if (raw && raw.length > 0) return raw
  } catch { /* ignore */ }
  return ONLINE_SCOPE
}

function persistScope(scope: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_SCOPE, scope)
  } catch { /* ignore */ }
}

export interface ScopeDetail {
  path: string | null
  label: string
  builtin: boolean
}

export interface ScopeContextValue {
  currentScope: string
  scopes: string[]
  scopeDescriptions: Record<string, { label: string; description: string }>
  scopeDetails: Record<string, ScopeDetail>
  scopesLoading: boolean
  refreshScopes: () => Promise<void>
  getScopeLabel: (scopeId: string) => string
  setScope: (scope: string) => void
  /** 从文件夹创建新工作区并自动切换 */
  createScope: (folderPath: string, id?: string, label?: string) => Promise<boolean>
}

const ScopeContext = createContext<ScopeContextValue | null>(null)

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const { manager } = usePrizmContext()
  const [currentScope, setCurrentScope] = useState<string>(loadPersistedScope)
  const [scopes, setScopes] = useState<string[]>([])
  const [scopeDescriptions, setScopeDescriptions] = useState<
    Record<string, { label: string; description: string }>
  >({})
  const [scopeDetails, setScopeDetails] = useState<Record<string, ScopeDetail>>({})
  const [scopesLoading, setScopesLoading] = useState(false)

  const refreshScopes = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    setScopesLoading(true)
    try {
      const { scopes: list, descriptions, scopeDetails: details } =
        await http.listScopesWithInfo()
      setScopes(list.length > 0 ? list : [DEFAULT_SCOPE, ONLINE_SCOPE])
      setScopeDescriptions(descriptions ?? {})
      setScopeDetails(details ?? {})
      setCurrentScope((prev) => {
        if (!list.includes(prev)) {
          const fallback = list.includes(ONLINE_SCOPE) ? ONLINE_SCOPE : list[0] ?? DEFAULT_SCOPE
          persistScope(fallback)
          return fallback
        }
        return prev
      })
    } catch {
      setScopes([DEFAULT_SCOPE, ONLINE_SCOPE])
      setScopeDescriptions({})
      setScopeDetails({})
    } finally {
      setScopesLoading(false)
    }
  }, [manager])

  /** Stable: 通过 ref 读取 scopeDescriptions + scopeDetails，回调引用稳定 */
  const descriptionsRef = useRef(scopeDescriptions)
  descriptionsRef.current = scopeDescriptions
  const detailsRef = useRef(scopeDetails)
  detailsRef.current = scopeDetails

  const getScopeLabel = useCallback(
    (scopeId: string) =>
      detailsRef.current[scopeId]?.label ??
      descriptionsRef.current[scopeId]?.label ??
      scopeId,
    []
  )

  const setScope = useCallback((scope: string) => {
    setCurrentScope(scope)
    persistScope(scope)
  }, [])

  const managerRef = useRef(manager)
  managerRef.current = manager

  const createScope = useCallback(
    async (folderPath: string, id?: string, label?: string): Promise<boolean> => {
      const http = managerRef.current?.getHttpClient()
      if (!http) return false
      const trimmedPath = folderPath.trim()
      if (!trimmedPath) return false
      const scopeId =
        id?.trim() ||
        trimmedPath
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop()
          ?.toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') ||
        `scope-${Date.now()}`
      if (scopeId === DEFAULT_SCOPE || scopeId === ONLINE_SCOPE) return false
      try {
        await http.registerScope({ id: scopeId, path: trimmedPath, label: label || undefined })
        await refreshScopes()
        setScope(scopeId)
        window.dispatchEvent(new CustomEvent('prizm-scopes-changed'))
        return true
      } catch {
        return false
      }
    },
    [refreshScopes, setScope]
  )

  useEffect(() => {
    if (manager) void refreshScopes()
  }, [manager, refreshScopes])

  useEffect(() => {
    const handler = () => void refreshScopes()
    window.addEventListener('prizm-scopes-changed', handler)
    return () => window.removeEventListener('prizm-scopes-changed', handler)
  }, [refreshScopes])

  const value = useMemo<ScopeContextValue>(
    () => ({
      currentScope,
      scopes,
      scopeDescriptions,
      scopeDetails,
      scopesLoading,
      refreshScopes,
      getScopeLabel,
      setScope,
      createScope
    }),
    [
      currentScope, scopes, scopeDescriptions, scopeDetails, scopesLoading,
      refreshScopes, getScopeLabel, setScope, createScope
    ]
  )

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

/**
 * 消费 ScopeContext — 作为 useScope() 的底层实现
 * 必须在 ScopeProvider 内部使用
 */
export function useScopeContext(): ScopeContextValue {
  const ctx = useContext(ScopeContext)
  if (!ctx) {
    throw new Error('useScopeContext must be used within <ScopeProvider>')
  }
  return ctx
}
