/**
 * WorkflowRunDetail — 工作流运行详情弹窗
 *
 * 展示完整流水线可视化、每步输入/输出、关联 BG Session 跳转。
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal, Tag, Typography, Descriptions, Timeline, Empty, Button, Space, Alert } from 'antd'
import { PauseCircleOutlined } from '@ant-design/icons'
import { WorkflowPipelineView } from './WorkflowPipelineView'
import {
  WORKFLOW_RUN_STATUS_META,
  getWorkflowRunStatusTagColor,
  getWorkflowRunTimelineColor,
  WorkflowErrorDetailBlock
} from './workflowRunStatus'
import { useWorkflowStore } from '../../store/workflowStore'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'

const { Text, Paragraph } = Typography

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

  const statusInfo = WORKFLOW_RUN_STATUS_META[run.status] ?? WORKFLOW_RUN_STATUS_META.pending
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
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="danger">{run.error}</Text>
              {run.errorDetail && (
                <WorkflowErrorDetailBlock content={run.errorDetail} />
              )}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Typography.Title level={5} style={{ marginTop: 16 }}>步骤时间线</Typography.Title>
      <Timeline
        items={steps.map((step) => ({
          color: getWorkflowRunTimelineColor(step.status),
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
        <Tag color={getWorkflowRunStatusTagColor(step.status)} style={{ fontSize: 11 }}>
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
        <div style={{ marginTop: 4 }}>
          <Text type="danger" style={{ fontSize: 12, display: 'block' }}>
            {step.error}
          </Text>
          {step.errorDetail && (
            <WorkflowErrorDetailBlock content={step.errorDetail} compact />
          )}
        </div>
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

