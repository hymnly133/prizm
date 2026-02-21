/**
 * 任务相关工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 *
 * 覆盖工具：prizm_spawn_task / prizm_task_status / prizm_set_result
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ChevronDown,
  ClipboardCheck,
  ExternalLink,
  Eye,
  ListTodo,
  Loader2,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Button, Typography } from 'antd'
import { createStyles } from 'antd-style'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import type { ToolCallRecord, EnrichedSession } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import type { CollabInteractionAPI } from '../../hooks/useCollabInteraction'

const ACCENT_COLOR = '#10b981'

const useStyles = createStyles(({ css }) => ({
  cardPadding: css`
    padding: 10px 14px;
  `,
  fullWidth: css`
    width: 100%;
  `,
  noShrink: css`
    min-width: 0;
  `,
  resultPre: css`
    background: var(--ant-color-fill-quaternary, #f5f5f5);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow: auto;
    margin: 4px 0;
    line-height: 1.5;
  `
}))

const TOOL_DISPLAY: Record<string, { icon: LucideIcon; label: string }> = {
  prizm_spawn_task: { icon: Zap, label: '派发子任务' },
  prizm_task_status: { icon: ListTodo, label: '查询任务状态' },
  prizm_set_result: { icon: ClipboardCheck, label: '提交任务结果' }
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr || '{}')
  } catch {
    return {}
  }
}

function parseResult(resultStr: string): Record<string, unknown> {
  try {
    return JSON.parse(resultStr || '{}')
  } catch {
    return {}
  }
}

function getSpawnSummary(args: Record<string, unknown>): string {
  const task = (args.task as string) ?? ''
  const mode = (args.mode as string) ?? 'async'
  const label = (args.label as string) ?? ''
  const truncated = (label || task).slice(0, 50)
  return `[${mode === 'sync' ? '同步' : '异步'}] ${truncated}${(label || task).length > 50 ? '…' : ''}`
}

function getStatusSummary(args: Record<string, unknown>): string {
  const action = (args.action as string) ?? ''
  const taskId = (args.task_id as string) ?? ''
  const actionLabels: Record<string, string> = {
    list: '列出子任务',
    status: '查询状态',
    result: '获取结果',
    cancel: '取消任务'
  }
  const label = actionLabels[action] ?? action
  return taskId ? `${label} — ${taskId.slice(0, 8)}…` : label
}

/** Schema 无关：优先 output，否则取第一个非 status 的字符串字段 */
function getSetResultSummary(args: Record<string, unknown>): string {
  const status = (args.status as string) ?? 'success'
  let content = (args.output as string) ?? ''
  if (!content) {
    for (const [k, v] of Object.entries(args)) {
      if (k !== 'status' && typeof v === 'string') {
        content = v
        break
      }
    }
  }
  return `[${status}] ${content.slice(0, 60)}${content.length > 60 ? '…' : ''}`
}

