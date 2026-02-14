/**
 * ResizableSidebar - 可复用、可用鼠标拉伸的侧边栏
 * 支持左侧/右侧，宽度可拖拽调整，可选持久化到 localStorage
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Flexbox } from '@lobehub/ui'

const DEFAULT_MIN = 160
const DEFAULT_MAX = 480
const STORAGE_PREFIX = 'prizm-sidebar-width-'

export interface ResizableSidebarProps {
  /** 侧边栏内容 */
  children: React.ReactNode
  /** 左侧栏或右侧栏 */
  side: 'left' | 'right'
  /** 默认宽度（px） */
  defaultWidth?: number
  /** 最小宽度（px） */
  minWidth?: number
  /** 最大宽度（px） */
  maxWidth?: number
  /** 持久化 key：设置则把宽度存到 localStorage，下次用该 key 恢复 */
  storageKey?: string
  /** 自定义类名（应用在侧栏容器上） */
  className?: string
  /** 自定义样式（应用在侧栏容器上） */
  style?: React.CSSProperties
}

export function ResizableSidebar({
  children,
  side,
  defaultWidth = side === 'left' ? 220 : 280,
  minWidth = DEFAULT_MIN,
  maxWidth = DEFAULT_MAX,
  storageKey,
  className,
  style
}: ResizableSidebarProps) {
  const loadWidth = useCallback((): number => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const v = localStorage.getItem(STORAGE_PREFIX + storageKey)
        if (v != null) {
          const n = parseInt(v, 10)
          if (!Number.isNaN(n) && n >= minWidth && n <= maxWidth) return n
        }
      } catch {
        // ignore
      }
    }
    return defaultWidth
  }, [storageKey, defaultWidth, minWidth, maxWidth])

  const [width, setWidth] = useState(loadWidth)
  const startXRef = useRef(0)
  const startWRef = useRef(width)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    setWidth(loadWidth())
  }, [loadWidth])

  const persistWidth = useCallback(
    (w: number) => {
      if (storageKey && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_PREFIX + storageKey, String(w))
        } catch {
          // ignore
        }
      }
    },
    [storageKey]
  )

  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      startXRef.current = e.clientX
      startWRef.current = width
      setDragging(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [width]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const delta =
          side === 'left' ? e.clientX - startXRef.current : startXRef.current - e.clientX
        const next = Math.min(maxWidth, Math.max(minWidth, startWRef.current + delta))
        setWidth(next)
        persistWidth(next)
      })
    }
    const onUp = () => {
      setDragging(false)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, side, minWidth, maxWidth, persistWidth])

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      onPointerDown={handlePointerDown}
      className="resizable-sidebar-handle"
      style={{
        cursor: 'col-resize',
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 'left' ? 'right' : 'left']: 0,
        width: 6,
        zIndex: 1
      }}
    />
  )

  const sidebarStyle: React.CSSProperties = {
    width,
    flexShrink: 0,
    minWidth: 0,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
    background: 'var(--ant-color-bg-layout)',
    borderRight: side === 'left' ? '1px solid var(--ant-color-border)' : undefined,
    borderLeft: side === 'right' ? '1px solid var(--ant-color-border)' : undefined,
    ...style
  }

  return (
    <Flexbox className={className} style={sidebarStyle}>
      {children}
      {resizeHandle}
    </Flexbox>
  )
}
