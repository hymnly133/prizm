/**
 * 引用标签栏：在输入框上方显示当前附加的引用，支持移除
 */
import { createClientLogger } from '@prizm/client-core'
import { memo, useCallback, useEffect } from 'react'

const log = createClientLogger('ChatInput')
import { X, FileText, StickyNote, ListTodo, File, Code2 } from 'lucide-react'
import { useChatInputStore } from './store'
import type { InputRef } from './store/initialState'

const typeConfig: Record<
  InputRef['type'],
  { icon: typeof FileText; color: string; bg: string; border: string }
> = {
  doc: {
    icon: FileText,
    color: 'var(--ant-color-primary, #1677ff)',
    bg: 'var(--ant-color-primary-bg, #e6f4ff)',
    border: 'var(--ant-color-primary-border, #91caff)'
  },
  note: {
    icon: StickyNote,
    color: 'var(--ant-color-success-text, #389e0d)',
    bg: 'var(--ant-color-success-bg, #f6ffed)',
    border: 'var(--ant-color-success-border, #b7eb8f)'
  },
  todo: {
    icon: ListTodo,
    color: 'var(--ant-color-info-text, #0958d9)',
    bg: 'var(--ant-color-info-bg, #e6f4ff)',
    border: 'var(--ant-color-info-border, #91caff)'
  },
  file: {
    icon: File,
    color: 'var(--ant-color-warning-text, #d46b08)',
    bg: 'var(--ant-color-warning-bg, #fff7e6)',
    border: 'var(--ant-color-warning-border, #ffd591)'
  },
  snippet: {
    icon: Code2,
    color: 'var(--prizm-snippet-color, #722ed1)',
    bg: 'var(--prizm-snippet-bg, #f9f0ff)',
    border: 'var(--prizm-snippet-border, #d3adf7)'
  }
}

const RefChip = memo<{ ref_: InputRef; onRemove: (key: string) => void }>(({ ref_, onRemove }) => {
  const cfg = typeConfig[ref_.type]
  const Icon = cfg.icon
  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove(ref_.key)
    },
    [onRemove, ref_.key]
  )
  return (
    <span
      title={ref_.type === 'file' ? ref_.key : `${ref_.type}:${ref_.key}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '18px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        maxWidth: 220,
        whiteSpace: 'nowrap'
      }}
    >
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref_.label}</span>
      <button
        onClick={handleRemove}
        title="移除引用"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          opacity: 0.6,
          flexShrink: 0
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.6'
        }}
      >
        <X size={12} />
      </button>
    </span>
  )
})
RefChip.displayName = 'RefChip'

const RefChipsBar = memo(() => {
  const inputRefs = useChatInputStore((s) => s.inputRefs)
  const removeInputRef = useChatInputStore((s) => s.removeInputRef)

  useEffect(() => {
    if (inputRefs.length > 0) {
      log.debug('RefChipsBar refs updated:', inputRefs.length)
    }
  }, [inputRefs])

  if (inputRefs.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '6px 12px 2px',
        minHeight: 0
      }}
    >
      {inputRefs.map((ref) => (
        <RefChip key={`${ref.type}:${ref.key}`} ref_={ref} onRemove={removeInputRef} />
      ))}
    </div>
  )
})

RefChipsBar.displayName = 'RefChipsBar'

export default RefChipsBar
