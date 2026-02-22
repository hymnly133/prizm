/**
 * EntityListTab — browse-all list views that open items as new entity tabs.
 *
 * Three variants: DocumentListTab, TaskListTab, WorkflowListTab.
 * Each renders a compact list; clicking an item fires onOpenEntity
 * to open it as a dedicated entity tab.
 */
import { memo, useMemo, useCallback } from 'react'
import { Button, Tag } from 'antd'
import { Blocks, FileText, GitBranch, Zap } from 'lucide-react'
import type { EnrichedDocument } from '@prizm/client-core'
import type { TaskRun, WorkflowDefRecord, WorkflowRun } from '@prizm/shared'
import { useScopeDataStore } from '../../../store/scopeDataStore'
import { useTaskStore } from '../../../store/taskStore'
import { useWorkflowStore } from '../../../store/workflowStore'
import { AccentList } from '../../ui/AccentList'
import { EmptyState } from '../../ui/EmptyState'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { SectionHeader } from '../../ui/SectionHeader'
import { RefreshIconButton } from '../../ui/RefreshIconButton'
import { formatRelativeTime } from '../../../utils/formatRelativeTime'
import type { TabContentProps } from '../CollabTabContent'

/* ── Document List ── */

export const DocumentListTab = memo(function DocumentListTab({
  onOpenEntity
}: TabContentProps) {
  const documents = useScopeDataStore((s) => s.documents)
  const loading = useScopeDataStore((s) => s.documentsLoading)
  const refresh = useScopeDataStore((s) => s.refreshDocuments)

  const sorted = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt - a.updatedAt),
    [documents]
  )

  const handleOpen = useCallback(
    (doc: EnrichedDocument) => {
      onOpenEntity?.('document', doc.id, doc.title || '未命名文档')
    },
    [onOpenEntity]
  )

  const documentListItems = useMemo(
    () =>
      sorted.map((doc) => ({
        key: doc.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <FileText size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.title || '未命名'}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>
              {formatRelativeTime(doc.updatedAt)}
            </span>
          </span>
        ),
        onClick: () => handleOpen(doc)
      })),
    [sorted, handleOpen]
  )

  return (
    <div className="collab-tab-list">
      <div className="collab-tab-list__toolbar">
        <SectionHeader icon={FileText} title="文档" count={documents.length} />
        <RefreshIconButton onClick={() => void refresh()} disabled={loading} />
      </div>
      <div className="collab-tab-list__body">
        {loading && documents.length === 0 ? (
          <LoadingPlaceholder />
        ) : sorted.length === 0 ? (
          <EmptyState icon={FileText} description="暂无文档" />
        ) : (
          <AccentList items={documentListItems} />
        )}
      </div>
    </div>
  )
})

/* ── Task List ── */

export const TaskListTab = memo(function TaskListTab({
  onOpenEntity,
  onLoadSession
}: TabContentProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const refresh = useTaskStore((s) => s.refreshTasks)

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => b.createdAt - a.createdAt),
    [tasks]
  )

  const handleOpen = useCallback(
    (t: TaskRun) => {
      onOpenEntity?.('task', t.id, t.label ?? t.id.slice(0, 12))
    },
    [onOpenEntity]
  )

  const taskListItems = useMemo(
    () =>
      sorted.map((t) => ({
        key: t.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Zap size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.label ?? t.id.slice(0, 8)}
            </span>
            <TaskStatusTag status={t.status} />
          </span>
        ),
        onClick: () => handleOpen(t)
      })),
    [sorted, handleOpen]
  )

  return (
    <div className="collab-tab-list">
      <div className="collab-tab-list__toolbar">
        <SectionHeader icon={Zap} title="任务" count={tasks.length} />
        <RefreshIconButton onClick={() => void refresh()} disabled={loading} />
      </div>
      <div className="collab-tab-list__body">
        {loading && tasks.length === 0 ? (
          <LoadingPlaceholder />
        ) : sorted.length === 0 ? (
          <EmptyState icon={Zap} description="暂无任务" />
        ) : (
          <AccentList items={taskListItems} />
        )}
      </div>
    </div>
  )
})

function TaskStatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'processing', completed: 'success', failed: 'error',
    pending: 'default', timeout: 'warning', cancelled: 'default'
  }
  const labels: Record<string, string> = {
    running: '运行中', completed: '完成', failed: '失败',
    pending: '等待', timeout: '超时', cancelled: '已取消'
  }
  return <Tag color={colors[status] ?? 'default'} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>{labels[status] ?? status}</Tag>
}

/* ── Workflow List (definitions + runs) ── */

export const WorkflowListTab = memo(function WorkflowListTab({
  onOpenEntity,
  onLoadSession
}: TabContentProps) {
  const defs = useWorkflowStore((s) => s.defs)
  const runs = useWorkflowStore((s) => s.runs)
  const loading = useWorkflowStore((s) => s.loading)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)

  const sortedDefs = useMemo(
    () => [...defs].sort((a, b) => b.updatedAt - a.updatedAt),
    [defs]
  )

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.createdAt - a.createdAt),
    [runs]
  )

  const handleOpenDef = useCallback(
    (d: WorkflowDefRecord) => {
      onOpenEntity?.('workflow-def', d.id, d.name)
    },
    [onOpenEntity]
  )

  const handleOpenRun = useCallback(
    (r: WorkflowRun) => {
      onOpenEntity?.('workflow', r.id, r.workflowName)
    },
    [onOpenEntity]
  )

  const handleRefresh = useCallback(() => {
    void Promise.all([refreshDefs(), refreshRuns()])
  }, [refreshDefs, refreshRuns])

  const defListItems = useMemo(
    () =>
      sortedDefs.map((d) => ({
        key: d.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Blocks size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>
              {formatRelativeTime(d.updatedAt)}
            </span>
          </span>
        ),
        onClick: () => handleOpenDef(d)
      })),
    [sortedDefs, handleOpenDef]
  )

  const runListItems = useMemo(
    () =>
      sortedRuns.map((r) => ({
        key: r.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <GitBranch size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.workflowName}
            </span>
            <TaskStatusTag status={r.status} />
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </span>
        ),
        onClick: () => handleOpenRun(r)
      })),
    [sortedRuns, handleOpenRun]
  )

  return (
    <div className="collab-tab-list">
      <div className="collab-tab-list__toolbar">
        <SectionHeader icon={GitBranch} title="工作流" count={defs.length + runs.length} />
        <RefreshIconButton onClick={handleRefresh} disabled={loading} />
      </div>
      <div className="collab-tab-list__body">
        {loading && defs.length === 0 && runs.length === 0 ? (
          <LoadingPlaceholder />
        ) : defs.length === 0 && runs.length === 0 ? (
          <EmptyState icon={GitBranch} description="暂无工作流" />
        ) : (
          <>
            {sortedDefs.length > 0 && (
              <div className="collab-tab-list__section">
                <div className="collab-tab-list__section-header">
                  <Blocks size={12} style={{ opacity: 0.5 }} />
                  <span>定义 ({sortedDefs.length})</span>
                </div>
                <AccentList items={defListItems} />
              </div>
            )}
            {sortedRuns.length > 0 && (
              <div className="collab-tab-list__section">
                <div className="collab-tab-list__section-header">
                  <GitBranch size={12} style={{ opacity: 0.5 }} />
                  <span>运行记录 ({sortedRuns.length})</span>
                </div>
                <AccentList items={runListItems} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
