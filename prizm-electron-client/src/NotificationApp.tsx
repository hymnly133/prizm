import { ActionIcon, Markdown } from '@lobehub/ui'
import { X } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { TodoItem, TodoItemStatus } from '@prizm/client-core'
import { STATUS_LABELS } from './constants/todo'

/** 通知项：支持原始事件或兼容 title/body */
interface NotifItem {
  id: string
  eventType: string
  payload: unknown
  title?: string
  body?: string
  source?: string
  createdAt: number
  justUpdated?: boolean
}

const AUTO_DISMISS_MS = 8000
const MAX_VISIBLE = 12
/** 收起态最多露出的堆叠层数（含最前面完整显示的那条） */
const MAX_STACK_LAYERS = 3

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function nextId() {
  return 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
}

/** 根据 eventType + payload 渲染通知内容 */
function NotificationItemContent({ item }: { item: NotifItem }) {
  const { eventType, payload, title, body } = item
  const p = (payload ?? {}) as Record<string, unknown>

  const todoListEvents = [
    'todo_list:created',
    'todo_list:updated',
    'todo_list:deleted',
    'todo_item:created',
    'todo_item:updated',
    'todo_item:deleted'
  ]
  if (todoListEvents.includes(eventType)) {
    if (eventType === 'todo_list:deleted' || p.deleted === true) {
      return (
        <div className="notification-item__content">
          <div className="notification-item__title">TODO 列表已删除</div>
          <div className="notification-item__meta">{formatTime(item.createdAt)}</div>
        </div>
      )
    }
    if (eventType.startsWith('todo_item:')) {
      const itemTitle = (p.title as string) || '(无标题)'
      const labels: Record<string, string> = {
        'todo_item:created': 'TODO 项已添加',
        'todo_item:updated': 'TODO 项已更新',
        'todo_item:deleted': 'TODO 项已删除'
      }
      return (
        <div className="notification-item__content">
          <div className="notification-item__title">{labels[eventType] ?? eventType}</div>
          <div className="notification-item__body">{itemTitle}</div>
          <div className="notification-item__meta">{formatTime(item.createdAt)}</div>
        </div>
      )
    }
    const listTitle = (p.title as string) || '待办'
    const itemCount = (p.itemCount as number) ?? 0
    const doneCount = (p.doneCount as number) ?? 0
    const items = (p.items as TodoItem[]) ?? []
    const todoCount = items.length

    return (
      <div className="notification-item__content">
        <div className="notification-item__title">{listTitle}</div>
        <div className="notification-item__body">
          <span className="notification-item__todo-stats">
            {doneCount}/{itemCount || todoCount} 已完成
          </span>
          {items.length > 0 && (
            <ul className="notification-item__todo-items">
              {items.slice(0, 5).map((it) => (
                <li
                  key={it.id}
                  className={`notification-item__todo-item notification-item__todo-item--${it.status}`}
                >
                  <span className="notification-item__todo-status">
                    {STATUS_LABELS[it.status as TodoItemStatus] ?? it.status}
                  </span>
                  <span className="notification-item__todo-title">{it.title || '(无标题)'}</span>
                </li>
              ))}
              {items.length > 5 && (
                <li className="notification-item__todo-more">… 共 {items.length} 项</li>
              )}
            </ul>
          )}
        </div>
        <div className="notification-item__meta">{formatTime(item.createdAt)}</div>
      </div>
    )
  }

  if (eventType === 'agent:message.completed') {
    return (
      <div className="notification-item__content">
        <div className="notification-item__title notification-item__title--agent">
          Agent 回复完成
        </div>
        {(body ?? (p.body as string)) && (
          <div className="notification-item__body">{body ?? (p.body as string)}</div>
        )}
        <div className="notification-item__meta">{formatTime(item.createdAt)}</div>
      </div>
    )
  }

  if (eventType === 'notification' || (title !== undefined && !eventType)) {
    return (
      <div className="notification-item__content">
        <div className="notification-item__title">
          <Markdown>{(title ?? (p.title as string)) || '通知'}</Markdown>
        </div>
        {(body ?? (p.body as string)) && (
          <div className="notification-item__body">
            <Markdown>{body ?? (p.body as string)}</Markdown>
          </div>
        )}
        <div className="notification-item__meta">
          {formatTime(item.createdAt)}
          {item.source && <span className="notification-item__source">· {item.source}</span>}
        </div>
      </div>
    )
  }

  const labels: Record<string, string> = {
    'note:created': '新便签',
    'note:updated': '便签已更新',
    'note:deleted': '便签已删除',
    'clipboard:itemAdded': '剪贴板新增',
    'clipboard:itemDeleted': '剪贴板已删除',
    'document:created': '新文档',
    'document:updated': '文档已更新',
    'document:deleted': '文档已删除'
  }
  const fallbackTitle = labels[eventType] ?? eventType
  const extra = (p.title as string) ?? (p.content as string) ?? ''

  return (
    <div className="notification-item__content">
      <div className="notification-item__title">{fallbackTitle}</div>
      {extra && (
        <div className="notification-item__body">
          <Markdown>
            {String(extra).slice(0, 120) + (String(extra).length > 120 ? '…' : '')}
          </Markdown>
        </div>
      )}
      <div className="notification-item__meta">
        {formatTime(item.createdAt)}
        {item.source && <span className="notification-item__source">· {item.source}</span>}
      </div>
    </div>
  )
}

