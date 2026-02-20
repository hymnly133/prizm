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
import { useScheduleStore, subscribeScheduleEvents } from '../store/scheduleStore'
import { useWorkflowStore, subscribeWorkflowEvents } from '../store/workflowStore'

export function useScopeDataBinding(): void {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const bindScope = useScopeDataStore((s) => s.bind)
  const resetScope = useScopeDataStore((s) => s.reset)
  const bindSchedule = useScheduleStore((s) => s.bind)
  const resetSchedule = useScheduleStore((s) => s.reset)
  const bindWorkflow = useWorkflowStore((s) => s.bind)
  const resetWorkflow = useWorkflowStore((s) => s.reset)

  useEffect(() => {
    if (!manager || !currentScope) {
      resetScope()
      resetSchedule()
      resetWorkflow()
      return
    }
    const http = manager.getHttpClient()
    bindScope(http, currentScope)
    bindSchedule(http, currentScope)
    bindWorkflow(http, currentScope)
    const store = useAgentSessionStore.getState()
    store.setHttpClient(http)
    void store.refreshSessions(currentScope)
  }, [manager, currentScope, bindScope, resetScope, bindSchedule, resetSchedule, bindWorkflow, resetWorkflow])

  useEffect(() => {
    const unsubScope = subscribeScopeDataEvents()
    const unsubSchedule = subscribeScheduleEvents()
    const unsubWorkflow = subscribeWorkflowEvents()
    return () => {
      unsubScope()
      unsubSchedule()
      unsubWorkflow()
    }
  }, [])
}
