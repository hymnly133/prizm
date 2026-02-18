import { useState, useEffect, useRef, useCallback } from 'react'
import { FilePlus, MessageSquare, FileText, Sparkles, X } from 'lucide-react'

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

export default function QuickPanelApp() {
  const [selectedText, setSelectedText] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const actionableText = selectedText.trim() || clipboardText.trim()
  const items: QuickPanelItem[] =
    actionableText.length > 0 ? [...BASE_ITEMS, ...TEXT_ITEMS] : BASE_ITEMS
  const maxIndex = items.length - 1

  useEffect(() => {
    const api = window.quickPanelApi
    if (!api) return
    // 初始显示：重置全部状态
    const unsubShow = api.onShow((data) => {
      setSelectedText('')
      setClipboardText(data.clipboardText ?? '')
      setFocusedIndex(0)
    })
    // 增量更新：仅补充选中文字，不重置焦点位置
    const unsubUpdate = api.onSelectionUpdate((data) => {
      if (data.selectedText) {
        setSelectedText(data.selectedText)
      }
    })
    return () => {
      unsubShow()
      unsubUpdate()
    }
  }, [])

  const hidePanel = useCallback(() => {
    window.quickPanelApi?.hidePanel()
  }, [])

  const runAction = useCallback(
    (action: QuickPanelAction) => {
      window.quickPanelApi?.executeAction(action, actionableText)
    },
    [actionableText]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hidePanel()
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
  }, [items, focusedIndex, maxIndex, runAction, hidePanel])

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
        width: 280,
        height: 256,
        padding: 10,
        background: '#16161c',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* 标题栏 + 关闭按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          paddingLeft: 4
        }}
      >
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', userSelect: 'none' }}>
          快捷操作
        </span>
        <button
          type="button"
          onClick={hidePanel}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            padding: 0
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'rgba(255,255,255,0.4)'
          }}
          aria-label="关闭面板"
        >
          <X size={14} />
        </button>
      </div>

      {/* 可操作文字预览 */}
      {actionableText.length > 0 && (
        <div
          style={{
            marginBottom: 6,
            padding: '4px 6px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 0,
            flexShrink: 0
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.3)',
              flexShrink: 0,
              userSelect: 'none'
            }}
          >
            {selectedText.trim() ? '选中' : '剪贴板'}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.45)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              userSelect: 'none'
            }}
          >
            {actionableText.length > 60 ? actionableText.slice(0, 60) + '…' : actionableText}
          </span>
        </div>
      )}

      {/* 操作列表 */}
      <div
        ref={listRef}
        role="menu"
        style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}
      >
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
              width: '100%',
              flexShrink: 0
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
