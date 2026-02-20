/**
 * WorkflowRunDetail — 工作流运行详情弹窗
 *
 * 展示完整流水线可视化、每步输入/输出、关联 BG Session 跳转。
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal, Tag, Typography, Descriptions, Timeline, Empty, Button, Space, Alert } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  MinusCircleOutlined
} from '@ant-design/icons'
import { WorkflowPipelineView } from './WorkflowPipelineView'
import { useWorkflowStore } from '../../store/workflowStore'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'

const { Text, Paragraph } = Typography

const STATUS_LABELS: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  pending: { color: 'default', label: '等待中', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', label: '运行中', icon: <ThunderboltOutlined /> },
  paused: { color: 'warning', label: '待审批', icon: <PauseCircleOutlined /> },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  cancelled: { color: 'default', label: '已取消', icon: <MinusCircleOutlined /> }
}

export interface WorkflowRunDetailProps {
  runId: string | null
  open: boolean
  onClose: () => void
  onLoadSession?: (sessionId: string) => void
}

export function WorkflowRunDetail({ runId, open, onClose, onLoadSession }: WorkflowRunDetailProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const getRunDetail = useWorkflowStore((s) => s.getRunDetail)
  const resumeWorkflow = useWorkflowStore((s) => s.resumeWorkflow)
  const storeRuns = useWorkflowStore((s) => s.runs)

  useEffect(() => {
    if (!open || !runId) {
      setRun(null)
      return
    }
    const storeRun = storeRuns.find((r) => r.id === runId)
    if (storeRun) {
      setRun(storeRun)
    }
    void getRunDetail(runId).then((detail) => {
      if (detail) setRun(detail)
    })
  }, [open, runId, getRunDetail, storeRuns])

  const handleApprove = useCallback(
    (token: string, approved: boolean) => {
      void resumeWorkflow(token, approved)
      onClose()
    },
    [resumeWorkflow, onClose]
  )

  if (!run) {
    return (
      <Modal title="工作流详情" open={open} onCancel={onClose} footer={null} width={680}>
        <Empty description="加载中…" />
      </Modal>
    )
  }

  const statusInfo = STATUS_LABELS[run.status] ?? STATUS_LABELS.pending
  const steps = Object.values(run.stepResults)
  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)

  return (
    <Modal
      title={
        <Space>
          <span>工作流: {run.workflowName}</span>
          <Tag icon={statusInfo.icon} color={statusInfo.color}>{statusInfo.label}</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
    >
      {run.status === 'paused' && run.resumeToken && (
        <Alert
          type="warning"
          showIcon
          icon={<PauseCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="工作流等待审批"
          description={
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                步骤 <Typography.Text strong>{getPausedStepId(run)}</Typography.Text> 需要您审批后才能继续执行。
              </Typography.Text>
              <Space>
                <Button type="primary" onClick={() => handleApprove(run.resumeToken!, true)}>
                  批准并继续
                </Button>
                <Button danger onClick={() => handleApprove(run.resumeToken!, false)}>
                  拒绝
                </Button>
              </Space>
            </Space>
          }
        />
      )}

      <WorkflowPipelineView run={run} onApprove={handleApprove} />

      <Descriptions size="small" column={2} style={{ marginTop: 16 }}>
        <Descriptions.Item label="运行 ID">
          <Text copyable style={{ fontSize: 12 }}>{run.id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="触发方式">{run.triggerType ?? 'manual'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(run.createdAt).toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="总耗时">
          {totalDuration > 0 ? `${(totalDuration / 1000).toFixed(1)}s` : '-'}
        </Descriptions.Item>
        {run.error && (
          <Descriptions.Item label="错误" span={2}>
            <Text type="danger">{run.error}</Text>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Typography.Title level={5} style={{ marginTop: 16 }}>步骤时间线</Typography.Title>
      <Timeline
        items={steps.map((step) => ({
          color: timelineColor(step.status),
          children: (
            <StepTimelineItem step={step} onLoadSession={onLoadSession} />
          )
        }))}
      />
    </Modal>
  )
}

function StepTimelineItem({
  step,
  onLoadSession
}: {
  step: WorkflowStepResult
  onLoadSession?: (id: string) => void
}) {
  const duration = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong>{step.stepId}</Text>
        <Tag color={statusToTagColor(step.status)} style={{ fontSize: 11 }}>
          {step.status}
        </Tag>
        {duration && <Text type="secondary" style={{ fontSize: 11 }}>{duration}</Text>}
        {step.sessionId && onLoadSession && (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontSize: 11 }}
            onClick={() => onLoadSession(step.sessionId!)}
          >
            查看会话
          </Button>
        )}
      </div>
      {step.error && (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {step.error}
        </Text>
      )}
      {step.output && (
        <Paragraph
          ellipsis={{ rows: 3, expandable: 'collapsible' }}
          style={{ fontSize: 12, marginTop: 4, marginBottom: 0, color: '#666' }}
        >
          {step.output}
        </Paragraph>
      )}
      {step.approved !== undefined && (
        <Tag color={step.approved ? 'green' : 'red'} style={{ marginTop: 4 }}>
          {step.approved ? '已批准' : '已拒绝'}
        </Tag>
      )}
    </div>
  )
}

function getPausedStepId(run: WorkflowRun): string {
  for (const [stepId, result] of Object.entries(run.stepResults)) {
    if (result.status === 'paused') return stepId
  }
  return `#${run.currentStepIndex + 1}`
}

function timelineColor(status: string): string {
  switch (status) {
    case 'completed': return 'green'
    case 'running': return 'blue'
    case 'failed': return 'red'
    case 'skipped': return 'gray'
    default: return 'gray'
  }
}

function statusToTagColor(status: string): string {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'processing'
    case 'failed': return 'error'
    case 'skipped': return 'default'
    case 'pending': return 'default'
    default: return 'default'
  }
}
