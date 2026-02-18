/**
 * 文件/文档/待办 复合工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 * 支持 action 感知图标、更丰富的参数摘要、preparing → running → done 三阶段
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Eye,
  File,
  FilePen,
  FilePlus2,
  FileText,
  FileX,
  FolderOpen,
  LayoutList,
  ListChecks,
  Loader2,
  PenLine,
  Plus,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { memo } from 'react'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'
import type { FileKind } from '../../hooks/useFileList'
import { useWorkNavigation } from '../../context/WorkNavigationContext'

/* ── action → 图标+色 映射 ── */

interface ActionMeta {
  icon: LucideIcon
  color: string
  /** action 级别的 Tag 文本 */
  badge?: string
  badgeColor?: 'blue' | 'green' | 'red' | 'cyan' | 'default'
}

const FILE_ACTIONS: Record<string, ActionMeta> = {
  list: { icon: FolderOpen, color: '#3b82f6' },
  read: { icon: FileText, color: '#3b82f6' },
  write: { icon: FilePen, color: '#8b5cf6', badge: '写入', badgeColor: 'blue' },
  move: { icon: File, color: '#d97706', badge: '移动', badgeColor: 'cyan' },
  delete: { icon: FileX, color: '#ef4444', badge: '删除', badgeColor: 'red' }
}

const DOCUMENT_ACTIONS: Record<string, ActionMeta> = {
  list: { icon: LayoutList, color: '#3b82f6' },
  read: { icon: FileText, color: '#3b82f6' },
  create: { icon: FilePlus2, color: '#10b981', badge: '创建', badgeColor: 'green' },
  update: { icon: FilePen, color: '#8b5cf6', badge: '更新', badgeColor: 'blue' },
  delete: { icon: FileX, color: '#ef4444', badge: '删除', badgeColor: 'red' }
}

const TODO_ACTIONS: Record<string, ActionMeta> = {
  list_items: { icon: ListChecks, color: '#10b981' },
  list_lists: { icon: ClipboardList, color: '#10b981' },
  read: { icon: Eye, color: '#10b981' },
  create: { icon: Plus, color: '#10b981', badge: '创建', badgeColor: 'green' },
  update: { icon: PenLine, color: '#6366f1', badge: '更新', badgeColor: 'blue' },
  delete: { icon: Trash2, color: '#ef4444', badge: '删除', badgeColor: 'red' }
}

const ACTION_MAPS: Record<string, Record<string, ActionMeta>> = {
  prizm_file: FILE_ACTIONS,
  prizm_document: DOCUMENT_ACTIONS,
  prizm_todo: TODO_ACTIONS
}

