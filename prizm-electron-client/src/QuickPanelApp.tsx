import { useState, useEffect, useRef, useCallback } from 'react'
import { FilePlus, MessageSquare, FileText, Sparkles } from 'lucide-react'

export type QuickPanelAction =
  | 'create-document'
  | 'chat-with-text'
  | 'create-document-with-text'
  | 'ai-organize-to-document'

interface QuickPanelItem {
  id: QuickPanelAction
  label: string
  icon: React.ReactNode
}

const BASE_ITEMS: QuickPanelItem[] = [
  { id: 'create-document', label: '新建文档', icon: <FilePlus size={18} /> }
]

const TEXT_ITEMS: QuickPanelItem[] = [
  { id: 'chat-with-text', label: '和 AI 聊聊', icon: <MessageSquare size={18} /> },
  { id: 'create-document-with-text', label: '添加到文档', icon: <FileText size={18} /> },
  { id: 'ai-organize-to-document', label: 'AI 整理到文档', icon: <Sparkles size={18} /> }
]

declare global {
  interface Window {
    quickPanelApi?: {
      onShow: (cb: (data: { selectedText: string }) => void) => () => void
      executeAction: (action: string, selectedText: string) => void
      hidePanel: () => void
    }
  }
}

export default function QuickPanelApp() {
  const [selectedText, setSelectedText] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items: QuickPanelItem[] =
    selectedText.trim().length > 0 ? [...BASE_ITEMS, ...TEXT_ITEMS] : BASE_ITEMS
  const maxIndex = items.length - 1

  useEffect(() => {
    const api = window.quickPanelApi
    if (!api) return
    const unsubscribe = api.onShow((data) => {
      setSelectedText(data.selectedText ?? '')
      setFocusedIndex(0)
    })
    return unsubscribe
  }, [])

  const runAction = useCallback(
    (action: QuickPanelAction) => {
      window.quickPanelApi?.executeAction(action, selectedText)
    },
    [selectedText]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.quickPanelApi?.hidePanel()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((i) => (i >= maxIndex ? 0 : i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((i) => (i <= 0 ? maxIndex : i - 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[focusedIndex]
        if (item) runAction(item.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, focusedIndex, maxIndex, runAction])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const child = el.children[focusedIndex] as HTMLElement | undefined
    child?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex])

  return (
    <div
      className="quickpanel-root"
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'rgba(22, 22, 28, 0.92)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
        minWidth: 260,
        maxWidth: 320
      }}
    >
      <div ref={listRef} role="menu" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="quickpanel-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              border: 'none',
              borderRadius: 8,
              background: index === focusedIndex ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: 'rgba(255,255,255,0.92)',
              cursor: 'pointer',
              fontSize: 14,
              textAlign: 'left',
              width: '100%'
            }}
            onMouseEnter={() => setFocusedIndex(index)}
            onClick={() => runAction(item.id)}
          >
            <span style={{ color: 'rgba(255,255,255,0.7)', flexShrink: 0 }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
