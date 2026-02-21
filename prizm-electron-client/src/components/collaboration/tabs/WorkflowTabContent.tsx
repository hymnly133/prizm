/**
 * WorkflowTabContent — single workflow-run detail for a tab.
 *
 * Fetches one WorkflowRun by ID and renders pipeline + step details inline
 * (without a modal wrapper).
 */
import { memo, useEffect, useState, useCallback, useMemo } from 'react'
import { Button, Descriptions, Tag, Timeline, Typography, Alert } from 'antd'
import { Bot, RefreshCw } from 'lucide-react'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'
import { useWorkflowStore } from '../../../store/workflowStore'
import { WorkflowPipelineView } from '../../workflow/WorkflowPipelineView'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { EmptyState } from '../../ui/EmptyState'
import type { TabContentProps } from '../CollabTabContent'
import { WORKFLOW_RUN_STATUS_META } from '../../workflow/workflowRunStatus'

const { Text, Paragraph } = Typography

export const WorkflowTabContent = memo(function WorkflowTabContent({
  entityId,
  onLoadSession
}: TabContentProps) {
  const getRunDetail = useWorkflowStore((s) => s.getRunDetail)
  const resumeWorkflow = useWorkflowStore((s) => s.resumeWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRun = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const detail = await getRunDetail(entityId)
      setRun(detail)
    } finally {
      setLoading(false)
    }
  }, [entityId, getRunDetail])

  useEffect(() => {
    void fetchRun()
  }, [fetchRun])

  const handleApprove = useCallback(
    (token: string, approved: boolean) => {
      void resumeWorkflow(token, approved).then(() => void fetchRun())
    },
    [resumeWorkflow, fetchRun]
  )

  const stepEntries = useMemo(() => (run ? Object.entries(run.stepResults) : []), [run])

  if (!entityId) return <EmptyState description="缺少工作流运行 ID" />
  if (loading) return <LoadingPlaceholder />
  if (!run) return <EmptyState description="未找到工作流运行" />

  const meta = WORKFLOW_RUN_STATUS_META[run.status] ?? WORKFLOW_RUN_STATUS_META.pending

  return (
    <div className="collab-tab-entity-detail">
      <div className="collab-tab-entity-detail__header">
        <h3 className="collab-tab-entity-detail__title">{run.workflowName}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color={meta.color} icon={meta.icon}>
            {meta.label}
          </Tag>
          <Button
            size="small"
            type="text"
            icon={<RefreshCw size={12} />}
            onClick={() => void fetchRun()}
          />
        </div>
      </div>

      <WorkflowPipelineView run={run} onApprove={handleApprove} />

      <Descriptions column={1} size="small" bordered style={{ margin: '12px 0' }}>
        <Descriptions.Item label="运行 ID">
          <code style={{ fontSize: 11 }}>{run.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="步骤数">{stepEntries.length}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(run.createdAt).toLocaleString()}
        </Descriptions.Item>
      </Descriptions>

      {run.status === 'running' && (
        <Button
          size="small"
          danger
          onClick={() => {
            void cancelRun(run.id).then(() => void fetchRun())
          }}
          style={{ marginBottom: 12 }}
        >
          取消运行
        </Button>
      )}

      {run.error && (
        <Alert
          type="error"
          message="运行错误"
          description={run.error}
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {stepEntries.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
            步骤详情
          </Text>
          <Timeline
            items={stepEntries.map(([stepId, result]) => {
              const stepMeta =
                WORKFLOW_RUN_STATUS_META[result?.status ?? 'pending'] ??
                WORKFLOW_RUN_STATUS_META.pending
              return {
                dot: stepMeta.icon,
                children: (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text strong>{stepId}</Text>
                      <Tag color={stepMeta.color}>{stepMeta.label}</Tag>
                      {result?.sessionId && (
                        <button
                          type="button"
                          className="collab-ref-chip"
                          onClick={() => onLoadSession?.(result.sessionId!)}
                        >
                          <Bot size={10} />
                          会话
                        </button>
                      )}
                    </div>
                    {result?.output && (
                      <Paragraph
                        type="secondary"
                        ellipsis={{ rows: 3, expandable: true }}
                        style={{ fontSize: 12, marginBottom: 0 }}
                      >
                        {typeof result.output === 'string'
                          ? result.output
                          : JSON.stringify(result.output, null, 2)}
                      </Paragraph>
                    )}
                    {result?.error && (
                      <Text type="danger" style={{ fontSize: 12 }}>
                        {result.error}
                      </Text>
                    )}
                  </div>
                )
              }
            })}
          />
        </div>
      )}
    </div>
  )
})
