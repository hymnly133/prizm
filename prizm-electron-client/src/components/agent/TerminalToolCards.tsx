/**
 * 终端相关工具的自定义卡片
 * 通过 registerToolRender 注册，ToolCallCard 优先使用注册的渲染器
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Terminal as TerminalIcon,
  Play,
  Send,
  Type,
  type LucideIcon
} from 'lucide-react'
import { memo } from 'react'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import { Button } from 'antd'
import { createStyles } from 'antd-style'
import type { ToolCallRecord } from '@prizm/client-core'
import { getToolDisplayName, registerToolRender } from '@prizm/client-core'

const ACCENT_COLOR = '#a855f7'

const useStyles = createStyles(({ css, token }) => ({
  terminalPre: css`
    background: #1a1a2e;
    color: #e2e8f0;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-family: 'Cascadia Code', 'Fira Code', Menlo, Monaco, monospace;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow: auto;
    margin: 4px 0;
    line-height: 1.5;
  `,
  cardPadding: css`
    padding: 10px 14px;
  `,
  fullWidth: css`
    width: 100%;
  `,
  noShrink: css`
    min-width: 0;
  `,
  monoDesc: css`
    font-family: monospace;
  `
}))

const TOOL_ICONS: Record<string, LucideIcon> = {
  prizm_terminal_execute: Play,
  prizm_terminal_spawn: TerminalIcon,
  prizm_terminal_send_keys: Send
}

function getIcon(toolName: string): LucideIcon {
  return TOOL_ICONS[toolName] || TerminalIcon
}

function parseTerminalArgs(argsStr: string): {
  command?: string
  title?: string
  terminalId?: string
  input?: string
  cwd?: string
  pressEnter?: boolean
} {
  try {
    return JSON.parse(argsStr || '{}')
  } catch {
    return {}
  }
}

function getArgsSummary(toolName: string, argsStr: string): string {
  const args = parseTerminalArgs(argsStr)
  switch (toolName) {
    case 'prizm_terminal_execute':
      return args.command
        ? `$ ${args.command.slice(0, 60)}${args.command.length > 60 ? '...' : ''}`
        : ''
    case 'prizm_terminal_spawn':
      return args.title || '新终端'
    case 'prizm_terminal_send_keys': {
      if (!args.input) return ''
      const truncated = args.input.slice(0, 40) + (args.input.length > 40 ? '...' : '')
      return `→ ${truncated}`
    }
    default:
      return ''
  }
}

/** 获取 send_keys 的 pressEnter 状态 */
function getSendKeysMode(argsStr: string): 'enter' | 'type' {
  const args = parseTerminalArgs(argsStr)
  return args.pressEnter === false ? 'type' : 'enter'
}