const DEFAULT_META: Record<string, { icon: LucideIcon; color: string }> = {
  prizm_file: { icon: FileText, color: '#3b82f6' },
  prizm_document: { icon: FileText, color: '#3b82f6' },
  prizm_todo: { icon: CheckSquare, color: '#10b981' }
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function getActionMeta(toolName: string, argsStr: string): ActionMeta & { actionKey: string } {
  const map = ACTION_MAPS[toolName]
  if (!map) {
    const d = DEFAULT_META[toolName] ?? { icon: FileText, color: '#3b82f6' }
    return { ...d, actionKey: '' }
  }
  const args = parseArgs(argsStr)
  const action = String(args.action ?? '')
  const meta = map[action]
  if (meta) return { ...meta, actionKey: action }
  const d = DEFAULT_META[toolName] ?? { icon: FileText, color: '#3b82f6' }
  return { ...d, actionKey: action }
}

/* ── 参数摘要（action 感知） ── */
function buildArgsSummary(toolName: string, argsStr: string): string {
  const obj = parseArgs(argsStr)
  const action = String(obj.action ?? '')

  if (toolName === 'prizm_file') {
    if (action === 'move' && obj.from && obj.to)
      return `${String(obj.from).slice(0, 20)} → ${String(obj.to).slice(0, 20)}`
    if (obj.path) return String(obj.path).slice(0, 50)
    if (action === 'write' && obj.content) return String(obj.content).slice(0, 40) + '…'
    return ''
  }

  if (toolName === 'prizm_document') {
    if (obj.title) return String(obj.title).slice(0, 40)
    if (obj.documentId) return `ID: ${String(obj.documentId).slice(0, 16)}`
    if (obj.folder) return `📁 ${String(obj.folder)}`
    return ''
  }

  if (toolName === 'prizm_todo') {
    if (obj.title) return String(obj.title).slice(0, 40)
    if (obj.todoId) return `ID: ${String(obj.todoId).slice(0, 16)}`
    if (action === 'update' && obj.status) return `→ ${String(obj.status)}`
    return ''
  }

  return ''
}

/* ── 从参数/result 解析文件引用（用于「打开」按钮） ── */
function parseFileRef(
  toolName: string,
  argsStr: string,
  resultStr?: string
): { kind: FileKind; id: string } | null {
  const obj = parseArgs(argsStr)
  const action = String(obj.action ?? '')

  if (toolName === 'prizm_document') {
    if (obj.documentId && typeof obj.documentId === 'string')
      return { kind: 'document', id: obj.documentId }
    if (resultStr) {
      const m = resultStr.match(/已创建文档\s+(\S+)/)
      if (m?.[1]) return { kind: 'document', id: m[1] }
    }
  }

  if (toolName === 'prizm_todo') {
    if (obj.todoListId && typeof obj.todoListId === 'string')
      return { kind: 'todoList', id: obj.todoListId }
    if (obj.listId && typeof obj.listId === 'string') return { kind: 'todoList', id: obj.listId }
  }

  return null
}

/* ── Done 状态的展开/折叠卡片 ── */
function FileToolCardDone({
  tc,
  displayName,
  meta,
  argsSummary,
  fileRef,
  onOpenFile
}: {
  tc: ToolCallRecord
  displayName: string
  meta: ActionMeta & { actionKey: string }
  argsSummary: string
  fileRef: { kind: FileKind; id: string } | null
  onOpenFile: (kind: FileKind, id: string) => void
}) {
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const isError = !!tc.isError
  const accentColor = isError ? 'var(--ant-color-error)' : meta.color

  return (
    <div className={`tool-card${isError ? ' tool-card--error' : ''}`} data-status="done">
      <div className="tool-card__indicator" style={{ background: accentColor }} />
      <div
        className="tool-card__header"
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
      >
        <Flexbox gap={8} horizontal align="center" style={{ width: '100%' }}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={isError ? AlertCircle : meta.icon} size={15} />
          </div>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              {isError && (
                <Tag size="small" color="error">
                  失败
                </Tag>
              )}
              {!isError && meta.badge && (
                <Tag size="small" color={meta.badgeColor ?? 'default'}>
                  {meta.badge}
                </Tag>
              )}
            </Flexbox>
            {argsSummary && <span className="tool-card__desc">{argsSummary}</span>}
          </Flexbox>
          {fileRef && !isError && (
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

/* ── 主组件 ── */
const PrizmFileToolCard = memo(
  function PrizmFileToolCard({ tc }: { tc: ToolCallRecord }) {
    const status = tc.status ?? 'done'
    const displayName = getToolDisplayName(tc.name, tc.arguments)
    const meta = getActionMeta(tc.name, tc.arguments)
    const argsSummary = buildArgsSummary(tc.name, tc.arguments)
    const { openFileAtWork } = useWorkNavigation()
    const fileRef =
      status === 'done' && !tc.isError ? parseFileRef(tc.name, tc.arguments, tc.result) : null

    if (status === 'preparing') {
      return (
        <div className="tool-card" data-status="preparing">
          <div className="tool-card__indicator" style={{ background: meta.color }} />
          <Flexbox gap={8} horizontal align="center" style={{ padding: '10px 14px' }}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': meta.color } as never}>
              <Icon icon={meta.icon} size={15} />
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
          <div className="tool-card__indicator" style={{ background: meta.color }} />
          <Flexbox gap={8} horizontal align="center" style={{ padding: '10px 14px' }}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': meta.color } as never}>
              <Icon icon={meta.icon} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <Flexbox horizontal align="center" gap={6}>
                <span className="tool-card__name">{displayName}</span>
                {meta.badge && (
                  <Tag size="small" color={meta.badgeColor ?? 'default'}>
                    {meta.badge}
                  </Tag>
                )}
              </Flexbox>
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
        meta={meta}
        argsSummary={argsSummary}
        fileRef={fileRef}
        onOpenFile={openFileAtWork}
      />
    )
  },
  (prev, next) => {
    const a = prev.tc,
      b = next.tc
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

/* ── 注册 ── */
const FILE_RELATED_TOOLS = [
  'prizm_file',
  'prizm_document',
  'prizm_todo',
  // 旧工具名兼容
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

for (const name of FILE_RELATED_TOOLS) {
  registerToolRender(name, (props) => <PrizmFileToolCard tc={props.tc} />)
}
