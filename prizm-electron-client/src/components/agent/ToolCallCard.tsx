/**
 * 工具卡片 - 按工具类别展示不同外观
 * 内置工具有分类图标与彩色指示条；文件相关工具有明确的「打开」按钮
 * 支持 preparing → running → done 三阶段，preparing/running 阶段即时渲染
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  Brain,
  CheckSquare,
  Clipboard,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  Search,
  Wrench,
  Bell,
  ChevronDown,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, getToolMetadata, getToolRender, isPrizmTool } from '@prizm/client-core'
import type { FileKind } from '../../hooks/useFileList'
import { useWorkNavigation } from '../../context/WorkNavigationContext'

export interface ToolCallCardProps {
  tc: ToolCallRecord
}

/* ── 工具分类 → 图标 ── */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  file: FolderOpen,
  document: FileText,
  todo: CheckSquare,
  clipboard: Clipboard,
  search: Search,
  notice: Bell,
  memory: Brain,
  external: Globe
}

/* ── 工具分类 → 强调色 ── */
const CATEGORY_COLORS: Record<string, string> = {
  file: '#3b82f6',
  document: '#3b82f6',
  todo: '#10b981',
  clipboard: '#8b5cf6',
  search: '#6366f1',
  notice: '#ec4899',
  memory: '#14b8a6',
  external: '#f97316'
}

function getCategoryIcon(toolName: string): LucideIcon {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_ICONS[meta.category]) return CATEGORY_ICONS[meta.category]
  if (toolName === 'tavily_web_search') return Globe
  if (isPrizmTool(toolName)) return FileText
  return Wrench
}

function getCategoryColor(toolName: string): string {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_COLORS[meta.category]) return CATEGORY_COLORS[meta.category]
  if (toolName === 'tavily_web_search') return '#f97316'
  return '#94a3b8'
}

/* ── 可打开预览的文件相关工具（document/todo 有 id，file 工具用 path 暂无） ── */
const FILE_TOOLS = new Set([
  'prizm_create_document',
  'prizm_get_document_content',
  'prizm_update_document',
  'prizm_delete_document',
  'prizm_read_todo',
  'prizm_update_todo',
  'prizm_delete_todo',
  'prizm_update_todo_list'
])

/* ── 从参数（或 result）解析文件引用 ── */
function parseFileRef(argsStr: string, resultStr?: string): { kind: FileKind; id: string } | null {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (obj.documentId && typeof obj.documentId === 'string')
      return { kind: 'document', id: obj.documentId }
    if (obj.todoListId && typeof obj.todoListId === 'string')
      return { kind: 'todoList', id: obj.todoListId }
  } catch {
    /* ignore */
  }
  if (resultStr) {
    const docMatch = resultStr.match(/已创建文档\s+(\S+)/)
    if (docMatch?.[1]) return { kind: 'document', id: docMatch[1] }
  }
  return null
}

/* ── 从参数提取摘要 ── */
function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (obj.query) return `搜索: ${String(obj.query).slice(0, 30)}`
    if (obj.path) return String(obj.path).slice(0, 40)
    if (obj.from && obj.to) return `${String(obj.from).slice(0, 20)} → ${String(obj.to).slice(0, 20)}`
    if (obj.title) return String(obj.title).slice(0, 30)
    if (obj.content) return String(obj.content).slice(0, 40)
    if (obj.documentId) return `文档 ${String(obj.documentId).slice(0, 12)}…`
    if (obj.todoId) return `待办 ${String(obj.todoId).slice(0, 12)}…`
    if (obj.todoListId) return `待办列表 ${String(obj.todoListId).slice(0, 12)}…`
    return ''
  } catch {
    return ''
  }
}

