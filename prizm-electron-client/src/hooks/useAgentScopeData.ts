/**
 * 获取 @ 引用候选与 slash 命令列表，供输入框 @ / 下拉使用
 * 使用 resourceRef 全量资源系统；支持按场景传 types 过滤（不传则全量）
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type { ResourceType } from '@prizm/shared'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'

/** 工作流管理会话中 @ 引用仅展示的类型（workflow / run / task / session） */
export const WORKFLOW_MANAGEMENT_REF_TYPES: ResourceType[] = [
  'workflow',
  'run',
  'task',
  'session'
]

export interface ResourceTypeMeta {
  type: string
  label: string
  icon: string
  listable: boolean
  aliases: string[]
}

export interface ScopeRefItem {
  id: string
  /** 资源类型（新字段，来自 resourceRef 系统） */
  type?: string
  /** 旧版 kind 字段，兼容保留 */
  kind: string
  title: string
  charCount: number
  isShort?: boolean
  updatedAt: number
  groupOrStatus?: string
}

export interface SlashCommandItem {
  name: string
  aliases: string[]
  description: string
  /** 分类：用于分组展示 */
  category?: string
}

export interface UseAgentScopeDataOptions {
  /** 仅拉取这些资源类型；不传则全量（所有 listable 类型） */
  types?: ResourceType[]
}

export function useAgentScopeData(scope: string, options?: UseAgentScopeDataOptions) {
  const { manager } = usePrizmContext()
  const [scopeItems, setScopeItems] = useState<ScopeRefItem[]>([])
  const [typeMetadata, setTypeMetadata] = useState<ResourceTypeMeta[]>([])
  const [slashCommands, setSlashCommands] = useState<SlashCommandItem[]>([])
  const [loading, setLoading] = useState(false)
  const types = options?.types

  const load = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http || !scope) {
      setScopeItems([])
      setTypeMetadata([])
      setSlashCommands([])
      return
    }
    setLoading(true)
    try {
      const [itemsRes, cmdsRes] = await Promise.all([
        http.getAgentScopeItems(scope, types?.length ? types : undefined),
        http.getAgentSlashCommands(scope)
      ])
      setScopeItems(itemsRes.items ?? [])
      setTypeMetadata(itemsRes.typeMetadata ?? [])
      setSlashCommands(cmdsRes.commands ?? [])
    } catch {
      setScopeItems([])
      setTypeMetadata([])
      setSlashCommands([])
    } finally {
      setLoading(false)
    }
  }, [manager, scope, types])

  useEffect(() => {
    load()
  }, [load])

  // WS 订阅：资源变更时刷新 @引用候选（防抖 1s）
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const SCOPE_DATA_EVENTS = new Set([
      'document:created',
      'document:deleted',
      'todo_list:created',
      'todo_list:deleted',
      'command:changed',
      'workflow:def.registered',
      'workflow:def.deleted',
      'workflow:run.changed',
      'schedule:changed',
      'cron:changed'
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

  return { scopeItems, typeMetadata, slashCommands, loading, reload: load }
}
