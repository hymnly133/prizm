/**
 * CollabHub — collaboration overview panel (landing view).
 *
 * Four QuickCards showing actionable data for each module:
 * - Recent Agent sessions
 * - Active workflow runs (with MiniPipeline preview)
 * - Active background tasks
 * - Recently edited documents
 *
 * Statistics already shown on HomePage are intentionally excluded.
 */
import { memo, useMemo, useCallback } from 'react'
import { motion } from 'motion/react'
import { Icon } from '@lobehub/ui'
import { Tag } from 'antd'
import { ArrowRight, Bot, FileText, GitBranch, MessageSquare, Plus, Zap } from 'lucide-react'
import type { EnrichedSession, EnrichedDocument } from '@prizm/client-core'
import { isChatListSession, type WorkflowRun } from '@prizm/shared'
import { MiniPipelineView } from '../workflow/WorkflowPipelineView'

/** Panel keys used by CollabHub "view all" navigation. */
export type HubNavigatePanel = 'agent' | 'document' | 'task' | 'workflow'
import { EmptyState } from '../ui/EmptyState'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { fadeUp, STAGGER_DELAY } from '../../theme/motionPresets'
import { formatRelativeTime } from '../../utils/formatRelativeTime'

export interface CollabHubProps {
  scope: string
  sessions: EnrichedSession[]
  sessionsLoading: boolean
  workflowRuns: WorkflowRun[]
  workflowLoading: boolean
  bgSessions: EnrichedSession[]
  documents: EnrichedDocument[]
  documentsLoading: boolean
  onNavigatePanel: (panel: HubNavigatePanel) => void
  onLoadSession: (id: string) => void
  onSelectWorkflowRun?: (runId: string) => void
  onSelectDocument: (docId: string) => void
  onNewSession: () => void
  onNewDocument?: () => void
  onRefresh?: () => void
}