/** 剥离 ANSI 转义序列，避免终端输出中出现不可读字符 */
function clientStripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /[\u001b\u009b](?:\[[0-9;?]*[A-Za-z@~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()#][A-B012]|[>=])/g,
    ''
  )
}

/** send_keys 模式标签：Enter（执行命令） / Type（仅输入） */
function SendKeysModeBadge({ argsStr }: { argsStr: string }) {
  const mode = getSendKeysMode(argsStr)
  const isEnter = mode === 'enter'
  return (
    <Tag size="small" color={isEnter ? 'blue' : 'cyan'}>
      <Flexbox horizontal align="center" gap={3} style={{ display: 'inline-flex' }}>
        {isEnter ? <CornerDownLeft size={10} /> : <Type size={10} />}
        <span>{isEnter ? 'Enter' : 'Type'}</span>
      </Flexbox>
    </Tag>
  )
}

/** 终端输出显示组件 — 暗色背景 + 等宽字体 */
function TerminalOutput({ text, maxLines = 30 }: { text: string; maxLines?: number }) {
  const { styles } = useStyles()
  const cleaned = clientStripAnsi(text)
  const lines = cleaned.split('\n')
  const truncated = lines.length > maxLines
  const displayText = truncated
    ? [
        ...lines.slice(0, 10),
        `\n... (省略 ${lines.length - 20} 行) ...\n`,
        ...lines.slice(-10)
      ].join('\n')
    : cleaned

  return <pre className={styles.terminalPre}>{displayText || '(无输出)'}</pre>
}

/** Done 状态卡片 */
function TerminalToolCardDone({
  tc,
  displayName,
  CategoryIcon,
  isError
}: {
  tc: ToolCallRecord
  displayName: string
  CategoryIcon: LucideIcon
  isError: boolean
}) {
  const { styles } = useStyles()
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const argsSummary = getArgsSummary(tc.name, tc.arguments)
  const accentColor = isError ? 'var(--ant-color-error)' : ACCENT_COLOR

  const result = tc.result || ''
  const hasExitCode = result.match(/\[退出码:\s*(\d+)\]/)
  const hasTimeout = result.includes('[超时')
  const exitCode = hasExitCode ? parseInt(hasExitCode[1]) : null
  const isSuccess = exitCode === 0

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
              {isError && (
                <Tag size="small" color="error">
                  失败
                </Tag>
              )}
              {hasTimeout && (
                <Tag size="small" color="warning">
                  超时
                </Tag>
              )}
              {exitCode !== null && !isError && !hasTimeout && (
                <Tag size="small" color={isSuccess ? 'success' : 'warning'}>
                  exit {exitCode}
                </Tag>
              )}
              {tc.name === 'prizm_terminal_send_keys' && (
                <SendKeysModeBadge argsStr={tc.arguments} />
              )}
            </Flexbox>
            {argsSummary && (
              <span className={`tool-card__desc ${styles.monoDesc}`}>{argsSummary}</span>
            )}
          </Flexbox>
          <ChevronDown
            size={14}
            className={`tool-card__chevron${expanded ? ' tool-card__chevron--open' : ''}`}
          />
        </Flexbox>
      </div>
      {expanded && (
        <div className="tool-card__body">
          {tc.name === 'prizm_terminal_execute' ? (
            <TerminalOutput text={result} />
          ) : (
            <div>
              <div className="tool-card__section-label">{isError ? '错误信息' : '结果'}</div>
              <pre className={`tool-card__pre${isError ? ' tool-card__pre--error' : ''}`}>
                {result || '(无返回)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 通用终端工具卡片 */
const TerminalToolCard = memo(
  function TerminalToolCard({ tc }: { tc: ToolCallRecord }) {
    const { styles } = useStyles()
    const status = tc.status ?? 'done'
    const displayName = getToolDisplayName(tc.name, tc.arguments)
    const CategoryIcon = getIcon(tc.name)
    const isError = !!tc.isError
    const argsSummary = getArgsSummary(tc.name, tc.arguments)

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
      return (
        <div className="tool-card" data-status="running">
          <div className="tool-card__indicator" style={{ background: ACCENT_COLOR }} />
          <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
            <div className="tool-card__icon-wrap" style={{ '--tc-accent': ACCENT_COLOR } as never}>
              <Icon icon={CategoryIcon} size={15} />
            </div>
            <Flexbox flex={1} gap={2}>
              <Flexbox horizontal align="center" gap={6}>
                <span className="tool-card__name">{displayName}</span>
                {tc.name === 'prizm_terminal_send_keys' && (
                  <SendKeysModeBadge argsStr={tc.arguments} />
                )}
              </Flexbox>
              {argsSummary && (
                <span className={`tool-card__desc ${styles.monoDesc}`}>{argsSummary}</span>
              )}
              <span className="tool-card__status-text">执行中…</span>
            </Flexbox>
            <Loader2 size={14} className="tool-card__spinner" />
          </Flexbox>
        </div>
      )
    }

    return (
      <TerminalToolCardDone
        tc={tc}
        displayName={displayName}
        CategoryIcon={CategoryIcon}
        isError={isError}
      />
    )
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

// 注册终端工具的自定义渲染器
const TERMINAL_TOOLS = [
  'prizm_terminal_execute',
  'prizm_terminal_spawn',
  'prizm_terminal_send_keys'
] as const

for (const name of TERMINAL_TOOLS) {
  registerToolRender(name, (props) => <TerminalToolCard tc={props.tc} />)
}
