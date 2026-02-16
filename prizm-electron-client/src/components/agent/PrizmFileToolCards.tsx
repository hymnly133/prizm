/**
 * 文件相关 Prizm 工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 * 完成状态卡片提供明确的「打开」按钮，支持 preparing → running → done 三阶段
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  File,
  FilePen,
  FileText,
  FileX,
  FolderOpen,
  Loader2,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, getToolMetadata, registerToolRender } from '@prizm/client-core'
import type { FileKind } from '../../hooks/useFileList'
import { useWorkNavigation } from '../../context/WorkNavigationContext'

/* ── 分类图标/色（与 ToolCallCard 的全局映射一致） ── */
const KIND_META: Record<string, { icon: LucideIcon; color: string }> = {
  file: { icon: FileText, color: '#3b82f6' },
  document: { icon: FileText, color: '#3b82f6' },
  todo: { icon: CheckSquare, color: '#10b981' }
}

/* ── 文件工具专属图标（按操作类型） ── */
const FILE_TOOL_ICONS: Record<string, LucideIcon> = {
  prizm_file_list: FolderOpen,
  prizm_file_read: FileText,
  prizm_file_write: FilePen,
  prizm_file_move: File,
  prizm_file_delete: FileX
}

function getIconAndColor(toolName: string): { icon: LucideIcon; color: string } {
  if (FILE_TOOL_ICONS[toolName])
    return { icon: FILE_TOOL_ICONS[toolName], color: KIND_META.file.color }
  const meta = getToolMetadata(toolName)
  if (meta?.category && KIND_META[meta.category]) return KIND_META[meta.category]
  return { icon: FileText, color: '#3b82f6' }
}

/* ── 从参数提取摘要 ── */
function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
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

/* ── 从参数（或 result）解析文件引用（document/todoList 可打开预览，file 工具用 path 暂无打开） ── */
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

/* ── Done 状态的展开/折叠卡片 ── */
function FileToolCardDone({
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
            <Icon icon={isError ? AlertCircle : CategoryIcon} size={15} />
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

/* ── 主组件：文件工具自定义卡片 ── */
function PrizmFileToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const { icon: CategoryIcon, color: accentColor } = getIconAndColor(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)
  const isError = !!tc.isError
  const { openFileAtWork } = useWorkNavigation()
  const fileRef = status === 'done' && !isError ? parseFileRef(tc.arguments, tc.result) : null

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

  return (
    <FileToolCardDone
      tc={tc}
      displayName={displayName}
      CategoryIcon={CategoryIcon}
      accentColor={isError ? 'var(--ant-color-error)' : accentColor}
      argsSummary={argsSummary}
      isError={isError}
      fileRef={fileRef}
      onOpenFile={openFileAtWork}
    />
  )
}

/* ── 注册：这些文件相关工具使用自定义卡片 ── */
const FILE_RELATED_PRIZM_TOOLS = [
  'prizm_create_document',
  'prizm_get_document_content',
  'prizm_update_document',
  'prizm_delete_document',
  'prizm_read_note',
  'prizm_get_note',
  'prizm_update_note',
  'prizm_delete_note',
  'prizm_read_todo',
  'prizm_update_todo',
  'prizm_delete_todo',
  'prizm_update_todo_list'
] as const

for (const name of FILE_RELATED_PRIZM_TOOLS) {
  registerToolRender(name, (props) => <PrizmFileToolCard tc={props.tc} />)
}