export default function NotificationApp() {
  const [items, setItems] = useState<NotifItem[]>([])
  const [expanded, setExpanded] = useState(false)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const panelRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  const shouldReduceMotion = useReducedMotion()
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const remove = useCallback((id: string) => {
    const timers = timersRef.current
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    setItems((prev) => prev.filter((x) => x.id !== id))
  }, [])

  /** Pause auto-dismiss timers while expanded, resume on collapse */
  const pausedTimersRef = useRef(new Map<string, number>())

  const pauseAllTimers = useCallback(() => {
    const timers = timersRef.current
    const paused = pausedTimersRef.current
    paused.clear()
    timers.forEach((t, id) => {
      clearTimeout(t)
      paused.set(id, Date.now())
    })
    timers.clear()
  }, [])

  const resumeAllTimers = useCallback(() => {
    const paused = pausedTimersRef.current
    paused.forEach((_ts, id) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(id)
        remove(id)
      }, AUTO_DISMISS_MS)
      timersRef.current.set(id, timer)
    })
    paused.clear()
  }, [remove])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  useEffect(() => {
    const hasUpdated = items.some((x) => x.justUpdated)
    if (!hasUpdated) return
    const t = setTimeout(() => {
      setItems((prev) => prev.map((x) => (x.justUpdated ? { ...x, justUpdated: false } : x)))
    }, 600)
    return () => clearTimeout(t)
  }, [items])

  useEffect(() => {
    const prev = prevLenRef.current
    prevLenRef.current = items.length
    if (prev > 0 && items.length === 0) {
      setExpanded(false)
      window.notificationApi?.setMouseInteractive?.(false)
      window.notificationApi?.notifyPanelEmpty?.()
    }
  }, [items.length])

  useEffect(() => {
    const timers = timersRef.current

    function scheduleAutoDismiss(id: string) {
      const existing = timers.get(id)
      if (existing) {
        clearTimeout(existing)
        timers.delete(id)
      }
      const timer = setTimeout(() => {
        timers.delete(id)
        remove(id)
      }, AUTO_DISMISS_MS)
      timers.set(id, timer)
    }

    function show(payload: {
      title?: string
      body?: string
      source?: string
      updateId?: string
      eventType?: string
      payload?: unknown
      [key: string]: unknown
    }) {
      const updateId = payload.updateId as string | undefined
      const eventType = (payload.eventType as string) ?? 'notification'
      const rawPayload =
        payload.payload ??
        (payload.title !== undefined ? { title: payload.title, body: payload.body } : {})

      const item: NotifItem = {
        id: updateId ?? nextId(),
        eventType,
        payload: rawPayload,
        title: payload.title as string | undefined,
        body: payload.body as string | undefined,
        source: payload.source as string | undefined,
        createdAt: Date.now()
      }

      let timerScheduledInUpdate = false
      setItems((prev) => {
        if (updateId) {
          const idx = prev.findIndex((x) => x.id === updateId)
          if (idx >= 0) {
            timerScheduledInUpdate = true
            const next = [...prev]
            next[idx] = { ...item, createdAt: next[idx].createdAt, justUpdated: true }
            scheduleAutoDismiss(updateId)
            return next
          }
        }
        const next = [item, ...prev]
        if (next.length > MAX_VISIBLE) {
          const oldest = next[next.length - 1]
          const t = timers.get(oldest.id)
          if (t) {
            clearTimeout(t)
            timers.delete(oldest.id)
          }
          return next.slice(0, MAX_VISIBLE)
        }
        return next
      })

      if (!timerScheduledInUpdate) {
        scheduleAutoDismiss(item.id)
      }
    }

    window.notificationApi?.onNotification?.(show)
    window.notificationApi?.notifyReady?.()
  }, [remove])

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setExpanded(true)
    pauseAllTimers()
    window.notificationApi?.setMouseInteractive?.(true)
  }, [pauseAllTimers])

  const handleMouseLeave = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setExpanded(false)
      resumeAllTimers()
      window.notificationApi?.setMouseInteractive?.(false)
      hoverTimerRef.current = null
    }, 300)
  }, [resumeAllTimers])

  const dur = shouldReduceMotion ? 0.05 : 0.3

  if (items.length === 0) return null

  const isStacked = !expanded && items.length > 1
  const hiddenCount = isStacked ? items.length - 1 : 0

  return (
    <div
      ref={panelRef}
      className={`notification-panel ${expanded ? 'notification-panel--expanded' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Expanded: scrollable list */}
      {expanded && (
        <div className="notification-panel__list">
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                className={`notification-item${
                  item.justUpdated ? ' notification-item--updated' : ''
                }`}
                role="alert"
                aria-live="polite"
                layout
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: { duration: dur, ease: 'easeOut' }
                }}
                exit={{
                  opacity: 0,
                  scale: 0.96,
                  y: -10,
                  transition: { duration: dur * 0.7, ease: 'easeIn' }
                }}
                style={{ position: 'relative' }}
              >
                <NotificationItemContent item={item} />
                <ActionIcon
                  icon={X}
                  size="small"
                  aria-label="关闭"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(item.id)
                  }}
                  className="notification-item__close"
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Collapsed: stacked cards */}
      {!expanded && (
        <div className="notification-panel__stack">
          {items.slice(0, MAX_STACK_LAYERS).map((item, i) => {
            const isTop = i === 0
            const scale = 1 - i * 0.04
            const yOffset = i * -6
            const opacity = i === 0 ? 1 : i === 1 ? 0.7 : 0.4

            return (
              <motion.div
                key={item.id}
                className={`notification-item notification-item--stacked${
                  item.justUpdated && isTop ? ' notification-item--updated' : ''
                }`}
                role={isTop ? 'alert' : undefined}
                aria-live={isTop ? 'polite' : undefined}
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{
                  opacity,
                  y: yOffset,
                  scale,
                  transition: { duration: dur, ease: [0.32, 0.72, 0, 1] }
                }}
                exit={{ opacity: 0, y: 20, scale: 0.9, transition: { duration: dur * 0.6 } }}
                style={{
                  zIndex: MAX_STACK_LAYERS - i,
                  position: i === 0 ? 'relative' : 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  pointerEvents: isTop ? 'auto' : 'none'
                }}
              >
                {isTop && (
                  <>
                    <NotificationItemContent item={item} />
                    <ActionIcon
                      icon={X}
                      size="small"
                      aria-label="关闭"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(item.id)
                      }}
                      className="notification-item__close"
                    />
                  </>
                )}
                {!isTop && (
                  <div className="notification-item__content" style={{ visibility: 'hidden' }}>
                    <div className="notification-item__title">&nbsp;</div>
                  </div>
                )}
              </motion.div>
            )
          })}

          {hiddenCount > 0 && <div className="notification-stack__badge">+{hiddenCount}</div>}
        </div>
      )}
    </div>
  )
}
