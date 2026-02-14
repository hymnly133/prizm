/**
 * useScope - Scope 管理与选择
 */
import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_SCOPE, ONLINE_SCOPE } from '@prizm/client-core'
import { usePrizmContext } from '../context/PrizmContext'

export function useScope() {
  const { manager } = usePrizmContext()
  const [currentScope, setCurrentScope] = useState<string>(ONLINE_SCOPE)
  const [scopes, setScopes] = useState<string[]>([])
  const [scopeDescriptions, setScopeDescriptions] = useState<
    Record<string, { label: string; description: string }>
  >({})
  const [scopesLoading, setScopesLoading] = useState(false)

  const refreshScopes = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    setScopesLoading(true)
    try {
      const { scopes: list, descriptions } = await http.listScopesWithInfo()
      setScopes(list.length > 0 ? list : [DEFAULT_SCOPE, ONLINE_SCOPE])
      setScopeDescriptions(descriptions ?? {})
      setCurrentScope((prev) => {
        if (!list.includes(prev)) {
          return list.includes(ONLINE_SCOPE) ? ONLINE_SCOPE : list[0] ?? DEFAULT_SCOPE
        }
        return prev
      })
    } catch {
      setScopes([DEFAULT_SCOPE, ONLINE_SCOPE])
      setScopeDescriptions({})
    } finally {
      setScopesLoading(false)
    }
  }, [manager])

  const getScopeLabel = useCallback(
    (scopeId: string) => scopeDescriptions[scopeId]?.label ?? scopeId,
    [scopeDescriptions]
  )

  const setScope = useCallback((scope: string) => {
    setCurrentScope(scope)
  }, [])

  useEffect(() => {
    if (manager) void refreshScopes()
  }, [manager, refreshScopes])

  return {
    currentScope,
    scopes,
    scopeDescriptions,
    scopesLoading,
    refreshScopes,
    getScopeLabel,
    setScope
  }
}
