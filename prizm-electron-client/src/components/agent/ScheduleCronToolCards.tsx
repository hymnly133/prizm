/**
 * 日程 / 定时任务 工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 *
 * 覆盖工具：prizm_schedule / prizm_cron
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  Calendar,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  Clock,
  Link2,
  Link2Off,
  Loader2,
  Pause,
  Play,
  ScrollText,
  Timer,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { memo } from 'react'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'

/* ═══════ 通用辅助 ═══════ */

interface ActionStyle {
  icon: LucideIcon
  color: string
  badge?: string
  badgeColor?: 'blue' | 'green' | 'red' | 'cyan' | 'default' | 'purple' | 'warning'
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function propsEq(prev: { tc: ToolCallRecord }, next: { tc: ToolCallRecord }): boolean {
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

/* ═══════ prizm_schedule ═══════ */

const SCHEDULE_ACTIONS: Record<string, ActionStyle> = {
  list: { icon: Calendar, color: '#6366f1' },
  read: { icon: Calendar, color: '#6366f1', badge: '详情', badgeColor: 'default' },
  create: { icon: CalendarPlus, color: '#10b981', badge: '创建', badgeColor: 'green' },
  update: { icon: Calendar, color: '#3b82f6', badge: '更新', badgeColor: 'blue' },
  delete: { icon: CalendarX2, color: '#ef4444', badge: '删除', badgeColor: 'red' },
  link: { icon: Link2, color: '#8b5cf6', badge: '关联', badgeColor: 'purple' },
  unlink: { icon: Link2Off, color: '#8b5cf6', badge: '解除关联', badgeColor: 'purple' }
}

function getScheduleMeta(argsStr: string): ActionStyle {
  const action = String(parseArgs(argsStr).action ?? '')
  return SCHEDULE_ACTIONS[action] ?? { icon: Calendar, color: '#6366f1' }
}

function getScheduleSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.title) return String(obj.title).slice(0, 40)
  if (obj.scheduleId) return `ID: ${String(obj.scheduleId).slice(0, 16)}`
  if (obj.from && obj.to) return `${String(obj.from).slice(0, 10)} ~ ${String(obj.to).slice(0, 10)}`
  return ''
}

/* ═══════ prizm_cron ═══════ */

const CRON_ACTIONS: Record<string, ActionStyle> = {
  list: { icon: Clock, color: '#6366f1' },
  create: { icon: Timer, color: '#10b981', badge: '创建', badgeColor: 'green' },
  update: { icon: Clock, color: '#3b82f6', badge: '更新', badgeColor: 'blue' },
  delete: { icon: Trash2, color: '#ef4444', badge: '删除', badgeColor: 'red' },
  pause: { icon: Pause, color: '#d97706', badge: '暂停', badgeColor: 'warning' },
  resume: { icon: Play, color: '#10b981', badge: '恢复', badgeColor: 'green' },
  trigger: { icon: Play, color: '#3b82f6', badge: '触发', badgeColor: 'blue' },
  logs: { icon: ScrollText, color: '#64748b', badge: '日志', badgeColor: 'default' }
}

function getCronMeta(argsStr: string): ActionStyle {
  const action = String(parseArgs(argsStr).action ?? '')
  return CRON_ACTIONS[action] ?? { icon: Clock, color: '#6366f1' }
}

function getCronSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.name) return String(obj.name).slice(0, 40)
  if (obj.schedule) return String(obj.schedule).slice(0, 30)
  if (obj.jobId) return `ID: ${String(obj.jobId).slice(0, 16)}`
  return ''
}

/* ═══════ 通用 Done 卡片 ═══════ */

function CompoundCardDone({
  tc,
  displayName,
  meta,
  argsSummary
}: {
  tc: ToolCallRecord
  displayName: string
  meta: ActionStyle
  argsSummary: string
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

/* ═══════ 通用 Preparing / Running 阶段 ═══════ */

function CompoundCardPhase({
  tc,
  displayName,
  meta,
  argsSummary,
  phase
}: {
  tc: ToolCallRecord
  displayName: string
  meta: ActionStyle
  argsSummary: string
  phase: 'preparing' | 'running'
}) {
  return (
    <div className="tool-card" data-status={phase}>
      <div className="tool-card__indicator" style={{ background: meta.color }} />
      <Flexbox gap={8} horizontal align="center" style={{ padding: '10px 14px' }}>
        <div className="tool-card__icon-wrap" style={{ '--tc-accent': meta.color } as never}>
          <Icon icon={meta.icon} size={15} />
        </div>
        <Flexbox flex={1} gap={2}>
          <Flexbox horizontal align="center" gap={6}>
            <span className="tool-card__name">{displayName}</span>
            {phase === 'running' && meta.badge && (
              <Tag size="small" color={meta.badgeColor ?? 'default'}>
                {meta.badge}
              </Tag>
            )}
          </Flexbox>
          {phase === 'running' && argsSummary && (
            <span className="tool-card__desc">{argsSummary}</span>
          )}
          <span className="tool-card__status-text">
            {phase === 'preparing' ? '准备调用…' : '执行中…'}
          </span>
        </Flexbox>
        <Loader2 size={14} className="tool-card__spinner" />
      </Flexbox>
    </div>
  )
}

/* ═══════ 各工具卡片 ═══════ */

const ScheduleToolCard = memo(function ScheduleToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const meta = getScheduleMeta(tc.arguments)
  const argsSummary = getScheduleSummary(tc.arguments)
  if (status === 'preparing' || status === 'running')
    return (
      <CompoundCardPhase
        tc={tc}
        displayName={displayName}
        meta={meta}
        argsSummary={argsSummary}
        phase={status}
      />
    )
  return (
    <CompoundCardDone tc={tc} displayName={displayName} meta={meta} argsSummary={argsSummary} />
  )
}, propsEq)

const CronToolCard = memo(function CronToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const meta = getCronMeta(tc.arguments)
  const argsSummary = getCronSummary(tc.arguments)
  if (status === 'preparing' || status === 'running')
    return (
      <CompoundCardPhase
        tc={tc}
        displayName={displayName}
        meta={meta}
        argsSummary={argsSummary}
        phase={status}
      />
    )
  return (
    <CompoundCardDone tc={tc} displayName={displayName} meta={meta} argsSummary={argsSummary} />
  )
}, propsEq)

/* ═══════ 注册 ═══════ */

registerToolRender('prizm_schedule', (props) => <ScheduleToolCard tc={props.tc} />)
registerToolRender('prizm_cron', (props) => <CronToolCard tc={props.tc} />)
