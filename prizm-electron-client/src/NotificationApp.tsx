import { ActionIcon, Markdown } from '@lobehub/ui'
import { X } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

interface NotifItem {
  id: string
  title: string
  body?: string
  source?: string
  createdAt: number
  /** 刚被更新（非新建），用于播放高亮动画 */
  justUpdated?: boolean
}

const AUTO_DISMISS_MS = 8000
const MAX_VISIBLE = 12

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

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function nextId() {
  return 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
}

export default function NotificationApp() {
  const [items, setItems] = useState<NotifItem[]>([])

  function remove(id: string) {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    setItems((prev) => prev.filter((x) => x.id !== id))
  }

  const prevLenRef = useRef(0)
  const panelRefRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const hasUpdated = items.some((x) => x.justUpdated)
    if (!hasUpdated) return
    const t = setTimeout(() => {
      setItems((prev) => prev.map((x) => (x.justUpdated ? { ...x, justUpdated: false } : x)))
    }, 600)
    return () => clearTimeout(t)
  }, [items])

  useEffect(() => {
    // 新通知到达时滚动到顶部（需在 prevLenRef 更新前读取）
    const prev = prevLenRef.current
    if (items.length > prev) {
      panelRefRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    prevLenRef.current = items.length
    if (prev > 0 && items.length === 0) {
      window.notificationApi?.notifyPanelEmpty?.()
    }
  }, [items.length])
  useEffect(() => {
    function show(payload: {
      title?: string
      body?: string
      source?: string
      updateId?: string
      [key: string]: unknown
    }) {
      const updateId = payload.updateId as string | undefined
      const item: NotifItem = {
        id: updateId ?? nextId(),
        title: payload.title || '通知',
        body: payload.body,
        source: payload.source as string | undefined,
        createdAt: Date.now()
      }

      let timerSetInUpdate = false
      setItems((prev) => {
        if (updateId) {
          const idx = prev.findIndex((x) => x.id === updateId)
          if (idx >= 0) {
            timerSetInUpdate = true
            const next = [...prev]
            next[idx] = { ...item, createdAt: next[idx].createdAt, justUpdated: true }
            const t = timers.get(updateId)
            if (t) {
              clearTimeout(t)
              timers.delete(updateId)
            }
            const timer = setTimeout(() => {
              timers.delete(updateId)
              remove(updateId)
            }, AUTO_DISMISS_MS)
            timers.set(updateId, timer)
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

      if (!timerSetInUpdate) {
        const timer = setTimeout(() => {
          timers.delete(item.id)
          remove(item.id)
        }, AUTO_DISMISS_MS)
        timers.set(item.id, timer)
      }
    }

    window.notificationApi?.onNotification?.(show)
    window.notificationApi?.notifyReady?.()
  }, [])

  return (
    <div ref={panelRefRef} className="notification-panel">
      {items.map((item) => (
        <div
          key={item.id}
          className={`notification-item${item.justUpdated ? ' notification-item--updated' : ''}`}
          role="alert"
          aria-live="polite"
          onClick={() => remove(item.id)}
        >
          <div className="notification-item__content">
            <div className="notification-item__title">
              <Markdown>{item.title || '通知'}</Markdown>
            </div>
            {item.body && (
              <div className="notification-item__body">
                <Markdown>{item.body}</Markdown>
              </div>
            )}
            <div className="notification-item__meta">
              {formatTime(item.createdAt)}
              {item.source && <span className="notification-item__source">· {item.source}</span>}
            </div>
          </div>
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
        </div>
      ))}
    </div>
  )
}
