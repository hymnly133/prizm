/**
 * useCardSelection — 卡片多选状态管理
 *
 * 支持两种触发方式：
 * 1. Ctrl/Cmd+Click 进入选择模式并切换卡片
 * 2. 工具栏按钮手动进入选择模式
 *
 * 提供 range select (Shift+Click) 支持
 */
import { useState, useCallback, useRef } from 'react'

export interface CardSelectionState {
  selectedIds: Set<string>
  isSelectionMode: boolean
}

export interface CardSelectionActions {
  toggleItem: (id: string, shiftKey?: boolean) => void
  selectAll: (ids: string[]) => void
  deselectAll: () => void
  enterSelectionMode: () => void
  exitSelectionMode: () => void
  toggleSelectionMode: () => void
  isSelected: (id: string) => boolean
}

export function useCardSelection(
  orderedIds: string[]
): CardSelectionState & CardSelectionActions {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const lastClickedRef = useRef<string | null>(null)

  const toggleItem = useCallback(
    (id: string, shiftKey = false) => {
      setIsSelectionMode(true)
      setSelectedIds((prev) => {
        const next = new Set(prev)

        if (shiftKey && lastClickedRef.current && lastClickedRef.current !== id) {
          const startIdx = orderedIds.indexOf(lastClickedRef.current)
          const endIdx = orderedIds.indexOf(id)
          if (startIdx !== -1 && endIdx !== -1) {
            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
            for (let i = from; i <= to; i++) {
              next.add(orderedIds[i])
            }
            lastClickedRef.current = id
            return next
          }
        }

        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        lastClickedRef.current = id
        return next
      })
    },
    [orderedIds]
  )

  const selectAll = useCallback((ids: string[]) => {
    setIsSelectionMode(true)
    setSelectedIds(new Set(ids))
  }, [])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false)
    setSelectedIds(new Set())
    lastClickedRef.current = null
  }, [])

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set())
        lastClickedRef.current = null
      }
      return !prev
    })
  }, [])

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  return {
    selectedIds,
    isSelectionMode,
    toggleItem,
    selectAll,
    deselectAll,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectionMode,
    isSelected
  }
}
