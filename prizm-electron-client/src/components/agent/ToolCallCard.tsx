/**
 * 工具卡片 - 按工具类别展示不同外观
 * 内置工具有分类图标与彩色指示条；文件相关工具有明确的「打开」按钮
 * 支持 preparing → running → done 三阶段，preparing/running 阶段即时渲染
 * 支持检测 OUT_OF_BOUNDS 错误并显示授权按钮
 */
import { createClientLogger } from '@prizm/client-core'
import { Flexbox, Icon, Tag } from '@lobehub/ui'

const log = createClientLogger('ToolCall')
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Brain,
  CheckSquare,
  Clipboard,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  Search,
  Terminal,
  Wrench,
  Bell,
  ChevronDown,
  ShieldCheck,
  Copy,
  Check,
  type LucideIcon
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useState, memo, createContext, useContext, useCallback } from 'react'
import { useToolCardExpanded, useToolCardExpandedKeyboard } from './useToolCardExpanded'
import type { ToolCallRecord, InteractRequestPayload, EnrichedSession } from '@prizm/client-core'
import {
  getToolDisplayName,
  getToolMetadata,
  getToolRender,
  isPrizmTool,
  type ToolRenderFn
} from '@prizm/client-core'
import { Typography } from 'antd'
import { createStyles } from 'antd-style'
import type { FileKind } from '../../hooks/useFileList'
import { useWorkNavigation } from '../../context/WorkNavigationContext'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { ToolCallBadge } from './ToolCallBadge'

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

/** OUT_OF_BOUNDS 错误标识符 */
const OUT_OF_BOUNDS_ERROR_CODE = 'OUT_OF_BOUNDS'

/** 授权路径回调上下文 */
export interface GrantPathContextValue {
  grantPaths: (paths: string[]) => Promise<void>
}
const GrantPathContext = createContext<GrantPathContextValue | null>(null)
export const GrantPathProvider = GrantPathContext.Provider

/** 工具交互回调上下文 */
export interface InteractContextValue {
  /** 当前待处理的交互请求 */
  pendingInteract: InteractRequestPayload | null
  /** 响应交互：approve 或 deny */
  respondToInteract: (requestId: string, approved: boolean, paths?: string[]) => Promise<void>
}
const InteractContext = createContext<InteractContextValue | null>(null)
export const InteractProvider = InteractContext.Provider

export interface ToolCallCardProps {
  tc: ToolCallRecord
  /** 当前会话，用于后台会话下 prizm_set_result 的「参数依步骤要求」提示 */
  session?: EnrichedSession | null
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
  knowledge: BookOpen,
  lock: Lock,
  terminal: Terminal,
  external: Globe,
  other: Wrench
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
  knowledge: '#0891b2',
  lock: '#d97706',
  terminal: '#64748b',
  external: '#f97316',
  other: '#0d9488'
}

function getCategoryIcon(toolName: string): LucideIcon {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_ICONS[meta.category]) return CATEGORY_ICONS[meta.category]
  if (
    toolName === 'prizm_web_search' ||
    toolName === 'prizm_web_fetch' ||
    toolName === 'tavily_web_search'
  )
    return Globe
  if (isPrizmTool(toolName)) return FileText
  return Wrench
}

function getCategoryColor(toolName: string): string {
  const meta = getToolMetadata(toolName)
  if (meta?.category && CATEGORY_COLORS[meta.category]) return CATEGORY_COLORS[meta.category]
  if (
    toolName === 'prizm_web_search' ||
    toolName === 'prizm_web_fetch' ||
    toolName === 'tavily_web_search'
  )
    return '#f97316'
  return '#94a3b8'
}

