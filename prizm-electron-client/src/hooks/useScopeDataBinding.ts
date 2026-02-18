/**
 * useScopeDataBinding — 将 scopeDataStore + agentSessionStore 绑定到当前 PrizmContext + ScopeContext
 *
 * 在 AppContent 顶层调用一次即可。当 HTTP client 或 scope 变化时自动重新绑定，
 * 同时启动 WS 事件订阅。
 */
import { useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from './useScope'
import { useScopeDataStore, subscribeScopeDataEvents } from '../store/scopeDataStore'
import { useAgentSessionStore } from '../store/agentSessionStore'

export function useScopeDataBinding(): void {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const bind = useScopeDataStore((s) => s.bind)
  const reset = useScopeDataStore((s) => s.reset)

  useEffect(() => {
    if (!manager || !currentScope) {
      reset()
      return
    }
    const http = manager.getHttpClient()
    bind(http, currentScope)
    const store = useAgentSessionStore.getState()
    store.setHttpClient(http)
    void store.refreshSessions(currentScope)
  }, [manager, currentScope, bind, reset])

  useEffect(() => {
    const unsub = subscribeScopeDataEvents()
    return unsub
  }, [])
}
