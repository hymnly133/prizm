/**
 * 获取 @ 引用候选与 slash 命令列表，供输入框 @ / 下拉使用
 */
import { useState, useCallback, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'

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

  return { scopeItems, slashCommands, loading, reload: load }
}
