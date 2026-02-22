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
import { AccentList } from '../ui/AccentList'
import { EmptyState } from '../ui/EmptyState'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { fadeUp, getReducedMotionProps, STAGGER_DELAY } from '../../theme/motionPresets'
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

  const sessionListItems = useMemo(
    () =>
      recentSessions.map((s) => ({
        key: s.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {s.llmSummary?.trim() || '新会话'}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {formatRelativeTime(s.updatedAt)}
            </span>
          </span>
        ),
        onClick: () => onLoadSession(s.id)
      })),
    [recentSessions, onLoadSession]
  )

  const workflowListItems = useMemo(
    () =>
      activeWorkflows.map((r) => ({
        key: r.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {r.workflowName}
            </span>
            <MiniPipelineView stepResults={r.stepResults} />
          </span>
        ),
        onClick: () => onSelectWorkflowRun?.(r.id)
      })),
    [activeWorkflows, onSelectWorkflowRun]
  )

  const taskListItems = useMemo(
    () =>
      bgSessions.slice(0, 4).map((s) => ({
        key: s.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Zap size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {s.bgMeta?.label ?? s.id.slice(0, 8)}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 3,
                background: bgStatusBg(s.bgStatus ?? 'pending'),
                color: bgStatusColor(s.bgStatus ?? 'pending'),
                flexShrink: 0
              }}
            >
              {bgStatusLabel(s.bgStatus ?? 'pending')}
            </span>
          </span>
        ),
        onClick: () => onLoadSession(s.id)
      })),
    [bgSessions, onLoadSession]
  )

  const documentListItems = useMemo(
    () =>
      recentDocs.map((d) => ({
        key: d.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {d.title || '未命名'}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {formatRelativeTime(d.updatedAt)}
            </span>
          </span>
        ),
        onClick: () => onSelectDocument(d.id)
      })),
    [recentDocs, onSelectDocument]
  )

  let idx = 0

  return (
    <div className="collab-hub">
      {/* Header */}
      <motion.div className="collab-hub__header" {...fadeUp(idx++ * STAGGER_DELAY)} {...getReducedMotionProps()}>
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
          {...getReducedMotionProps()}
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
              <AccentList items={sessionListItems} />
            )}
            <ViewAllButton onClick={() => onNavigatePanel('agent')} />
          </div>
        </motion.div>

        {/* Workflow Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
          {...getReducedMotionProps()}
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
              <AccentList items={workflowListItems} />
            )}
            <ViewAllButton onClick={() => onNavigatePanel('workflow')} />
          </div>
        </motion.div>

        {/* Task Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
          {...getReducedMotionProps()}
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
              <AccentList items={taskListItems} />
            )}
            <ViewAllButton onClick={() => onNavigatePanel('task')} />
          </div>
        </motion.div>

        {/* Document Card */}
        <motion.div
          className="content-card content-card--default content-card--hoverable"
          {...fadeUp(idx++ * STAGGER_DELAY)}
          {...getReducedMotionProps()}
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
              <AccentList items={documentListItems} />
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
