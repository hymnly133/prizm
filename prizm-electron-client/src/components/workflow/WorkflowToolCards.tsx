/**
 * 工作流工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 *
 * 覆盖工具：prizm_workflow
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ChevronDown,
  GitBranch,
  Loader2,
  Play,
  RotateCcw,
  List,
  Info,
  XCircle,
  Save,
  type LucideIcon
} from 'lucide-react'
import { memo, useMemo } from 'react'
import { createStyles } from 'antd-style'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from '../agent/useToolCardExpanded'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'
import { MiniPipelineView } from './WorkflowPipelineView'
import type { WorkflowStepResult } from '@prizm/shared'

const ACCENT_COLOR = '#6366f1'

const useStyles = createStyles(({ css }) => ({
  cardPadding: css`
    padding: 10px 14px;
  `,
  fullWidth: css`
    width: 100%;
  `,
  noShrink: css`
    min-width: 0;
  `
}))

const ACTION_DISPLAY: Record<string, { icon: LucideIcon; label: string }> = {
  run: { icon: Play, label: '执行工作流' },
  resume: { icon: RotateCcw, label: '恢复工作流' },
  list: { icon: List, label: '列出运行记录' },
  status: { icon: Info, label: '查看运行详情' },
  cancel: { icon: XCircle, label: '取消工作流' },
  register: { icon: Save, label: '注册工作流' },
  list_defs: { icon: List, label: '列出工作流定义' },
  get_def: { icon: Info, label: '查看工作流定义' }
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try { return JSON.parse(argsStr || '{}') } catch { return {} }
}

function parseResult(resultStr: string): Record<string, unknown> {
  try { return JSON.parse(resultStr || '{}') } catch { return {} }
}

function getSummary(action: string, args: Record<string, unknown>): string {
  switch (action) {
    case 'run': {
      const name = (args.workflow_name as string) ?? ''
      return name ? `运行 "${name}"` : '运行内联工作流'
    }
    case 'resume':
      return `恢复 (${args.approved !== false ? '批准' : '拒绝'})`
    case 'status':
      return `查看 ${((args.run_id as string) ?? '').slice(0, 8)}…`
    case 'cancel':
      return `取消 ${((args.run_id as string) ?? '').slice(0, 8)}…`
    case 'register':
      return `注册 "${(args.workflow_name as string) ?? ''}"`
    default:
      return action
  }
}

function WorkflowToolCardDone({
  tc,
  isError
}: {
  tc: ToolCallRecord
  isError: boolean
}) {
  const { styles } = useStyles()
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const args = parseArgs(tc.arguments)
  const result = parseResult(tc.result)
  const action = (args.action as string) ?? 'run'
  const info = ACTION_DISPLAY[action] ?? ACTION_DISPLAY.run
  const summary = getSummary(action, args)
  const accentColor = isError ? 'var(--ant-color-error)' : ACCENT_COLOR

  const miniPipeline = useMemo(() => {
    if (action !== 'run' && action !== 'status') return null
    const stepResults = (result.stepResults ?? result.step_results) as Record<string, WorkflowStepResult> | undefined
    if (!stepResults || typeof stepResults !== 'object' || Object.keys(stepResults).length === 0) return null
    return <MiniPipelineView stepResults={stepResults} />
  }, [action, result])

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
            <Icon icon={isError ? AlertCircle : info.icon} size={15} />
          </div>
          <Flexbox flex={1} gap={2} className={styles.noShrink}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{info.label}</span>
              {isError && <Tag size="small" color="error">失败</Tag>}
              {typeof result.status === 'string' && (
                <Tag
                  size="small"
                  color={
                    result.status === 'completed' ? 'success'
                    : result.status === 'paused' ? 'warning'
                    : result.status === 'failed' ? 'error'
                    : 'default'
                  }
                >
                  {result.status}
                </Tag>
              )}
            </Flexbox>
            <span className="tool-card__desc">{summary}</span>
            {miniPipeline}
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
    const args = parseArgs(tc.arguments)
    const action = (args.action as string) ?? 'run'
    const info = ACTION_DISPLAY[action] ?? ACTION_DISPLAY.run
    const isError = !!tc.isError

    if (status === 'preparing') {
      return (
        <div className="tool-card" data-status="preparing">
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
              <Icon icon={GitBranch} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <span className="tool-card__name">{info.label}</span>
              <span className="tool-card__status-text">准备调用…</span>
            </Flexbox>
            <Loader2 size={14} className="tool-card__spinner" />
          </Flexbox>
        </div>
      )
    }

    if (status === 'running') {
      const summary = getSummary(action, args)
      return (
        <div className="tool-card" data-status="running">
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
              <Icon icon={GitBranch} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <span className="tool-card__name">{info.label}</span>
              {summary && <span className="tool-card__desc">{summary}</span>}
              <span className="tool-card__status-text">执行中…</span>
            </Flexbox>
            <Loader2 size={14} className="tool-card__spinner" />
          </Flexbox>
        </div>
      )
    }

    return <WorkflowToolCardDone tc={tc} isError={isError} />
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
