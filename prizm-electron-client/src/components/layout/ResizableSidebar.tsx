/**
 * ResizableSidebar - 可复用、可用鼠标拉伸的侧边栏
 * 支持左侧/右侧，宽度可拖拽调整，可选持久化到 localStorage
 *
 * 折叠模式（VSCode 风格）：
 *   - 受控模式：传入 collapsed + onCollapsedChange，折叠按钮由外部（标题栏）控制
 *   - 非受控模式（默认）：内部管理折叠状态
 *   - 折叠时子组件保持挂载（CSS 隐藏），避免重新挂载导致的卡顿
 *   - 展开/折叠使用 CSS transition 实现平滑动画
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_MIN = 160
const DEFAULT_MAX = 800
const STORAGE_PREFIX = 'prizm-sidebar-width-'
const COLLAPSED_PREFIX = 'prizm-sidebar-collapsed-'
const TRANSITION_MS = 200

export interface ResizableSidebarProps {
  children: React.ReactNode
  side: 'left' | 'right'
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  storageKey?: string
  /** 受控折叠状态 */
  collapsed?: boolean
  /** 受控模式下的折叠变化回调 */
  onCollapsedChange?: (collapsed: boolean) => void
  className?: string
  style?: React.CSSProperties
  /** 拖拽手柄宽度（可点击区域），默认 10 */
  handleWidth?: number
  /** 手柄向侧栏外侧伸出的像素（便于在边界处拖拽），默认 0 */
  handleOverflow?: number
}

export function ResizableSidebar({
  children,
  side,
  defaultWidth = side === 'left' ? 220 : 280,
  minWidth = DEFAULT_MIN,
  maxWidth = DEFAULT_MAX,
  storageKey,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className,
  style,
  handleWidth = 10,
  handleOverflow = 0
}: ResizableSidebarProps) {
  const isControlled = controlledCollapsed !== undefined

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
  const [internalCollapsed, setInternalCollapsed] = useState(loadCollapsed)
  const widthBeforeCollapse = useRef(width)
  const startXRef = useRef(0)
  const startWRef = useRef(width)
  const rafRef = useRef<number | null>(null)

  const collapsed = isControlled ? controlledCollapsed : internalCollapsed

  useEffect(() => {
    setWidth(loadWidth())
  }, [loadWidth])

  useEffect(() => {
    if (!isControlled) setInternalCollapsed(loadCollapsed())
  }, [isControlled, loadCollapsed])

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

  // 监听受控 collapsed 变化 → 恢复宽度
  useEffect(() => {
    if (!collapsed && widthBeforeCollapse.current > 0) {
      const clamped = Math.min(maxWidth, Math.max(minWidth, widthBeforeCollapse.current))
      setWidth(clamped)
      persistWidth(clamped)
    }
    if (collapsed) {
      widthBeforeCollapse.current = width
    }
    persistCollapsed(collapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed])

  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return
      e.preventDefault()
      startXRef.current = e.clientX
      startWRef.current = width
      setDragging(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [width, collapsed]
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

  const effectiveWidth = collapsed ? 0 : width

  const sidebarStyle: React.CSSProperties = {
    width: effectiveWidth,
    maxWidth: 'none', // 避免被全局或父级 max-width 限制，保证可拖到 maxWidth 设定值
    flexShrink: 0,
    minWidth: 0,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    // overflow: visible 以便拖拽手柄可伸出右/左侧，不被裁剪（内容区由内层 overflow: hidden 裁剪）
    overflow: 'visible',
    height: '100%',
    background: collapsed ? 'transparent' : 'var(--ant-color-bg-layout)',
    borderRight: side === 'left' && !collapsed ? '1px solid var(--ant-color-border)' : undefined,
    borderLeft: side === 'right' && !collapsed ? '1px solid var(--ant-color-border)' : undefined,
    // 拖拽时关闭 transition 以保证流畅
    transition: dragging
      ? 'none'
      : `width ${TRANSITION_MS}ms ease, border-color ${TRANSITION_MS}ms ease`,
    ...style
  }

  const contentStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    // 折叠时隐藏内容但保持挂载
    visibility: collapsed ? 'hidden' : 'visible',
    opacity: collapsed ? 0 : 1,
    transition: dragging ? 'none' : `opacity ${TRANSITION_MS}ms ease`
  }

  return (
    <div className={className} style={sidebarStyle}>
      <div style={{ flex: 1, minHeight: 0, ...contentStyle }}>{children}</div>
      {!collapsed && (
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
            [side === 'left' ? 'right' : 'left']: -handleOverflow,
            width: handleWidth,
            zIndex: 1
          }}
        />
      )}
    </div>
  )
}
