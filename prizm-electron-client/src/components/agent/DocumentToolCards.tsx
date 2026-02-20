/**
 * Document tool custom card renderer.
 * Registers via registerToolRender for prizm_document tool calls.
 *
 * Shows document title, action type (create/read/update/delete/list),
 * and an "Open Document" button that opens the right panel via CollabInteraction.
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  type LucideIcon
} from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Button } from 'antd'
import { createStyles } from 'antd-style'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'
import type { CollabInteractionAPI } from '../../hooks/useCollabInteraction'

const ACCENT_COLOR = '#3b82f6'

const useStyles = createStyles(({ css }) => ({
  cardPadding: css`padding: 10px 14px;`,
  fullWidth: css`width: 100%;`,
  noShrink: css`min-width: 0;`
}))

const ACTION_LABELS: Record<string, string> = {
  list: '列出文档',
  read: '读取文档',
  create: '创建文档',
  update: '更新文档',
  delete: '删除文档'
}

const ACTION_COLORS: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  read: 'default',
  list: 'default'
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try { return JSON.parse(argsStr || '{}') } catch { return {} }
}

function parseResult(resultStr: string): Record<string, unknown> {
  try { return JSON.parse(resultStr || '{}') } catch { return {} }
}

function extractDocumentId(args: Record<string, unknown>, resultStr: string): string | null {
  if (typeof args.documentId === 'string' && args.documentId) return args.documentId
  const result = parseResult(resultStr)
  if (typeof result.id === 'string') return result.id
  if (typeof result.documentId === 'string') return result.documentId
  return null
}

function getSummary(args: Record<string, unknown>): string {
  const action = (args.action as string) ?? ''
  const title = (args.title as string) ?? ''
  const docId = (args.documentId as string) ?? ''
  const label = ACTION_LABELS[action] ?? action
  if (title) return `${label}: ${title.slice(0, 40)}${title.length > 40 ? '…' : ''}`
  if (docId) return `${label} — ${docId.slice(0, 12)}…`
  return label
}

/** Module-level bridge for CollabInteraction — set by DocumentToolCardsConnector */
let _interactionAPI: CollabInteractionAPI | null = null

export function DocumentToolCardsConnector({ api }: { api: CollabInteractionAPI }) {
  const apiRef = useRef(api)
  apiRef.current = api

  useEffect(() => {
    _interactionAPI = apiRef.current
    return () => { _interactionAPI = null }
  }, [])

  useEffect(() => {
    _interactionAPI = api
  }, [api])

  return null
}

function OpenDocButton({ args, resultStr }: { args: Record<string, unknown>; resultStr: string }) {
  const docId = extractDocumentId(args, resultStr)
  const action = (args.action as string) ?? ''
  if (!docId || action === 'delete' || action === 'list' || !_interactionAPI) return null
  return (
    <Button
      size="small"
      type="link"
      icon={<ExternalLink size={11} />}
      onClick={(e) => {
        e.stopPropagation()
        _interactionAPI?.openDocument(docId)
      }}
      style={{ padding: '0 4px', height: 22, fontSize: 11 }}
    >
      打开文档
    </Button>
  )
}

function DocumentToolCardDone({
  tc,
  displayName,
  isError
}: {
  tc: ToolCallRecord
  displayName: string
  isError: boolean
}) {
  const { styles } = useStyles()
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const args = parseArgs(tc.arguments)
  const action = (args.action as string) ?? ''
  const accentColor = isError ? 'var(--ant-color-error)' : ACCENT_COLOR
  const summary = getSummary(args)
  const tagColor = ACTION_COLORS[action] ?? 'default'

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
        <Flexbox gap={8} horizontal align="center" className={styles.fullWidth}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={isError ? AlertCircle : FileText} size={15} />
          </div>
          <Flexbox flex={1} gap={2} className={styles.noShrink}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              {isError && <Tag size="small" color="error">失败</Tag>}
              <Tag size="small" color={tagColor}>{ACTION_LABELS[action] ?? action}</Tag>
              <OpenDocButton args={args} resultStr={tc.result} />
            </Flexbox>
            {summary && <span className="tool-card__desc">{summary}</span>}
          </Flexbox>
          <ChevronDown
            size={14}
            className={`tool-card__chevron${expanded ? ' tool-card__chevron--open' : ''}`}
          />
        </Flexbox>
      </div>
      {expanded && (
        <div className="tool-card__body">
          <div className="tool-card__section-label">{isError ? '错误信息' : '结果'}</div>
          <pre className={`tool-card__pre${isError ? ' tool-card__pre--error' : ''}`}>
            {tc.result || '(无返回)'}
          </pre>
        </div>
      )}
    </div>
  )
}

const DocumentToolCard = memo(
  function DocumentToolCard({ tc }: { tc: ToolCallRecord }) {
    const { styles } = useStyles()
    const status = tc.status ?? 'done'
    const displayName = getToolDisplayName(tc.name, tc.arguments)
    const isError = !!tc.isError

    if (status === 'preparing' || status === 'running') {
      const args = parseArgs(tc.arguments)
      const summary = status === 'running' ? getSummary(args) : ''
      return (
        <div className="tool-card" data-status={status}>
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
              <Icon icon={FileText} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <span className="tool-card__name">{displayName}</span>
              {summary && <span className="tool-card__desc">{summary}</span>}
              <span className="tool-card__status-text">
                {status === 'preparing' ? '准备调用…' : '执行中…'}
              </span>
            </Flexbox>
            <Loader2 size={14} className="tool-card__spinner" />
          </Flexbox>
        </div>
      )
    }

    return <DocumentToolCardDone tc={tc} displayName={displayName} isError={isError} />
  },
  (prev, next) => {
    const a = prev.tc
    const b = next.tc
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

registerToolRender('prizm_document', (props) => <DocumentToolCard tc={props.tc} />)
