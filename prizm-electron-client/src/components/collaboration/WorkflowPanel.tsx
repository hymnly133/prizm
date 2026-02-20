/**
 * WorkflowPanel — workflow management panel for the Collaboration page.
 *
 * Lists workflow runs (from workflowStore), shows pipeline visualisation,
 * and supports approve/reject for paused workflows.
 * Falls back gracefully when the backend has no workflow data.
 */
import { memo, useState, useCallback, useEffect, useMemo } from 'react'
import { Tag, Button, Space, Tooltip, Modal } from 'antd'
import { Bot, GitBranch, Pencil, Plus, RefreshCw } from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import type { WorkflowRun, WorkflowDefRecord } from '@prizm/shared'
import { useWorkflowStore } from '../../store/workflowStore'
import { WorkflowPipelineView } from '../workflow/WorkflowPipelineView'
import { WorkflowRunDetail } from '../workflow/WorkflowRunDetail'
import { WorkflowEditor } from '../workflow/editor'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { SectionHeader } from '../ui/SectionHeader'
import { useCollabInteraction } from '../../hooks/useCollabInteraction'

export interface WorkflowPanelProps {
  onLoadSession?: (sessionId: string) => void
}

export const WorkflowPanel = memo(function WorkflowPanel({ onLoadSession }: WorkflowPanelProps) {
  const runs = useWorkflowStore((s) => s.runs)
  const defs = useWorkflowStore((s) => s.defs)
  const loading = useWorkflowStore((s) => s.loading)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const resumeWorkflow = useWorkflowStore((s) => s.resumeWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)

  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const [editorDef, setEditorDef] = useState<WorkflowDefRecord | null>(null)
  const [showNewEditor, setShowNewEditor] = useState(false)

  useEffect(() => {
    void refreshRuns()
    void refreshDefs()
  }, [refreshRuns, refreshDefs])

  const activeRuns = useMemo(
    () => runs.filter((r) => r.status === 'running' || r.status === 'paused'),
    [runs]
  )
  const completedRuns = useMemo(
    () => runs.filter((r) => r.status !== 'running' && r.status !== 'paused' && r.status !== 'pending'),
    [runs]
  )

  const handleApprove = useCallback(
    (token: string, approved: boolean) => {
      void resumeWorkflow(token, approved)
    },
    [resumeWorkflow]
  )

  const handleCancel = useCallback(
    (runId: string) => {
      void cancelRun(runId)
    },
    [cancelRun]
  )

  const handleEditorSave = useCallback(
    async (name: string, yaml: string, description?: string) => {
      await registerDef(name, yaml, description)
    },
    [registerDef]
  )

  const handleEditorRun = useCallback(
    (name: string) => { void runWorkflow({ workflow_name: name }) },
    [runWorkflow]
  )

  return (
    <div className="collab-workflow-panel">
      {/* Definitions section */}
      <div className="collab-panel-toolbar">
        <SectionHeader icon={GitBranch} title="工作流定义" count={defs.length} />
        <Space size={4}>
          <ActionIcon icon={Plus} size="small" title="新建工作流" onClick={() => setShowNewEditor(true)} />
          <RefreshIconButton onClick={() => { void refreshRuns(); void refreshDefs() }} disabled={loading} title="刷新" />
        </Space>
      </div>

      {defs.length > 0 && (
        <div className="collab-workflow-panel__defs">
          {defs.map((def) => (
            <div key={def.id} className="collab-workflow-def-chip">
              <span className="collab-workflow-def-chip__name">{def.name}</span>
              <ActionIcon icon={Pencil} size={14} title="编辑" onClick={() => setEditorDef(def)} />
            </div>
          ))}
        </div>
      )}

      {/* Runs section */}
      <div className="collab-panel-toolbar" style={{ marginTop: 8 }}>
        <SectionHeader icon={GitBranch} title="运行记录" count={runs.length} />
      </div>

      {loading && runs.length === 0 ? (
        <div style={{ padding: 24 }}><LoadingPlaceholder /></div>
      ) : runs.length === 0 ? (
        <div style={{ padding: 48 }}>
          <EmptyState icon={GitBranch} description="暂无工作流运行记录" />
        </div>
      ) : (
        <div className="collab-workflow-panel__body">
          {activeRuns.length > 0 && (
            <div className="collab-workflow-section">
              <h4 className="collab-workflow-section__title">
                活跃 <Tag color="processing">{activeRuns.length}</Tag>
              </h4>
              {activeRuns.map((run) => (
                <WorkflowRunCard
                  key={run.id}
                  run={run}
                  onViewDetail={setDetailRunId}
                  onApprove={handleApprove}
                  onCancel={handleCancel}
                />
              ))}
            </div>
          )}

          {completedRuns.length > 0 && (
            <div className="collab-workflow-section">
              <h4 className="collab-workflow-section__title">
                历史 <Tag>{completedRuns.length}</Tag>
              </h4>
              {completedRuns.slice(0, 20).map((run) => (
                <WorkflowRunCard
                  key={run.id}
                  run={run}
                  onViewDetail={setDetailRunId}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <WorkflowRunDetail
        runId={detailRunId}
        open={!!detailRunId}
        onClose={() => setDetailRunId(null)}
        onLoadSession={onLoadSession}
      />

      {/* Editor modals */}
      <Modal
        open={!!editorDef}
        onCancel={() => setEditorDef(null)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        {editorDef && (
          <WorkflowEditor
            defRecord={editorDef}
            onSave={handleEditorSave}
            onRun={handleEditorRun}
            onClose={() => setEditorDef(null)}
          />
        )}
      </Modal>

      <Modal
        open={showNewEditor}
        onCancel={() => setShowNewEditor(false)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        <WorkflowEditor
          onSave={handleEditorSave}
          onRun={handleEditorRun}
          onClose={() => setShowNewEditor(false)}
        />
      </Modal>
    </div>
  )
})

/* ── Run card ── */

const STATUS_COLORS: Record<string, string> = {
  running: 'processing',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
  pending: 'default'
}

function WorkflowRunCard({
  run,
  onViewDetail,
  onApprove,
  onCancel
}: {
  run: WorkflowRun
  onViewDetail: (id: string) => void
  onApprove?: (token: string, approved: boolean) => void
  onCancel?: (id: string) => void
}) {
  const { jumpToSession } = useCollabInteraction()
  const steps = Object.keys(run.stepResults).length
  const tagColor = STATUS_COLORS[run.status] ?? 'default'

  const stepSessionIds = useMemo(() => {
    const ids: Array<{ stepId: string; sessionId: string }> = []
    for (const [stepId, result] of Object.entries(run.stepResults)) {
      if (result?.sessionId) {
        ids.push({ stepId, sessionId: result.sessionId })
      }
    }
    return ids
  }, [run.stepResults])

  return (
    <div
      className="collab-workflow-card"
      role="button"
      tabIndex={0}
      onClick={() => onViewDetail(run.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onViewDetail(run.id)}
    >
      <div className="collab-workflow-card__top">
        <span className="collab-workflow-card__name">{run.workflowName}</span>
        <Tag color={tagColor}>{run.status}</Tag>
      </div>
      <WorkflowPipelineView run={run} onApprove={onApprove} compact />
      <div className="collab-workflow-card__meta">
        <span>{steps} 步骤</span>
        <span>{new Date(run.createdAt).toLocaleString()}</span>
        {run.status === 'running' && onCancel && (
          <Button
            size="small"
            danger
            type="text"
            onClick={(e) => {
              e.stopPropagation()
              onCancel(run.id)
            }}
          >
            取消
          </Button>
        )}
      </div>

      {/* Reverse references: step → session */}
      {stepSessionIds.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {stepSessionIds.map(({ stepId, sessionId }) => (
            <Tooltip key={stepId} title={`步骤 ${stepId} 的执行会话`}>
              <button
                type="button"
                className="collab-ref-chip"
                onClick={(e) => {
                  e.stopPropagation()
                  jumpToSession(sessionId)
                }}
              >
                <Bot size={10} />
                {stepId}: {sessionId.slice(0, 8)}…
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}
