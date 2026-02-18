/**
 * 会话活动时间线：最近工具调用、上下文引用、Scope 操作
 */
import { Wrench, FileText, BookOpen, ExternalLink, Lock } from 'lucide-react'
import { getToolDisplayName } from '@prizm/client-core'
import type { ToolCallRecord, ResourceLockInfo } from '@prizm/client-core'
import { useNavigation } from '../../context/NavigationContext'
import type { ActivityItem } from './agentSidebarTypes'
import { ACTION_CONFIG } from './agentSidebarTypes'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'

export interface SessionActivityTimelineProps {
  currentSession: { id: string } | null
  sessionContext: {
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null
  sessionContextLoading: boolean
  latestToolCalls: ToolCallRecord[]
  provisionsSummary: string | null
  /** 当前会话持有的锁列表 */
  sessionLocks?: ResourceLockInfo[]
}

export function SessionActivityTimeline({
  currentSession,
  sessionContext,
  sessionContextLoading,
  latestToolCalls,
  provisionsSummary,
  sessionLocks
}: SessionActivityTimelineProps) {
  const { navigateToDocs } = useNavigation()
  if (!currentSession) {
    return <EmptyState description="选择会话后显示" />
  }
  if (sessionContextLoading && !sessionContext) {
    return <LoadingPlaceholder />
  }

  const docLocks = (sessionLocks ?? []).filter((l) => l.resourceType === 'document')

  return (
    <div className="agent-session-activity">
      {/* 已签出文档 */}
      {docLocks.length > 0 && (
        <div className="agent-activity-group">
          <span className="agent-activity-group-label">
            <Lock size={12} />
            已签出文档
          </span>
          <ul className="agent-activity-list">
            {docLocks.map((lock) => (
              <li
                key={lock.id}
                className="agent-activity-item agent-activity-item-clickable"
                onClick={() => navigateToDocs(lock.resourceId)}
                title={lock.reason || '点击查看文档'}
              >
                <FileText size={11} className="agent-activity-action-icon" />
                <span className="agent-activity-title">
                  {lock.reason
                    ? lock.reason.length > 20
                      ? `${lock.reason.slice(0, 20)}…`
                      : lock.reason
                    : lock.resourceId.slice(0, 12)}
                </span>
                <ExternalLink
                  size={10}
                  style={{ marginLeft: 'auto', opacity: 0.5, flexShrink: 0 }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 最近工具调用 */}
      {latestToolCalls.length > 0 && (
        <div className="agent-activity-group">
          <span className="agent-activity-group-label">
            <Wrench size={12} />
            最近工具调用
          </span>
          <ul className="agent-activity-list">
            {latestToolCalls.map((tc) => (
              <li
                key={tc.id}
                className={`agent-activity-item${tc.isError ? ' error' : ''}`}
                title={tc.result}
              >
                <span className="agent-activity-tool-name">
                  {getToolDisplayName(tc.name, tc.arguments)}
                </span>
                {tc.isError && <span className="agent-activity-badge error">失败</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 引用项概要 */}
      {provisionsSummary && (
        <div className="agent-activity-group">
          <span className="agent-activity-group-label">
            <FileText size={12} />
            上下文引用
          </span>
          <p className="agent-activity-summary">{provisionsSummary}</p>
        </div>
      )}

      {/* 活动时间线 */}
      {(sessionContext?.activities?.length ?? 0) > 0 && (
        <div className="agent-activity-group">
          <span className="agent-activity-group-label">
            <BookOpen size={12} />
            Scope 操作
          </span>
          <ul className="agent-activity-list">
            {(['create', 'update', 'delete', 'read', 'list', 'search'] as const).map((action) => {
              const items = (sessionContext?.activities ?? []).filter((s) => s.action === action)
              if (items.length === 0) return null
              const cfg = ACTION_CONFIG[action]
              const Icon = cfg.icon
              return items.map((si, i) => {
                const isDocItem = si.itemKind === 'document' && si.itemId
                return (
                  <li
                    key={`${action}-${si.itemId ?? 'n'}-${i}`}
                    className={`agent-activity-item${
                      isDocItem ? ' agent-activity-item-clickable' : ''
                    }`}
                    onClick={isDocItem ? () => navigateToDocs(si.itemId!) : undefined}
                  >
                    <Icon size={11} className="agent-activity-action-icon" />
                    <span className="agent-activity-action-label">{cfg.label}</span>
                    {si.itemKind && <span className="agent-activity-kind">{si.itemKind}</span>}
                    {si.title && (
                      <span className="agent-activity-title" title={si.title}>
                        {si.title.length > 16 ? `${si.title.slice(0, 16)}…` : si.title}
                      </span>
                    )}
                    {isDocItem && (
                      <ExternalLink
                        size={10}
                        style={{ marginLeft: 'auto', opacity: 0.5, flexShrink: 0 }}
                      />
                    )}
                  </li>
                )
              })
            })}
          </ul>
        </div>
      )}

      {/* 空状态 */}
      {docLocks.length === 0 &&
        latestToolCalls.length === 0 &&
        !provisionsSummary &&
        (sessionContext?.activities?.length ?? 0) === 0 && (
          <EmptyState description="本会话暂无活动" />
        )}
    </div>
  )
}
