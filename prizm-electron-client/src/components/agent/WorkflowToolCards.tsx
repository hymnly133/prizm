/**
 * Workflow tool custom card renderer.
 * Registers via registerToolRender for prizm_workflow tool calls.
 *
 * Shows workflow name, action type, step progress, and a "View Workflow"
 * button that opens the right panel via CollabInteraction.
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  GitBranch,
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

const ACCENT_COLOR = '#8b5cf6'

const useStyles = createStyles(({ css }) => ({
  cardPadding: css`padding: 10px 14px;`,
  fullWidth: css`width: 100%;`,
  noShrink: css`min-width: 0;`
}))

const ACTION_LABELS: Record<string, string> = {
  run: '执行工作流',
  resume: '恢复审批',
  list: '列出运行',
  status: '查看详情',
  cancel: '取消运行',
  register: '注册定义',
  list_defs: '列出定义'
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try { return JSON.parse(argsStr || '{}') } catch { return {} }
}

function parseResult(resultStr: string): Record<string, unknown> {
  try { return JSON.parse(resultStr || '{}') } catch { return {} }
}

function extractRunId(args: Record<string, unknown>, resultStr: string): string | null {
  if (typeof args.run_id === 'string' && args.run_id) return args.run_id
  const result = parseResult(resultStr)
  if (typeof result.runId === 'string') return result.runId
  if (typeof result.run_id === 'string') return result.run_id
  return null
}

function getSummary(args: Record<string, unknown>): string {
  const action = (args.action as string) ?? ''
  const wfName = (args.workflow_name as string) ?? ''
  const runId = (args.run_id as string) ?? ''
  const label = ACTION_LABELS[action] ?? action
  if (wfName) return `${label}: ${wfName}`
  if (runId) return `${label} — ${runId.slice(0, 12)}…`
  return label
}

/** Module-level bridge for CollabInteraction */
let _interactionAPI: CollabInteractionAPI | null = null

export function WorkflowToolCardsConnector({ api }: { api: CollabInteractionAPI }) {
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

function ViewWorkflowButton({ args, resultStr }: { args: Record<string, unknown>; resultStr: string }) {
  const runId = extractRunId(args, resultStr)
  const action = (args.action as string) ?? ''
  if (!runId || action === 'list' || action === 'list_defs' || action === 'register' || !_interactionAPI) return null
  return (
    <Button
      size="small"
      type="link"
      icon={<ExternalLink size={11} />}
      onClick={(e) => {
        e.stopPropagation()
        _interactionAPI?.openWorkflow(runId)
      }}
      style={{ padding: '0 4px', height: 22, fontSize: 11 }}
    >
      查看工作流
    </Button>
  )
}

function WorkflowToolCardDone({
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
            <Icon icon={isError ? AlertCircle : GitBranch} size={15} />
          </div>
          <Flexbox flex={1} gap={2} className={styles.noShrink}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              {isError && <Tag size="small" color="error">失败</Tag>}
              <Tag size="small" color="purple">{ACTION_LABELS[action] ?? action}</Tag>
              <ViewWorkflowButton args={args} resultStr={tc.result} />
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

const WorkflowToolCard = memo(
  function WorkflowToolCard({ tc }: { tc: ToolCallRecord }) {
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
              <Icon icon={GitBranch} size={15} />
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

    return <WorkflowToolCardDone tc={tc} displayName={displayName} isError={isError} />
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

registerToolRender('prizm_workflow', (props) => <WorkflowToolCard tc={props.tc} />)
