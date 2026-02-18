/**
 * search / knowledge / lock 复合工具的自定义卡片
 * 通过 registerToolRender 注册到 ToolCallCard 渲染链
 */
import { Flexbox, Icon, Tag } from '@lobehub/ui'
import {
  AlertCircle,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Brain,
  ChevronDown,
  GitCompare,
  Globe,
  History,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Network,
  Search,
  ShieldQuestion,
  Unlock,
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

/* ═══════ prizm_search ═══════ */

const SEARCH_MODES: Record<string, ActionStyle> = {
  keyword: { icon: Search, color: '#6366f1', badge: '关键词', badgeColor: 'blue' },
  memory: { icon: Brain, color: '#14b8a6', badge: '记忆', badgeColor: 'cyan' },
  hybrid: { icon: Network, color: '#7c3aed', badge: '混合', badgeColor: 'purple' },
  stats: { icon: BarChart3, color: '#8b5cf6', badge: '统计', badgeColor: 'purple' }
}

function getSearchMeta(argsStr: string): ActionStyle {
  const mode = String(parseArgs(argsStr).mode ?? '')
  return SEARCH_MODES[mode] ?? { icon: Search, color: '#6366f1' }
}

function getSearchSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  const mode = String(obj.mode ?? '')
  if (mode === 'stats') return '工作区数据概览'
  if (obj.query) return String(obj.query).slice(0, 40)
  if (mode === 'memory') return '列出全部记忆'
  if (mode === 'hybrid') return '混合搜索'
  return ''
}

/* ═══════ prizm_knowledge ═══════ */

const KNOWLEDGE_ACTIONS: Record<string, ActionStyle> = {
  search: { icon: Network, color: '#0891b2', badge: '反向定位', badgeColor: 'cyan' },
  memories: { icon: Brain, color: '#0891b2', badge: '文档记忆', badgeColor: 'blue' },
  versions: { icon: History, color: '#0891b2', badge: '版本', badgeColor: 'default' },
  related: { icon: GitCompare, color: '#0891b2', badge: '相关', badgeColor: 'purple' },
  round_lookup: { icon: MessageSquare, color: '#6366f1', badge: '对话追溯', badgeColor: 'blue' }
}

function getKnowledgeMeta(argsStr: string): ActionStyle {
  const action = String(parseArgs(argsStr).action ?? '')
  return KNOWLEDGE_ACTIONS[action] ?? { icon: BookOpen, color: '#0891b2' }
}

function getKnowledgeSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  const action = String(obj.action ?? '')
  if (action === 'round_lookup') {
    if (obj.memoryId) return `记忆 ${String(obj.memoryId).slice(0, 16)}`
    if (obj.messageId) return `消息 ${String(obj.messageId).slice(0, 16)}`
    return '查看最近对话'
  }
  if (obj.query) return String(obj.query).slice(0, 40)
  if (obj.documentId) return `文档 ${String(obj.documentId).slice(0, 16)}`
  return ''
}

/* ═══════ prizm_lock ═══════ */

const LOCK_ACTIONS: Record<string, ActionStyle> = {
  checkout: { icon: Lock, color: '#d97706', badge: '签出', badgeColor: 'warning' },
  checkin: { icon: Unlock, color: '#10b981', badge: '签入', badgeColor: 'green' },
  claim: { icon: Lock, color: '#d97706', badge: '领取', badgeColor: 'warning' },
  set_active: { icon: Lock, color: '#6366f1', badge: '进行中', badgeColor: 'blue' },
  release: { icon: LockOpen, color: '#10b981', badge: '释放', badgeColor: 'green' },
  status: { icon: ShieldQuestion, color: '#64748b', badge: '状态', badgeColor: 'default' }
}

function getLockMeta(argsStr: string): ActionStyle {
  const action = String(parseArgs(argsStr).action ?? '')
  return LOCK_ACTIONS[action] ?? { icon: Lock, color: '#d97706' }
}

function getLockSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.documentId) return `文档 ${String(obj.documentId).slice(0, 16)}`
  if (obj.todoListId) return `待办列表 ${String(obj.todoListId).slice(0, 16)}`
  if (obj.todoId) return `待办项 ${String(obj.todoId).slice(0, 16)}`
  if (obj.resourceId)
    return `${String(obj.resourceType ?? '')} ${String(obj.resourceId).slice(0, 16)}`
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