/* ── 可打开预览的文件相关工具（document/todo 有 id，file 工具用 path 暂无） ── */
const FILE_TOOLS = new Set([
  'prizm_document',
  'prizm_todo',
  // 旧工具名兼容
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

/* ── 格式化流式 partial JSON 参数用于展示 ── */
function formatArgsSoFar(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

/* ── 从参数提取摘要（支持复合工具 action/mode） ── */
function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (obj.query) return `${String(obj.query).slice(0, 40)}`
    if (obj.command) return `$ ${String(obj.command).slice(0, 50)}`
    if (obj.path) return String(obj.path).slice(0, 50)
    if (obj.from && obj.to)
      return `${String(obj.from).slice(0, 20)} → ${String(obj.to).slice(0, 20)}`
    if (obj.title) return String(obj.title).slice(0, 40)
    if (obj.content) return String(obj.content).slice(0, 40)
    if (obj.documentId) return `文档 ${String(obj.documentId).slice(0, 16)}`
    if (obj.todoId) return `待办 ${String(obj.todoId).slice(0, 16)}`
    if (obj.todoListId) return `待办列表 ${String(obj.todoListId).slice(0, 16)}`
    return ''
  } catch {
    return ''
  }
}

export const ToolCallCard = memo(function ToolCallCard({ tc, session }: ToolCallCardProps) {
  const { styles } = useStyles()
  const compact = useAgentSessionStore((s) => s.toolCardCompact)

  const status = tc.status ?? 'done'
  const isError = !!tc.isError

  /* 外部注册的自定义渲染器始终优先（自定义卡片自行管理精简/展开） */
  const customRender = getToolRender(tc.name)
  if (customRender) return <>{customRender({ tc, session } as Parameters<ToolRenderFn>[0])}</>

  /* 精简模式：done 状态的非错误卡片渲染为 inline badge */
  if (compact && status === 'done' && !isError) {
    return <ToolCallBadge tc={tc} />
  }

  if (status === 'preparing' || status === 'running') {
    log.debug('Render:', status, tc.id, tc.name)
  }
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const CategoryIcon = getCategoryIcon(tc.name)
  const accentColor = getCategoryColor(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)
  const { openFileAtWork } = useWorkNavigation()

  const isFileRelated = FILE_TOOLS.has(tc.name)
  const fileRef =
    isFileRelated && status === 'done' && !isError ? parseFileRef(tc.arguments, tc.result) : null

  /* ── preparing: LLM 正在生成工具参数 ── */
  if (status === 'preparing') {
    return (
      <div className="tool-card" data-status="preparing">
        <div className="tool-card__indicator" style={{ background: accentColor }} />
        <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': accentColor } as never}>
            <Icon icon={CategoryIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2}>
            <span className="tool-card__name">{displayName}</span>
            {argsSummary ? (
              <span className="tool-card__desc">{argsSummary}</span>
            ) : (
              <span className="tool-card__status-text">生成参数中…</span>
            )}
          </Flexbox>
          <Loader2 size={14} className="tool-card__spinner" />
        </Flexbox>
        {tc.arguments && tc.arguments !== '{}' && (
          <div className="tool-card__streaming-args">
            <pre className="tool-card__pre tool-card__pre--streaming">
              {formatArgsSoFar(tc.arguments)}
            </pre>
          </div>
        )}
        <div className="tool-card__progress-bar" style={{ '--tc-accent': accentColor } as never} />
      </div>
    )
  }

  /* ── running: 工具正在执行 ── */
  if (status === 'running') {
    return (
      <div className="tool-card" data-status="running">
        <div className="tool-card__indicator" style={{ background: accentColor }} />
        <Flexbox gap={8} horizontal align="center" className={styles.cardPadding}>
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
        <div className="tool-card__progress-bar" style={{ '--tc-accent': accentColor } as never} />
      </div>
    )
  }

  /* ── awaiting_interact: 工具需要用户确认 ── */
  if (status === 'awaiting_interact') {
    return (
      <ToolCardAwaitingInteract
        tc={tc}
        displayName={displayName}
        CategoryIcon={CategoryIcon}
        accentColor={accentColor}
        argsSummary={argsSummary}
      />
    )
  }

  /* ── done: 可展开/折叠的完成卡片 ── */
  return (
    <ToolCardDone
      tc={tc}
      session={session}
      displayName={displayName}
      CategoryIcon={isError ? AlertCircle : CategoryIcon}
      accentColor={isError ? 'var(--ant-color-error)' : accentColor}
      argsSummary={argsSummary}
      isError={isError}
      fileRef={fileRef}
      onOpenFile={openFileAtWork}
    />
  )
}, toolCallPropsEqual)

/** 浅比较 ToolCallCard 的关键属性，避免流式更新时不必要的重渲染 */
function toolCallPropsEqual(prev: ToolCallCardProps, next: ToolCallCardProps): boolean {
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

/** 从工具参数中提取路径 */
function extractPathFromArgs(argsStr: string): string | null {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    if (typeof obj.path === 'string') return obj.path
    if (typeof obj.from === 'string') return obj.from
    return null
  } catch {
    return null
  }
}

const RESULT_TRUNCATE_LIMIT = 500

function formatResultStr(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    },
    [text]
  )
  return (
    <button className="tool-card__copy-btn" onClick={handleCopy} title="复制结果">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function TruncatedPre({ text, isError }: { text: string; isError: boolean }) {
  const formatted = formatResultStr(text)
  const needsTruncation = formatted.length > RESULT_TRUNCATE_LIMIT
  const [showAll, setShowAll] = useState(false)
  const displayText =
    needsTruncation && !showAll ? formatted.slice(0, RESULT_TRUNCATE_LIMIT) + '…' : formatted

  return (
    <div className="tool-card__pre-wrap">
      <pre className={`tool-card__pre${isError ? ' tool-card__pre--error' : ''}`}>
        {displayText || '(无返回)'}
      </pre>
      {text && <CopyButton text={text} />}
      {needsTruncation && !showAll && (
        <span className="tool-card__show-more" onClick={() => setShowAll(true)}>
          查看完整结果
        </span>
      )}
    </div>
  )
}

/* ── Done 状态的卡片，独立组件以维护 expanded state ── */
function ToolCardDone({
  tc,
  session,
  displayName,
  CategoryIcon,
  accentColor,
  argsSummary,
  isError,
  fileRef,
  onOpenFile
}: {
  tc: ToolCallRecord
  session?: EnrichedSession | null
  displayName: string
  CategoryIcon: LucideIcon
  accentColor: string
  argsSummary: string
  isError: boolean
  fileRef: { kind: FileKind; id: string } | null
  onOpenFile: (kind: FileKind, id: string) => void
}) {
  const { styles } = useStyles()
  const [expanded, toggleExpanded] = useToolCardExpanded(tc.id, isError)
  const handleKeyDown = useToolCardExpandedKeyboard(toggleExpanded)
  const [granting, setGranting] = useState(false)
  const [granted, setGranted] = useState(false)
  const grantCtx = useContext(GrantPathContext)

  const isOutOfBounds = isError && tc.result?.includes(OUT_OF_BOUNDS_ERROR_CODE)
  const outOfBoundsPath = isOutOfBounds ? extractPathFromArgs(tc.arguments) : null

  const handleGrant = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!grantCtx || !outOfBoundsPath || granting || granted) return
      setGranting(true)
      try {
        await grantCtx.grantPaths([outOfBoundsPath])
        setGranted(true)
      } catch {
        /* ignore */
      } finally {
        setGranting(false)
      }
    },
    [grantCtx, outOfBoundsPath, granting, granted]
  )

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
              {isError && !isOutOfBounds && (
                <Tag size="small" color="error">
                  失败
                </Tag>
              )}
              {isOutOfBounds && (
                <Tag size="small" color="warning">
                  需要授权
                </Tag>
              )}
            </Flexbox>
            {argsSummary && <span className="tool-card__desc">{argsSummary}</span>}
          </Flexbox>
          {isOutOfBounds && outOfBoundsPath && grantCtx && (
            <button
              className="tool-card__open-btn"
              title={granted ? '已授权' : '授权访问此路径'}
              disabled={granting || granted}
              onClick={handleGrant}
              style={
                granted
                  ? {
                      background: 'var(--ant-color-success-bg, #f6ffed)',
                      color: 'var(--ant-color-success, #52c41a)'
                    }
                  : {
                      background: 'var(--ant-color-warning-bg, #fff7e6)',
                      color: 'var(--ant-color-warning-text, #d46b08)'
                    }
              }
            >
              <ShieldCheck size={12} />
              <span>{granted ? '已授权' : granting ? '授权中…' : '授权'}</span>
            </button>
          )}
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
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="tool-card__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.33, 1, 0.68, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {tc.name === 'prizm_set_result' &&
              session?.kind === 'background' &&
              session?.bgMeta?.ioConfig?.outputParams && (
                <div className="tool-card__set-result-hint" style={{ marginBottom: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    参数依当前步骤要求提交（仅必填字段）
                  </Typography.Text>
                </div>
              )}
            {tc.arguments && tc.arguments !== '{}' && (
              <div className="tool-card__pre-wrap">
                <div className="tool-card__section-label">参数</div>
                <pre className="tool-card__pre">{formatResultStr(tc.arguments)}</pre>
                <CopyButton text={tc.arguments} />
              </div>
            )}
            <div>
              <div className="tool-card__section-label">{isError ? '错误信息' : '结果'}</div>
              <TruncatedPre text={tc.result || ''} isError={isError} />
              {isError && (
                <div className="tool-card__retry-hint">可通过发送消息要求 Agent 重试此操作</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── 等待用户交互状态的卡片：按 kind 展示不同内容 ── */
function ToolCardAwaitingInteract({
  tc,
  displayName,
  CategoryIcon,
  accentColor,
  argsSummary
}: {
  tc: ToolCallRecord
  displayName: string
  CategoryIcon: LucideIcon
  accentColor: string
  argsSummary: string
}) {
  const { styles } = useStyles()
  const interactCtx = useContext(InteractContext)
  const [responding, setResponding] = useState(false)
  const warningColor = 'var(--ant-color-warning, #faad14)'
  const pending = interactCtx?.pendingInteract
  const isReady = !!pending
  const kind = pending?.kind ?? 'file_access'

  const handleApprove = useCallback(async () => {
    if (!pending || responding) return
    setResponding(true)
    try {
      await interactCtx!.respondToInteract(pending.requestId, true, pending.paths)
    } finally {
      setResponding(false)
    }
  }, [interactCtx, pending, responding])

  const handleDeny = useCallback(async () => {
    if (!pending || responding) return
    setResponding(true)
    try {
      await interactCtx!.respondToInteract(pending.requestId, false)
    } finally {
      setResponding(false)
    }
  }, [interactCtx, pending, responding])

  const KindIcon =
    kind === 'terminal_command'
      ? Terminal
      : kind === 'destructive_operation'
      ? AlertTriangle
      : kind === 'custom'
      ? HelpCircle
      : ShieldCheck

  const approveLabel =
    kind === 'terminal_command'
      ? '允许执行'
      : kind === 'destructive_operation'
      ? '确认操作'
      : kind === 'custom'
      ? '批准'
      : '允许访问'

  return (
    <div className="tool-card tool-card--interact" data-status="awaiting_interact">
      <div className="tool-card__indicator" style={{ background: warningColor }} />
      <div className={styles.cardPadding}>
        <Flexbox gap={8} horizontal align="center">
          <div className="tool-card__icon-wrap" style={{ '--tc-accent': warningColor } as never}>
            <Icon icon={KindIcon} size={15} />
          </div>
          <Flexbox flex={1} gap={2}>
            <Flexbox horizontal align="center" gap={6}>
              <span className="tool-card__name">{displayName}</span>
              <Tag size="small" color="warning">
                需要授权
              </Tag>
            </Flexbox>
            {argsSummary && <span className="tool-card__desc">{argsSummary}</span>}
          </Flexbox>
          <Loader2 size={14} className="tool-card__spinner" />
        </Flexbox>
        <div className="tool-card__interact-body">
          <InteractCardBody pending={pending} tc={tc} />
          <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
            <button
              className={`tool-card__interact-btn tool-card__interact-btn--approve${
                kind === 'destructive_operation' ? ' tool-card__interact-btn--warn' : ''
              }`}
              onClick={handleApprove}
              disabled={responding || !isReady}
            >
              <KindIcon size={13} />
              <span>{responding ? '处理中…' : !isReady ? '等待中…' : approveLabel}</span>
            </button>
            <button
              className="tool-card__interact-btn tool-card__interact-btn--deny"
              onClick={handleDeny}
              disabled={responding || !isReady}
            >
              <AlertCircle size={13} />
              <span>拒绝</span>
            </button>
          </Flexbox>
        </div>
      </div>
    </div>
  )
}

function InteractCardBody({
  pending,
  tc
}: {
  pending: InteractRequestPayload | null | undefined
  tc: ToolCallRecord
}) {
  const kind = pending?.kind ?? 'file_access'

  if (kind === 'terminal_command' && pending?.command) {
    return (
      <>
        <div className="tool-card__interact-message">
          工具需要执行以下命令，请在下方面板中确认：
        </div>
        <div className="tool-card__interact-paths">
          <code className="tool-card__interact-path">{pending.command}</code>
        </div>
      </>
    )
  }

  if (kind === 'destructive_operation' && pending?.description) {
    return <div className="tool-card__interact-message">{pending.description}</div>
  }

  if (kind === 'custom') {
    return (
      <div className="tool-card__interact-message">
        {pending?.description || '工具需要您的确认才能继续'}
      </div>
    )
  }

  const paths = pending?.paths ?? extractPathsFromToolArgs(tc.arguments)
  return (
    <>
      <div className="tool-card__interact-message">工具需要访问以下路径，请在下方面板中确认：</div>
      {paths.length > 0 && (
        <div className="tool-card__interact-paths">
          {paths.map((p: string, i: number) => (
            <code key={i} className="tool-card__interact-path">
              {p}
            </code>
          ))}
        </div>
      )}
    </>
  )
}

/** 从工具参数 JSON 中提取路径列表（fallback，当 pendingInteract 尚未到达时） */
function extractPathsFromToolArgs(argsStr: string): string[] {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    const paths: string[] = []
    if (typeof obj.path === 'string' && obj.path.trim()) paths.push(obj.path.trim())
    if (typeof obj.from === 'string' && obj.from.trim()) paths.push(obj.from.trim())
    if (typeof obj.to === 'string' && obj.to.trim()) paths.push(obj.to.trim())
    return paths
  } catch {
    return []
  }
}
