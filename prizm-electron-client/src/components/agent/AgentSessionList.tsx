/**
 * AgentSessionList — 会话列表侧边栏内容（共享组件）
 *
 * 被 AgentPage 和 CollaborationPage 的 AgentPane 共同使用。
 * 支持可选的"总览"标签页和可选的侧边栏 header。
 */
import { ActionIcon, Empty } from '@lobehub/ui'
import { AccentList } from '../ui/AccentList'
import { LayoutDashboard, Plus, Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { EnrichedSession } from '@prizm/client-core'

export interface AgentSessionListProps {
  sessions: EnrichedSession[]
  activeSessionId?: string
  loading: boolean
  pendingInteractSessionIds: Set<string>
  onDeleteSession: (id: string) => void
  onLoadSession: (id: string) => void
  /** 是否显示侧边栏头部（包含标题和新建按钮） */
  showHeader?: boolean
  onNewSession?: () => void
  /** 是否显示总览标签 */
  showOverviewTab?: boolean
  overviewActive?: boolean
  onOverviewClick?: () => void
}

export const AgentSessionList = memo(function AgentSessionList({
  sessions,
  activeSessionId,
  loading,
  pendingInteractSessionIds,
  onDeleteSession,
  onLoadSession,
  showHeader = true,
  onNewSession,
  showOverviewTab,
  overviewActive,
  onOverviewClick
}: AgentSessionListProps) {
  const sessionListItems = useMemo(
    () =>
      sessions.map((s) => {
        const needsInteract = pendingInteractSessionIds.has(s.id)
        return {
          key: s.id,
          title: (
            <>
              {needsInteract && <span className="agent-session-interact-badge" title="需要确认" />}
              {s.llmSummary?.trim() || '新会话'}
            </>
          ),
          actions: (
            <ActionIcon
              icon={Trash2}
              title="删除"
              size="small"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onDeleteSession(s.id)
              }}
            />
          ),
          showAction: true,
          onClick: () => onLoadSession(s.id)
        }
      }),
    [sessions, pendingInteractSessionIds, onDeleteSession, onLoadSession]
  )

  return (
    <div className="agent-sidebar">
      {showHeader && (
        <div className="agent-sidebar-header">
          <span className="agent-sidebar-title">会话</span>
          {onNewSession && (
            <ActionIcon
              icon={Plus}
              title="新建会话"
              onClick={onNewSession}
              disabled={loading}
            />
          )}
        </div>
      )}
      <div className="agent-sessions-list">
        {showOverviewTab && (
          <div
            className={`agent-overview-tab${overviewActive ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={onOverviewClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onOverviewClick?.()
            }}
          >
            <LayoutDashboard size={14} />
            <span>总览</span>
          </div>
        )}
        {loading && sessions.length === 0 ? (
          <div className="agent-sessions-loading">加载中...</div>
        ) : sessions.length === 0 ? (
          <Empty title="暂无会话" description={showHeader ? '点击 + 新建会话' : '点击 + 新建'} />
        ) : (
          <AccentList activeKey={activeSessionId} items={sessionListItems} />
        )}
      </div>
    </div>
  )
})