export function ToolCallCard({ tc }: ToolCallCardProps) {
  /* 外部注册的自定义渲染器优先（MCP 扩展等） */
  const customRender = getToolRender(tc.name)
  if (customRender) return <>{customRender({ tc })}</>

  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const CategoryIcon = getCategoryIcon(tc.name)
  const accentColor = getCategoryColor(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)
  const isError = !!tc.isError
  const { openFileAtWork } = useWorkNavigation()

  const isFileRelated = FILE_TOOLS.has(tc.name)
  const fileRef =
    isFileRelated && status === 'done' && !isError ? parseFileRef(tc.arguments, tc.result) : null

  /* ── preparing: LLM 刚决定调用此工具 ── */
  if (status === 'preparing') {
    return (
      <div className="tool-card" data-status="preparing">
        <div className="tool-card__indicator" style={{ background: accentColor }} />
        <Flexbox gap={8} horizontal align="center" style={{ padding: '10px 14px' }}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={CategoryIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2}>
            <span className="tool-card__name">{displayName}</span>
            <span className="tool-card__status-text">准备调用…</span>
          </Flexbox>
          <Loader2 size={14} className="tool-card__spinner" />
        </Flexbox>
      </div>
    )
  }

  /* ── running: 工具正在执行 ── */
  if (status === 'running') {
    return (
      <div className="tool-card" data-status="running">
        <div className="tool-card__indicator" style={{ background: accentColor }} />
        <Flexbox gap={8} horizontal align="center" style={{ padding: '10px 14px' }}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={CategoryIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2}>
            <span className="tool-card__name">{displayName}</span>
            {argsSummary && <span className="tool-card__desc">{argsSummary}</span>}
            <span className="tool-card__status-text">执行中…</span>
          </Flexbox>
          <Loader2 size={14} className="tool-card__spinner" />
        </Flexbox>
      </div>
    )
  }

  /* ── done: 可展开/折叠的完成卡片 ── */
  return (
    <ToolCardDone
      tc={tc}
      displayName={displayName}
      CategoryIcon={isError ? AlertCircle : CategoryIcon}
      accentColor={isError ? 'var(--ant-color-error)' : accentColor}
      argsSummary={argsSummary}
      isError={isError}
      fileRef={fileRef}
      onOpenFile={openFileAtWork}
    />
  )
}

/* ── Done 状态的卡片，独立组件以维护 expanded state ── */
function ToolCardDone({
  tc,
  displayName,
  CategoryIcon,
  accentColor,
  argsSummary,
  isError,
  fileRef,
  onOpenFile
}: {
  tc: ToolCallRecord
  displayName: string
  CategoryIcon: LucideIcon
  accentColor: string
  argsSummary: string
  isError: boolean
  fileRef: { kind: FileKind; id: string } | null
  onOpenFile: (kind: FileKind, id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`tool-card${isError ? ' tool-card--error' : ''}`} data-status="done">
      <div className="tool-card__indicator" style={{ background: accentColor }} />
      {/* 头部：点击展开/折叠 */}
      <div
        className="tool-card__header"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
        <Flexbox gap={8} horizontal align="center" style={{ width: '100%' }}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={CategoryIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              {isError && (
                <Tag size="small" color="error">
                  失败
                </Tag>
              )}
            </Flexbox>
            {argsSummary && <span className="tool-card__desc">{argsSummary}</span>}
          </Flexbox>
          {fileRef && (
            <button
              className="tool-card__open-btn"
              title="打开预览"
              onClick={(e) => {
                e.stopPropagation()
                onOpenFile(fileRef.kind, fileRef.id)
              }}
            >
              <ExternalLink size={12} />
              <span>打开</span>
            </button>
          )}
          <ChevronDown
            size={14}
            className={`tool-card__chevron${expanded ? ' tool-card__chevron--open' : ''}`}
          />
        </Flexbox>
      </div>
      {/* 展开内容 */}
      {expanded && (
        <div className="tool-card__body">
          {tc.arguments && tc.arguments !== '{}' && (
            <div>
              <div className="tool-card__section-label">参数</div>
              <pre className="tool-card__pre">{tc.arguments}</pre>
            </div>
          )}
          <div>
            <div className="tool-card__section-label">{isError ? '错误信息' : '结果'}</div>
            <pre className={`tool-card__pre${isError ? ' tool-card__pre--error' : ''}`}>
              {tc.result || '(无返回)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
