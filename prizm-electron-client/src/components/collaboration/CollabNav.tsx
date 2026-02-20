/**
 * CollabNav — left sidebar for the session-first Collaboration page.
 *
 * Top: Session list (interactive sessions + background tasks grouped)
 * Bottom: Quick-access buttons to open Document / Task / Workflow in right panel
 */
import { memo, useMemo, useCallback } from 'react'
import { ActionIcon, Icon } from '@lobehub/ui'
import {
  Bot,
  FileText,
  GitBranch,
  LayoutDashboard,
  Plus,
  Zap
} from 'lucide-react'
import type { EnrichedSession, EnrichedDocument } from '@prizm/client-core'
import type { WorkflowRun } from '@prizm/shared'
import type { RightPanelTab } from './collabTypes'
import { AccentList } from '../ui/AccentList'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { SectionHeader } from '../ui/SectionHeader'

export interface CollabNavProps {
  /* Session data */
  sessions: EnrichedSession[]
  activeSessionId?: string
  sessionsLoading: boolean
  pendingInteractSessionIds: Set<string>
  onLoadSession: (id: string) => void
  onNewSession: () => void

  /* Background sessions */
  bgSessions: EnrichedSession[]
  bgLoading: boolean

  /* Right panel state */
  rightPanelOpen: boolean
  rightPanelTab: RightPanelTab
  onOpenRightPanel: (tab: RightPanelTab) => void
  onToggleRightPanel: (tab: RightPanelTab) => void

  /* Hub */
  onOpenHub?: () => void

  /* Badge counts */
  documentCount?: number
  activeTaskCount?: number
  activeWorkflowCount?: number
}

export const CollabNav = memo(function CollabNav({
  sessions,
  activeSessionId,
  sessionsLoading,
  pendingInteractSessionIds,
  onLoadSession,
  onNewSession,
  bgSessions,
  bgLoading,
  rightPanelOpen,
  rightPanelTab,
  onOpenRightPanel,
  onToggleRightPanel,
  onOpenHub,
  documentCount,
  activeTaskCount,
  activeWorkflowCount
}: CollabNavProps) {
  const interactiveSessions = useMemo(
    () => sessions.filter((s) => s.kind !== 'background'),
    [sessions]
  )

  const bgSessionItems = useMemo(
    () =>
      bgSessions.map((s) => ({
        key: s.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Zap size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {s.bgMeta?.label ?? s.llmSummary?.trim() ?? s.id.slice(0, 8)}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 3,
                background: statusBg(s.bgStatus ?? 'pending'),
                color: statusColor(s.bgStatus ?? 'pending'),
                flexShrink: 0
              }}
            >
              {statusLabel(s.bgStatus ?? 'pending')}
            </span>
          </span>
        ),
        showAction: false,
        onClick: () => onLoadSession(s.id)
      })),
    [bgSessions, onLoadSession]
  )

  const sessionItems = useMemo(
    () =>
      interactiveSessions.map((s) => {
        const needsInteract = pendingInteractSessionIds.has(s.id)
        return {
          key: s.id,
          title: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {needsInteract && <span className="agent-session-interact-badge" title="需要确认" />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.llmSummary?.trim() || '新会话'}
              </span>
            </span>
          ),
          showAction: false,
          onClick: () => onLoadSession(s.id)
        }
      }),
    [interactiveSessions, pendingInteractSessionIds, onLoadSession]
  )

  return (
    <div className="collab-nav">
      {/* Session list */}
      <div className="collab-nav__sessions">
        <div className="collab-nav__sub-header">
          <span className="collab-nav__sub-title">会话</span>
          <ActionIcon icon={Plus} title="新建会话" size="small" onClick={onNewSession} />
        </div>
        {sessionsLoading && sessions.length === 0 ? (
          <LoadingPlaceholder />
        ) : interactiveSessions.length === 0 ? (
          <EmptyState description="暂无会话" />
        ) : (
          <AccentList activeKey={activeSessionId} items={sessionItems} />
        )}

        {/* Background tasks section */}
        {bgSessions.length > 0 && (
          <>
            <div className="collab-nav__sub-header" style={{ marginTop: 8 }}>
              <span className="collab-nav__sub-title">后台任务</span>
            </div>
            <AccentList items={bgSessionItems} />
          </>
        )}
      </div>

      {/* Quick-access bottom buttons */}
      <div className="collab-nav__quick-access">
        <QuickAccessButton
          icon={FileText}
          label="文档"
          count={documentCount}
          active={rightPanelOpen && rightPanelTab === 'document'}
          onClick={() => onToggleRightPanel('document')}
        />
        <QuickAccessButton
          icon={Zap}
          label="任务"
          count={activeTaskCount}
          active={rightPanelOpen && rightPanelTab === 'task'}
          onClick={() => onToggleRightPanel('task')}
        />
        <QuickAccessButton
          icon={GitBranch}
          label="工作流"
          count={activeWorkflowCount}
          active={rightPanelOpen && rightPanelTab === 'workflow'}
          onClick={() => onToggleRightPanel('workflow')}
        />
        {onOpenHub && (
          <button
            type="button"
            className="collab-nav__hub-btn"
            onClick={onOpenHub}
            title="协作总览"
          >
            <LayoutDashboard size={14} />
          </button>
        )}
      </div>
    </div>
  )
})

/* ── Quick-access button ── */

function QuickAccessButton({
  icon: IconComp,
  label,
  count,
  active,
  onClick
}: {
  icon: React.FC<{ size?: number }>
  label: string
  count?: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`collab-nav__quick-btn${active ? ' collab-nav__quick-btn--active' : ''}`}
      onClick={onClick}
      title={label}
    >
      <IconComp size={14} />
      <span className="collab-nav__quick-btn-label">{label}</span>
      {count != null && count > 0 && (
        <span className="collab-nav__quick-btn-badge">{count}</span>
      )}
    </button>
  )
}

/* ── Status helpers ── */

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'var(--ant-color-primary)'
    case 'completed': return 'var(--ant-color-success)'
    case 'failed': return 'var(--ant-color-error)'
    case 'paused': case 'timeout': case 'interrupted': return 'var(--ant-color-warning)'
    default: return 'var(--ant-color-text-tertiary)'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'running': return 'var(--ant-color-primary-bg)'
    case 'completed': return 'var(--ant-color-success-bg)'
    case 'failed': return 'var(--ant-color-error-bg)'
    case 'paused': case 'timeout': case 'interrupted': return 'var(--ant-color-warning-bg)'
    default: return 'var(--ant-color-fill-tertiary)'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return '运行中'
    case 'completed': return '完成'
    case 'failed': return '失败'
    case 'paused': return '暂停'
    case 'pending': return '等待'
    case 'timeout': return '超时'
    case 'cancelled': return '已取消'
    case 'interrupted': return '已中断'
    default: return status
  }
}