const SearchToolCard = memo(function SearchToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const meta = getSearchMeta(tc.arguments)
  const argsSummary = getSearchSummary(tc.arguments)
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

const KnowledgeToolCard = memo(function KnowledgeToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const meta = getKnowledgeMeta(tc.arguments)
  const argsSummary = getKnowledgeSummary(tc.arguments)
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

const LockToolCard = memo(function LockToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const meta = getLockMeta(tc.arguments)
  const argsSummary = getLockSummary(tc.arguments)
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

/* ═══════ prizm_promote_file ═══════ */

function getPromoteSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.fileId) return `ID: ${String(obj.fileId).slice(0, 16)}`
  return ''
}

const PROMOTE_META: ActionStyle = {
  icon: ArrowUpFromLine,
  color: '#059669',
  badge: '提升',
  badgeColor: 'green'
}

const PromoteFileToolCard = memo(function PromoteFileToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const argsSummary = getPromoteSummary(tc.arguments)
  if (status === 'preparing' || status === 'running')
    return (
      <CompoundCardPhase
        tc={tc}
        displayName={displayName}
        meta={PROMOTE_META}
        argsSummary={argsSummary}
        phase={status}
      />
    )
  return (
    <CompoundCardDone
      tc={tc}
      displayName={displayName}
      meta={PROMOTE_META}
      argsSummary={argsSummary}
    />
  )
}, propsEq)

/* ═══════ prizm_tool_guide ═══════ */

function getToolGuideSummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.tool) return String(obj.tool)
  return '全部工具'
}

const TOOL_GUIDE_META: ActionStyle = {
  icon: BookOpenCheck,
  color: '#0d9488',
  badge: '指南',
  badgeColor: 'cyan'
}

const ToolGuideCard = memo(function ToolGuideCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const argsSummary = getToolGuideSummary(tc.arguments)
  if (status === 'preparing' || status === 'running')
    return (
      <CompoundCardPhase
        tc={tc}
        displayName={displayName}
        meta={TOOL_GUIDE_META}
        argsSummary={argsSummary}
        phase={status}
      />
    )
  return (
    <CompoundCardDone
      tc={tc}
      displayName={displayName}
      meta={TOOL_GUIDE_META}
      argsSummary={argsSummary}
    />
  )
}, propsEq)

/* ═══════ tavily_web_search ═══════ */

function getTavilySummary(argsStr: string): string {
  const obj = parseArgs(argsStr)
  if (obj.query) return String(obj.query).slice(0, 50)
  return ''
}

const TAVILY_META: ActionStyle = {
  icon: Globe,
  color: '#f97316',
  badge: '联网',
  badgeColor: 'warning'
}

const TavilyToolCard = memo(function TavilyToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name, tc.arguments)
  const argsSummary = getTavilySummary(tc.arguments)
  if (status === 'preparing' || status === 'running')
    return (
      <CompoundCardPhase
        tc={tc}
        displayName={displayName}
        meta={TAVILY_META}
        argsSummary={argsSummary}
        phase={status}
      />
    )
  return (
    <CompoundCardDone
      tc={tc}
      displayName={displayName}
      meta={TAVILY_META}
      argsSummary={argsSummary}
    />
  )
}, propsEq)

/* ═══════ 注册 ═══════ */

registerToolRender('prizm_search', (props) => <SearchToolCard tc={props.tc} />)
registerToolRender('prizm_knowledge', (props) => <KnowledgeToolCard tc={props.tc} />)
registerToolRender('prizm_lock', (props) => <LockToolCard tc={props.tc} />)
registerToolRender('prizm_promote_file', (props) => <PromoteFileToolCard tc={props.tc} />)
registerToolRender('prizm_tool_guide', (props) => <ToolGuideCard tc={props.tc} />)
registerToolRender('tavily_web_search', (props) => <TavilyToolCard tc={props.tc} />)

// 旧工具名兼容
const LEGACY_SEARCH = ['prizm_scope_stats', 'prizm_list_memories', 'prizm_search_memories'] as const
for (const name of LEGACY_SEARCH) {
  registerToolRender(name, (props) => <SearchToolCard tc={props.tc} />)
}
const LEGACY_KNOWLEDGE = [
  'prizm_search_docs_by_memory',
  'prizm_get_document_memories',
  'prizm_document_versions',
  'prizm_find_related_documents'
] as const
for (const name of LEGACY_KNOWLEDGE) {
  registerToolRender(name, (props) => <KnowledgeToolCard tc={props.tc} />)
}
const LEGACY_LOCK = [
  'prizm_checkout_document',
  'prizm_checkin_document',
  'prizm_claim_todo_list',
  'prizm_set_active_todo',
  'prizm_release_todo_list',
  'prizm_resource_status'
] as const
for (const name of LEGACY_LOCK) {
  registerToolRender(name, (props) => <LockToolCard tc={props.tc} />)
}
