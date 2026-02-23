/**
 * ToolCallBadge — 精简模式的工具调用展示组件
 *
 * 紧凑的 inline badge，hover 显示参数摘要 Tooltip，click 弹出 Popover 查看完整结果。
 * 仅用于 done 状态且非错误的工具调用，preparing/running/error 始终走详细模式。
 */
import { memo, useState, useCallback } from 'react'
import { Popover, Tooltip } from 'antd'
import { Icon } from '@lobehub/ui'
import { Copy, Check, type LucideIcon } from 'lucide-react'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, getToolMetadata, isPrizmTool } from '@prizm/client-core'
import {
  BookOpen,
  Brain,
  CheckSquare,
  Clipboard,
  FileText,
  FolderOpen,
  Globe,
  Lock,
  Search,
  Terminal,
  Bell,
  Wrench
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  file: FolderOpen,
  document: FileText,
  todo: CheckSquare,
  clipboard: Clipboard,
  search: Search,
  notice: Bell,
  memory: Brain,
  knowledge: BookOpen,
  lock: Lock,
  terminal: Terminal,
  external: Globe,
  other: Wrench
}

const CATEGORY_COLORS: Record<string, string> = {
  file: '#3b82f6',
  document: '#3b82f6',
  todo: '#10b981',
  clipboard: '#8b5cf6',
  search: '#6366f1',
  notice: '#ec4899',
  memory: '#14b8a6',
  knowledge: '#0891b2',
  lock: '#d97706',
  terminal: '#64748b',
  external: '#f97316',
  other: '#0d9488'
}

function getCategoryIcon(toolName: string): LucideIcon {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_ICONS[meta.category]) return CATEGORY_ICONS[meta.category]
  if (toolName === 'prizm_web_search' || toolName === 'prizm_web_fetch' || toolName === 'tavily_web_search') return Globe
  if (isPrizmTool(toolName)) return FileText
  return Wrench
}

function getCategoryColor(toolName: string): string {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_COLORS[meta.category]) return CATEGORY_COLORS[meta.category]
  if (toolName === 'prizm_web_search' || toolName === 'prizm_web_fetch' || toolName === 'tavily_web_search') return '#f97316'
  return '#94a3b8'
}

function parseActionBadge(tc: ToolCallRecord): string | null {
  try {
    const obj = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
    const action = String(obj.action ?? obj.mode ?? '')
    const meta = getToolMetadata(tc.name)
    if (action && meta?.actionLabels?.[action]) return meta.actionLabels[action]
    return null
  } catch {
    return null
  }
}

function parseArgsSummary(argsStr: string, toolName?: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (toolName === 'prizm_browser') {
      const action = String(obj.action ?? '')
      const url = obj.url != null ? String(obj.url).slice(0, 48) : ''
      const instruction = obj.instruction != null ? String(obj.instruction).slice(0, 40) : ''
      if (url) return url
      if (instruction) return instruction
      return action || ''
    }
    if (obj.query) return String(obj.query).slice(0, 40)
    if (obj.command) return `$ ${String(obj.command).slice(0, 50)}`
    if (obj.path) return String(obj.path).slice(0, 50)
    if (obj.title) return String(obj.title).slice(0, 40)
    if (obj.task) return String(obj.task).slice(0, 40)
    if (obj.name) return String(obj.name).slice(0, 40)
    if (obj.documentId) return `文档 ${String(obj.documentId).slice(0, 12)}`
    return ''
  } catch {
    return ''
  }
}

function formatResult(result: string): string {
  try {
    const parsed = JSON.parse(result)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return result
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button className="tool-card__copy-btn" style={{ opacity: 1 }} onClick={handleCopy} title="复制">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function BadgePopoverContent({ tc }: { tc: ToolCallRecord }) {
  const formatted = formatResult(tc.result || '')
  const isError = !!tc.isError
  return (
    <div className="tool-badge-popover">
      {tc.arguments && tc.arguments !== '{}' && (
        <div className="tool-badge-popover__section">
          <div className="tool-badge-popover__label">参数</div>
          <pre className="tool-badge-popover__pre">{formatResult(tc.arguments)}</pre>
        </div>
      )}
      <div className="tool-badge-popover__section" style={{ position: 'relative' }}>
        <div className="tool-badge-popover__label">{isError ? '错误信息' : '结果'}</div>
        <div style={{ position: 'relative' }}>
          <pre
            className={`tool-badge-popover__pre${isError ? ' tool-badge-popover__pre--error' : ''}`}
          >
            {formatted || '(无返回)'}
          </pre>
          {formatted && <CopyButton text={tc.result || ''} />}
        </div>
      </div>
    </div>
  )
}

export interface ToolCallBadgeProps {
  tc: ToolCallRecord
}

export const ToolCallBadge = memo(
  function ToolCallBadge({ tc }: ToolCallBadgeProps) {
    const displayName = getToolDisplayName(tc.name, tc.arguments)
    const CategoryIcon = getCategoryIcon(tc.name)
    const accentColor = getCategoryColor(tc.name)
    const actionBadge = parseActionBadge(tc)
    const argsSummary = parseArgsSummary(tc.arguments, tc.name)
    const isError = !!tc.isError

    return (
      <Popover
        content={<BadgePopoverContent tc={tc} />}
        trigger="click"
        placement="bottomLeft"
        arrow={false}
        overlayStyle={{ maxWidth: 440 }}
      >
        <Tooltip title={argsSummary || displayName} placement="top" mouseEnterDelay={0.4}>
          <span className={`tool-badge${isError ? ' tool-badge--error' : ''}`}>
            <span
              className="tool-badge__dot"
              style={{ background: isError ? 'var(--ant-color-error)' : accentColor }}
            />
            <span className="tool-badge__icon">
              <Icon icon={CategoryIcon} size={12} />
            </span>
            <span className="tool-badge__name">{displayName}</span>
            {actionBadge && !isError && (
              <span
                className="tool-badge__tag"
                style={{
                  background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                  color: accentColor
                }}
              >
                {actionBadge}
              </span>
            )}
          </span>
        </Tooltip>
      </Popover>
    )
  },
  (prev, next) => {
    const a = prev.tc, b = next.tc
    return (
      a.id === b.id &&
      a.name === b.name &&
      a.arguments === b.arguments &&
      a.result === b.result &&
      a.status === b.status &&
      a.isError === b.isError
    )
  }
)
