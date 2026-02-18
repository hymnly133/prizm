/**
 * 持久化工具卡片展开/折叠状态
 *
 * 流式输出期间，ChatList 可能因数据更新导致卡片组件重新挂载，
 * 此 hook 将 expanded 状态存储在模块级 Map 中，跨挂载周期保留。
 */
import { useState, useCallback } from 'react'

const _expandedState = new Map<string, boolean>()

export function useToolCardExpanded(id: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => _expandedState.get(id) ?? false)

  const toggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v
      _expandedState.set(id, next)
      return next
    })
  }, [id])

  return [expanded, toggle]
}

export function useToolCardExpandedKeyboard(toggle: () => void): (e: React.KeyboardEvent) => void {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle]
  )
}
