/**
 * useCollabLayout — manages the session-first collaboration page layout.
 *
 * Main area always shows Session chat.
 * Right panel can be opened/closed with Document / Task / Workflow tabs.
 * Split resize is handled via pointer events on the divider.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import type { RightPanelTab, CollabLayoutState } from '../components/collaboration/collabTypes'

const STORAGE_KEY_RIGHT_OPEN = 'prizm-collab-right-open'
const STORAGE_KEY_RIGHT_TAB = 'prizm-collab-right-tab'
const STORAGE_KEY_SPLIT_PCT = 'prizm-collab-split-pct'

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

const VALID_TABS = new Set<string>(['document', 'task', 'workflow'])

function parseTab(raw: string, fallback: RightPanelTab): RightPanelTab {
  return VALID_TABS.has(raw) ? (raw as RightPanelTab) : fallback
}

function loadInitial(): CollabLayoutState {
  return {
    rightPanelOpen: loadBool(STORAGE_KEY_RIGHT_OPEN, false),
    rightPanelTab: parseTab(localStorage.getItem(STORAGE_KEY_RIGHT_TAB) ?? '', 'document'),
    rightPanelEntityId: null,
    splitPct: loadNumber(STORAGE_KEY_SPLIT_PCT, 55, 20, 80)
  }
}

export function useCollabLayout() {
  const [state, setState] = useState<CollabLayoutState>(loadInitial)

  const openRightPanel = useCallback((tab: RightPanelTab, entityId?: string) => {
    setState((prev) => {
      persist(STORAGE_KEY_RIGHT_OPEN, 'true')
      persist(STORAGE_KEY_RIGHT_TAB, tab)
      return {
        ...prev,
        rightPanelOpen: true,
        rightPanelTab: tab,
        rightPanelEntityId: entityId ?? null
      }
    })
  }, [])

  const closeRightPanel = useCallback(() => {
    setState((prev) => {
      persist(STORAGE_KEY_RIGHT_OPEN, 'false')
      return { ...prev, rightPanelOpen: false, rightPanelEntityId: null }
    })
  }, [])

  const toggleRightPanel = useCallback((tab?: RightPanelTab) => {
    setState((prev) => {
      if (prev.rightPanelOpen && (!tab || tab === prev.rightPanelTab)) {
        persist(STORAGE_KEY_RIGHT_OPEN, 'false')
        return { ...prev, rightPanelOpen: false, rightPanelEntityId: null }
      }
      const nextTab = tab ?? prev.rightPanelTab
      persist(STORAGE_KEY_RIGHT_OPEN, 'true')
      persist(STORAGE_KEY_RIGHT_TAB, nextTab)
      return { ...prev, rightPanelOpen: true, rightPanelTab: nextTab }
    })
  }, [])

  const switchRightTab = useCallback((tab: RightPanelTab, entityId?: string) => {
    setState((prev) => {
      persist(STORAGE_KEY_RIGHT_TAB, tab)
      return {
        ...prev,
        rightPanelTab: tab,
        rightPanelEntityId: entityId ?? null
      }
    })
  }, [])

  const clearRightEntityId = useCallback(() => {
    setState((prev) => ({ ...prev, rightPanelEntityId: null }))
  }, [])

  const setSplitPct = useCallback((pct: number) => {
    setState((prev) => ({ ...prev, splitPct: pct }))
  }, [])

  const persistSplitPct = useCallback(() => {
    setState((prev) => {
      persist(STORAGE_KEY_SPLIT_PCT, String(prev.splitPct))
      return prev
    })
  }, [])

  /* Split resize pointer handling */
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
    ...state,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel,
    switchRightTab,
    clearRightEntityId,
    setSplitPct,
    persistSplitPct,
    splitContainerRef,
    handleSplitPointerDown
  }
}
