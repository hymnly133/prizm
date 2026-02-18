/**
 * 获取 @ 引用候选与 slash 命令列表，供输入框 @ / 下拉使用
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'

export interface ScopeRefItem {
  id: string
  kind: string
  title: string
  charCount: number
  isShort: boolean
  updatedAt: number
  groupOrStatus?: string
}

export interface SlashCommandItem {
  name: string
  aliases: string[]
  description: string
}

export function useAgentScopeData(scope: string) {
  const { manager } = usePrizmContext()
  const [scopeItems, setScopeItems] = useState<ScopeRefItem[]>([])
  const [slashCommands, setSlashCommands] = useState<SlashCommandItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http || !scope) {
      setScopeItems([])
      setSlashCommands([])
      return
    }
    setLoading(true)
    try {
      const [itemsRes, cmdsRes] = await Promise.all([
        http.getAgentScopeItems(scope),
        http.getAgentSlashCommands(scope)
      ])
      setScopeItems(itemsRes.items ?? [])
      setSlashCommands(cmdsRes.commands ?? [])
    } catch {
      setScopeItems([])
      setSlashCommands([])
    } finally {
      setLoading(false)
    }
  }, [manager, scope])

  useEffect(() => {
    load()
  }, [load])

  // WS 订阅：文档/待办变更时刷新 @引用候选（防抖 1s）
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const SCOPE_DATA_EVENTS = new Set([
      'document:created',
      'document:deleted',
      'todo_list:created',
      'todo_list:deleted'
    ])
    const unsub = subscribeSyncEvents((eventType) => {
      if (!SCOPE_DATA_EVENTS.has(eventType)) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void load()
      }, 1000)
    })
    return () => {
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [load])

  return { scopeItems, slashCommands, loading, reload: load }
}
