/**
 * 引用标签栏：在输入框上方显示当前附加的引用，支持移除
 * 支持所有 ResourceType 资源类型的图标与配色
 */
import { createClientLogger } from '@prizm/client-core'
import { memo, useCallback, useEffect } from 'react'

const log = createClientLogger('ChatInput')
import {
  X,
  FileText,
  StickyNote,
  CheckSquare,
  File,
  Code2,
  Blocks,
  GitBranch,
  Zap,
  MessageSquare,
  Calendar,
  Clock,
  Brain
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useChatInputStore } from './store'
import type { InputRef } from './store/initialState'

interface ChipStyle {
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

const BUILTIN_STYLES: Record<string, ChipStyle> = {
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
    icon: CheckSquare,
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
  },
  workflow: {
    icon: Blocks,
    color: '#722ed1',
    bg: '#f9f0ff',
    border: '#d3adf7'
  },
  run: {
    icon: GitBranch,
    color: '#13c2c2',
    bg: '#e6fffb',
    border: '#87e8de'
  },
  task: {
    icon: Zap,
    color: 'var(--ant-color-success-text, #389e0d)',
    bg: 'var(--ant-color-success-bg, #f6ffed)',
    border: 'var(--ant-color-success-border, #b7eb8f)'
  },
  session: {
    icon: MessageSquare,
    color: '#8c8c8c',
    bg: '#fafafa',
    border: '#d9d9d9'
  },
  schedule: {
    icon: Calendar,
    color: '#eb2f96',
    bg: '#fff0f6',
    border: '#ffadd2'
  },
  cron: {
    icon: Clock,
    color: '#fa8c16',
    bg: '#fff7e6',
    border: '#ffd591'
  },
  memory: {
    icon: Brain,
    color: '#722ed1',
    bg: '#f9f0ff',
    border: '#d3adf7'
  }
}

const DEFAULT_STYLE: ChipStyle = {
  icon: FileText,
  color: 'var(--ant-color-text-secondary)',
  bg: 'var(--ant-color-fill-quaternary, #fafafa)',
  border: 'var(--ant-color-border, #d9d9d9)'
}

function getChipStyle(type: string): ChipStyle {
  return BUILTIN_STYLES[type] ?? DEFAULT_STYLE
}

const RefChip = memo<{ ref_: InputRef; onRemove: (key: string) => void }>(({ ref_, onRemove }) => {
  const cfg = getChipStyle(ref_.type)
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
      className="ref-chip"
      title={ref_.type === 'file' ? ref_.key : `${ref_.type}:${ref_.key}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: '18px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        maxWidth: 240,
        whiteSpace: 'nowrap',
        transition: 'opacity 150ms ease, transform 150ms ease'
      }}
    >
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref_.label}</span>
      <button
        className="ref-chip__close"
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
          opacity: 0.5,
          flexShrink: 0,
          borderRadius: 3,
          transition: 'opacity 150ms ease, background-color 150ms ease'
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.opacity = '1'
          el.style.backgroundColor = 'rgba(0,0,0,0.06)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.opacity = '0.5'
          el.style.backgroundColor = 'transparent'
        }}
      >
        <X size={11} />
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