export const CollabHub = memo(function CollabHub({
  scope,
  sessions,
  sessionsLoading,
  workflowRuns,
  workflowLoading,
  bgSessions,
  documents,
  documentsLoading,
  onNavigatePanel,
  onLoadSession,
  onSelectWorkflowRun,
  onSelectDocument,
  onNewSession,
  onNewDocument,
  onRefresh
}: CollabHubProps) {
  const recentSessions = useMemo(
    () => sessions.filter((s) => isChatListSession(s)).slice(0, 5),
    [sessions]
  )

  const activeWorkflows = useMemo(
    () => workflowRuns.filter((r) => r.status === 'running' || r.status === 'paused').slice(0, 4),
    [workflowRuns]
  )

  const activeTasks = useMemo(
    () => bgSessions.filter((s) => s.bgStatus === 'running' || s.bgStatus === 'pending'),
    [bgSessions]
  )
  const completedTasks = useMemo(
    () => bgSessions.filter((s) => s.bgStatus === 'completed' || s.bgStatus === 'failed'),
    [bgSessions]
  )

  const recentDocs = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [documents]
  )

  let idx = 0

  return (
    <div className="collab-hub">
      {/* Header */}
      <motion.div className="collab-hub__header" {...fadeUp(idx++ * STAGGER_DELAY)}>
        <div>
          <h2 className="collab-hub__title">协作中心</h2>
          <Tag color="blue" style={{ marginTop: 2 }}>
            {scope || 'default'}
          </Tag>
        </div>
        {onRefresh && <RefreshIconButton onClick={onRefresh} title="刷新所有" />}
      </motion.div>

      {/* Quick cards grid */}
      <div className="collab-hub__grid">
        {/* Agent Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
        >
          <div className="content-card__header">
            <Bot size={16} />
            <span>Agent 会话</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
              <Tag>
                {sessionsLoading ? '...' : sessions.filter((s) => isChatListSession(s)).length}
              </Tag>
              <button type="button" className="collab-hub__link-btn" onClick={onNewSession}>
                <Plus size={12} /> 新建
              </button>
            </span>
          </div>
          <div className="content-card__body">
            {recentSessions.length === 0 ? (
              <EmptyState description="暂无会话" />
            ) : (
              <ul className="collab-hub__list">
                {recentSessions.map((s) => (
                  <li
                    key={s.id}
                    className="collab-hub__list-item collab-hub__list-item--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onLoadSession(s.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onLoadSession(s.id)}
                  >
                    <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span className="collab-hub__list-text">
                      {s.llmSummary?.trim() || '新会话'}
                    </span>
                    <span className="collab-hub__list-time">{formatRelativeTime(s.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <ViewAllButton onClick={() => onNavigatePanel('agent')} />
          </div>
        </motion.div>

        {/* Workflow Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
        >
          <div className="content-card__header">
            <GitBranch size={16} />
            <span>工作流</span>
            <Tag style={{ marginLeft: 'auto' }}>
              {workflowLoading ? '...' : `${activeWorkflows.length} 活跃`}
            </Tag>
          </div>
          <div className="content-card__body">
            {activeWorkflows.length === 0 ? (
              <EmptyState description="暂无活跃工作流" />
            ) : (
              <ul className="collab-hub__list">
                {activeWorkflows.map((r) => (
                  <li
                    key={r.id}
                    className="collab-hub__list-item collab-hub__list-item--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectWorkflowRun?.(r.id)}
                    onKeyDown={(e) =>
                      (e.key === 'Enter' || e.key === ' ') && onSelectWorkflowRun?.(r.id)
                    }
                  >
                    <span className="collab-hub__list-text">{r.workflowName}</span>
                    <MiniPipelineView stepResults={r.stepResults} />
                  </li>
                ))}
              </ul>
            )}
            <ViewAllButton onClick={() => onNavigatePanel('workflow')} />
          </div>
        </motion.div>

        {/* Task Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
        >
          <div className="content-card__header">
            <Zap size={16} />
            <span>后台任务</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {activeTasks.length > 0 && <Tag color="processing">{activeTasks.length} 运行中</Tag>}
              {completedTasks.length > 0 && <Tag>{completedTasks.length} 已完成</Tag>}
              {bgSessions.length === 0 && <Tag>0</Tag>}
            </span>
          </div>
          <div className="content-card__body">
            {bgSessions.length === 0 ? (
              <EmptyState description="暂无后台任务" />
            ) : (
              <ul className="collab-hub__list">
                {bgSessions.slice(0, 4).map((s) => (
                  <li
                    key={s.id}
                    className="collab-hub__list-item collab-hub__list-item--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onLoadSession(s.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onLoadSession(s.id)}
                  >
                    <Zap size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span className="collab-hub__list-text">
                      {s.bgMeta?.label ?? s.id.slice(0, 8)}
                    </span>
                    <span
                      className="collab-hub__status-tag"
                      style={{
                        background: bgStatusBg(s.bgStatus ?? 'pending'),
                        color: bgStatusColor(s.bgStatus ?? 'pending')
                      }}
                    >
                      {bgStatusLabel(s.bgStatus ?? 'pending')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ViewAllButton onClick={() => onNavigatePanel('task')} />
          </div>
        </motion.div>

        {/* Document Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
        >
          <div className="content-card__header">
            <FileText size={16} />
            <span>文档</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
              <Tag>{documentsLoading ? '...' : documents.length}</Tag>
              {onNewDocument && (
                <button type="button" className="collab-hub__link-btn" onClick={onNewDocument}>
                  <Plus size={12} /> 新建
                </button>
              )}
            </span>
          </div>
          <div className="content-card__body">
            {recentDocs.length === 0 ? (
              <EmptyState description="暂无文档" />
            ) : (
              <ul className="collab-hub__list">
                {recentDocs.map((d) => (
                  <li
                    key={d.id}
                    className="collab-hub__list-item collab-hub__list-item--clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectDocument(d.id)}
                    onKeyDown={(e) =>
                      (e.key === 'Enter' || e.key === ' ') && onSelectDocument(d.id)
                    }
                  >
                    <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span className="collab-hub__list-text">{d.title || '未命名'}</span>
                    <span className="collab-hub__list-time">{formatRelativeTime(d.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <ViewAllButton onClick={() => onNavigatePanel('document')} />
          </div>
        </motion.div>
      </div>
    </div>
  )
})

/* ── Shared tiny components ── */

function ViewAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="collab-hub__view-all" onClick={onClick}>
      查看全部 <ArrowRight size={12} />
    </button>
  )
}

function bgStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'var(--ant-color-primary)'
    case 'completed':
      return 'var(--ant-color-success)'
    case 'failed':
      return 'var(--ant-color-error)'
    case 'timeout':
    case 'interrupted':
      return 'var(--ant-color-warning)'
    default:
      return 'var(--ant-color-text-tertiary)'
  }
}

function bgStatusBg(status: string): string {
  switch (status) {
    case 'running':
      return 'var(--ant-color-primary-bg)'
    case 'completed':
      return 'var(--ant-color-success-bg)'
    case 'failed':
      return 'var(--ant-color-error-bg)'
    case 'timeout':
    case 'interrupted':
      return 'var(--ant-color-warning-bg)'
    default:
      return 'var(--ant-color-fill-tertiary)'
  }
}

function bgStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'pending':
      return '等待'
    case 'timeout':
      return '超时'
    case 'cancelled':
      return '已取消'
    case 'interrupted':
      return '已中断'
    default:
      return status
  }
}
