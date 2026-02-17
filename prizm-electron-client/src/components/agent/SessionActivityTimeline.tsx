/**
 * 会话活动时间线：最近工具调用、上下文引用、Scope 操作
 */
import { Loader2, Wrench, FileText, BookOpen } from 'lucide-react'
import { getToolDisplayName } from '@prizm/client-core'
import type { ToolCallRecord } from '@prizm/client-core'
import type { ActivityItem } from './agentSidebarTypes'
import { ACTION_CONFIG } from './agentSidebarTypes'

export interface SessionActivityTimelineProps {
  currentSession: { id: string } | null
  sessionContext: {
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    activities: ActivityItem[]
  } | null
  sessionContextLoading: boolean
  latestToolCalls: ToolCallRecord[]
  provisionsSummary: string | null
}

export function SessionActivityTimeline({
  currentSession,
  sessionContext,
  sessionContextLoading,
  latestToolCalls,
  provisionsSummary
}: SessionActivityTimelineProps) {
  if (!currentSession) {
    return <p className="agent-right-empty">选择会话后显示</p>
  }
  if (sessionContextLoading && !sessionContext) {
    return (
      <div className="agent-right-loading">
        <Loader2 size={14} className="spinning" />
        <span>加载中</span>
      </div>
    )
  }

  return (
    <div className="agent-session-activity">
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
                  {getToolDisplayName(tc.name)}
                </span>
                {tc.isError && (
                  <span className="agent-activity-badge error">失败</span>
                )}
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
            {(['create', 'update', 'delete', 'read', 'list', 'search'] as const).map(
              (action) => {
                const items = (sessionContext?.activities ?? []).filter(
                  (s) => s.action === action
                )
                if (items.length === 0) return null
                const cfg = ACTION_CONFIG[action]
                const Icon = cfg.icon
                return items.map((si, i) => (
                  <li
                    key={`${action}-${si.itemId ?? i}`}
                    className="agent-activity-item"
                  >
                    <Icon size={11} className="agent-activity-action-icon" />
                    <span className="agent-activity-action-label">{cfg.label}</span>
                    {si.itemKind && (
                      <span className="agent-activity-kind">{si.itemKind}</span>
                    )}
                    {si.title && (
                      <span className="agent-activity-title" title={si.title}>
                        {si.title.length > 16
                          ? `${si.title.slice(0, 16)}…`
                          : si.title}
                      </span>
                    )}
                  </li>
                ))
              }
            )}
          </ul>
        </div>
      )}

      {/* 空状态 */}
      {latestToolCalls.length === 0 &&
        !provisionsSummary &&
        (sessionContext?.activities?.length ?? 0) === 0 && (
          <p className="agent-right-empty">本会话暂无活动</p>
        )}
    </div>
  )
}