function extractSessionId(resultStr: string): string | null {
  const parsed = parseResult(resultStr)
  if (typeof parsed.sessionId === 'string') return parsed.sessionId
  if (typeof parsed.taskId === 'string') return parsed.taskId
  const text = typeof parsed === 'string' ? parsed : resultStr
  const match = text.match(/(?:sessionId|taskId|task_id)['":\s]+([a-f0-9-]{8,})/i)
  return match?.[1] ?? null
}

/** 模块级 switchSession 回调 — 由 TaskToolCardsConnector 设置 */
let _switchSessionFn: ((sessionId: string) => void) | null = null

/** 模块级 interaction API — 由 TaskToolCardsConnector 设置 */
let _interactionAPI: CollabInteractionAPI | null = null

/**
 * Connector 组件：挂载在 React 树中，将 session 切换能力和面板交互
 * 桥接到模块级注册的渲染器中。
 */
export function TaskToolCardsConnector({ api }: { api?: CollabInteractionAPI }) {
  const switchSession = useAgentSessionStore((s) => s.switchSession)
  const switchRef = useRef(switchSession)
  switchRef.current = switchSession
  const apiRef = useRef(api)
  apiRef.current = api

  useEffect(() => {
    _switchSessionFn = (sessionId: string) => {
      switchRef.current?.(sessionId)
    }
    _interactionAPI = apiRef.current ?? null
    return () => {
      _switchSessionFn = null
      _interactionAPI = null
    }
  }, [])

  useEffect(() => {
    _interactionAPI = api ?? null
  }, [api])

  return null
}

function ViewSessionButton({ resultStr }: { resultStr: string }) {
  const sessionId = extractSessionId(resultStr)
  if (!sessionId || !_switchSessionFn) return null
  return (
    <Button
      size="small"
      type="link"
      icon={<Eye size={12} />}
      onClick={(e) => {
        e.stopPropagation()
        _switchSessionFn?.(sessionId)
      }}
      style={{ padding: '0 4px', height: 22, fontSize: 12 }}
    >
      查看会话
    </Button>
  )
}

function ViewTaskInPanelButton({ resultStr }: { resultStr: string }) {
  const parsed = parseResult(resultStr)
  const taskId = (parsed.taskId as string) ?? (parsed.task_id as string) ?? null
  if (!taskId || !_interactionAPI) return null
  return (
    <Button
      size="small"
      type="link"
      icon={<ExternalLink size={11} />}
      onClick={(e) => {
        e.stopPropagation()
        _interactionAPI?.openTask(taskId)
      }}
      style={{ padding: '0 4px', height: 22, fontSize: 11 }}
    >
      任务面板
    </Button>
  )
}

function TaskToolCardDone({
  tc,
  session,
  displayName,
  CategoryIcon,
  isError
}: {
  tc: ToolCallRecord
  session?: EnrichedSession | null
  displayName: string
  CategoryIcon: LucideIcon
  isError: boolean
}) {
  const { styles } = useStyles()
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const args = parseArgs(tc.arguments)
  const accentColor = isError ? 'var(--ant-color-error)' : ACCENT_COLOR
  const showSetResultHint =
    tc.name === 'prizm_set_result' &&
    session?.kind === 'background' &&
    !!session?.bgMeta?.ioConfig?.outputParams

  let summary = ''
  if (tc.name === 'prizm_spawn_task') summary = getSpawnSummary(args)
  else if (tc.name === 'prizm_task_status') summary = getStatusSummary(args)
  else if (tc.name === 'prizm_set_result') summary = getSetResultSummary(args)

  const mode = tc.name === 'prizm_spawn_task' ? (args.mode as string) ?? 'async' : null

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
            <Icon icon={isError ? AlertCircle : CategoryIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2} className={styles.noShrink}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              {isError && <Tag size="small" color="error">失败</Tag>}
              {mode && (
                <Tag size="small" color={mode === 'sync' ? 'blue' : 'cyan'}>
                  {mode === 'sync' ? '同步' : '异步'}
                </Tag>
              )}
              {tc.name !== 'prizm_set_result' && (
                <>
                  <ViewSessionButton resultStr={tc.result} />
                  {tc.name === 'prizm_spawn_task' && <ViewTaskInPanelButton resultStr={tc.result} />}
                </>
              )}
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
          {showSetResultHint && (
            <div className="tool-card__set-result-hint" style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                参数依当前步骤要求提交（仅必填字段）
              </Typography.Text>
            </div>
          )}
          {tc.arguments && tc.arguments !== '{}' && (
            <div className="tool-card__pre-wrap" style={{ marginBottom: 8 }}>
            <div className="tool-card__section-label">参数</div>
            <pre className="tool-card__pre">{JSON.stringify(parseArgs(tc.arguments), null, 2)}</pre>
            </div>
          )}
          <div className="tool-card__section-label">{isError ? '错误信息' : '结果'}</div>
          <pre className={`tool-card__pre${isError ? ' tool-card__pre--error' : ''}`}>
            {tc.result || '(无返回)'}
          </pre>
        </div>
      )}
    </div>
  )
}

const TaskToolCard = memo(
  function TaskToolCard({ tc, session }: { tc: ToolCallRecord; session?: EnrichedSession | null }) {
    const { styles } = useStyles()
    const status = tc.status ?? 'done'
    const displayName = getToolDisplayName(tc.name, tc.arguments)
    const info = TOOL_DISPLAY[tc.name] ?? TOOL_DISPLAY.prizm_spawn_task
    const CategoryIcon = info.icon
    const isError = !!tc.isError

    if (status === 'preparing') {
      return (
        <div className="tool-card" data-status="preparing">
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
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
      const args = parseArgs(tc.arguments)
      let summary = ''
      if (tc.name === 'prizm_spawn_task') summary = getSpawnSummary(args)
      else if (tc.name === 'prizm_task_status') summary = getStatusSummary(args)
      else if (tc.name === 'prizm_set_result') summary = getSetResultSummary(args)

      return (
        <div className="tool-card" data-status="running">
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
              <Icon icon={CategoryIcon} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <span className="tool-card__name">{displayName}</span>
              {summary && <span className="tool-card__desc">{summary}</span>}
              <span className="tool-card__status-text">执行中…</span>
            </Flexbox>
            <Loader2 size={14} className="tool-card__spinner" />
          </Flexbox>
        </div>
      )
    }

    return (
      <TaskToolCardDone
        tc={tc}
        session={session}
        displayName={displayName}
        CategoryIcon={CategoryIcon}
        isError={isError}
      />
    )
  },
  (prev, next) => {
    const a = prev.tc
    const b = next.tc
    if (prev.session?.id !== next.session?.id) return false
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

const TASK_TOOLS = [
  'prizm_spawn_task',
  'prizm_task_status',
  'prizm_set_result'
] as const

for (const name of TASK_TOOLS) {
  registerToolRender(name, (props) => <TaskToolCard tc={props.tc} session={props.session} />)
}
