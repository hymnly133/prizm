/**
 * ResizableSidebar - 可复用、可用鼠标拉伸的侧边栏
 * 支持左侧/右侧，宽度可拖拽调整，可选持久化到 localStorage，支持收起/展开
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionIcon, Flexbox } from '@lobehub/ui'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'

const DEFAULT_MIN = 160
const DEFAULT_MAX = 800
const COLLAPSED_WIDTH = 48
const STORAGE_PREFIX = 'prizm-sidebar-width-'
const COLLAPSED_PREFIX = 'prizm-sidebar-collapsed-'

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
  /** 是否支持收起/展开，默认 true */
  collapsible?: boolean
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
  collapsible = true,
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

  const loadCollapsed = useCallback((): boolean => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const v = localStorage.getItem(COLLAPSED_PREFIX + storageKey)
        return v === '1'
      } catch {
        // ignore
      }
    }
    return false
  }, [storageKey])

  const [width, setWidth] = useState(loadWidth)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const widthBeforeCollapse = useRef(width)
  const startXRef = useRef(0)
  const startWRef = useRef(width)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    setWidth(loadWidth())
  }, [loadWidth])

  useEffect(() => {
    setCollapsed(loadCollapsed())
  }, [loadCollapsed])

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

  const persistCollapsed = useCallback(
    (c: boolean) => {
      if (storageKey && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(COLLAPSED_PREFIX + storageKey, c ? '1' : '0')
        } catch {
          // ignore
        }
      }
    },
    [storageKey]
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (next) {
        widthBeforeCollapse.current = width
      } else {
        setWidth((w) => {
          const restored = widthBeforeCollapse.current
          const clamped = Math.min(maxWidth, Math.max(minWidth, restored))
          persistWidth(clamped)
          return clamped
        })
      }
      persistCollapsed(next)
      return next
    })
  }, [width, minWidth, maxWidth, persistWidth, persistCollapsed])

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

  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose
  const ExpandIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen

  const currentWidth = collapsed ? COLLAPSED_WIDTH : width
  const showResizeHandle = collapsible ? !collapsed : true

  const resizeHandle = showResizeHandle ? (
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
  ) : null

  const sidebarStyle: React.CSSProperties = {
    width: currentWidth,
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

  if (collapsed && collapsible) {
    return (
      <Flexbox
        className={className}
        style={{
          ...sidebarStyle,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column'
        }}
      >
        <ActionIcon icon={ExpandIcon} size="small" title="展开侧边栏" onClick={toggleCollapsed} />
      </Flexbox>
    )
  }

  return (
    <Flexbox className={className} style={sidebarStyle}>
      {collapsible && (
        <div
          className="resizable-sidebar-collapse-bar"
          style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
            padding: '4px 4px 4px 8px',
            borderBottom: '1px solid var(--ant-color-border)'
          }}
        >
          <ActionIcon
            icon={CollapseIcon}
            size="small"
            title="收起侧边栏"
            onClick={toggleCollapsed}
          />
        </div>
      )}
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden', flexDirection: 'column' }}>
        {children}
      </Flexbox>
      {resizeHandle}
    </Flexbox>
  )
}
