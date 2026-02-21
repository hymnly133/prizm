/**
 * useWorkflowLayout — 工作流页面布局（与协作页对齐）.
 *
 * 管理右侧标签页面板的开关与主/右分栏比例，持久化到 localStorage。
 */
import { useState, useCallback, useRef, useEffect } from 'react'

const STORAGE_KEY_RIGHT_OPEN = 'prizm-workflow-right-open'
const STORAGE_KEY_SPLIT_PCT = 'prizm-workflow-split-pct'

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === 'true') return true
    if (v === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? '')
    return v >= min && v <= max ? v : fallback
  } catch {
    return fallback
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export interface WorkflowLayoutResult {
  rightPanelOpen: boolean
  splitPct: number
  splitContainerRef: React.RefObject<HTMLDivElement | null>
  handleSplitPointerDown: (e: React.PointerEvent) => void
  openRightPanel(): void
  closeRightPanel(): void
  toggleRightPanel(): void
}

export function useWorkflowLayout(): WorkflowLayoutResult {
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    loadBool(STORAGE_KEY_RIGHT_OPEN, false)
  )
  const [splitPct, _setSplitPct] = useState(() =>
    loadNumber(STORAGE_KEY_SPLIT_PCT, 55, 20, 80)
  )

  const openRightPanel = useCallback(() => {
    setRightPanelOpen(true)
    persist(STORAGE_KEY_RIGHT_OPEN, 'true')
  }, [])

  const closeRightPanel = useCallback(() => {
    setRightPanelOpen(false)
    persist(STORAGE_KEY_RIGHT_OPEN, 'false')
  }, [])

  const toggleRightPanel = useCallback(() => {
    setRightPanelOpen((prev) => {
      const next = !prev
      persist(STORAGE_KEY_RIGHT_OPEN, String(next))
      return next
    })
  }, [])

  const setSplitPct = useCallback((pct: number) => {
    _setSplitPct(pct)
  }, [])

  const persistSplitPct = useCallback(() => {
    _setSplitPct((prev) => {
      persist(STORAGE_KEY_SPLIT_PCT, String(prev))
      return prev
    })
  }, [])

  const splitContainerRef = useRef<HTMLDivElement>(null)
  const splitDraggingRef = useRef(false)
  const splitRafRef = useRef<number | null>(null)

  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    splitDraggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!splitDraggingRef.current || !splitContainerRef.current) return
      if (splitRafRef.current != null) cancelAnimationFrame(splitRafRef.current)
      splitRafRef.current = requestAnimationFrame(() => {
        splitRafRef.current = null
        const rect = splitContainerRef.current!.getBoundingClientRect()
        const x = e.clientX - rect.left
        setSplitPct(Math.min(80, Math.max(20, (x / rect.width) * 100)))
      })
    }
    const onUp = () => {
      if (!splitDraggingRef.current) return
      splitDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (splitRafRef.current != null) cancelAnimationFrame(splitRafRef.current)
      persistSplitPct()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setSplitPct, persistSplitPct])

  return {
    rightPanelOpen,
    splitPct,
    splitContainerRef,
    handleSplitPointerDown,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel
  }
}
