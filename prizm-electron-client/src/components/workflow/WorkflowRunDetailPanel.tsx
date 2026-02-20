/**
 * WorkflowRunDetailPanel — 运行详情面板（内联展示，替代 Modal）
 *
 * 面包屑返回、审批提示、Pipeline 可视化、步骤时间线、操作按钮。
 * 支持内联查看步骤关联的 Agent 会话（不跳转页面）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Tag, Button, Space, Alert, Typography, Timeline, Descriptions, Collapse, Progress } from 'antd'
import { Icon } from '@lobehub/ui'
import { FolderOpen, MessageSquare, X } from 'lucide-react'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  MinusCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'
import { WorkflowPipelineView } from './WorkflowPipelineView'
import { WorkflowWorkspacePanel } from './WorkflowWorkspacePanel'
import { useWorkflowStore } from '../../store/workflowStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { useScope } from '../../hooks/useScope'
import { SessionChatProvider } from '../../context/SessionChatContext'
import { SessionChatPanel } from '../agent/SessionChatPanel'

const { Text, Paragraph } = Typography

const STATUS_LABELS: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  pending: { color: 'default', label: '等待中', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', label: '运行中', icon: <ThunderboltOutlined /> },
  paused: { color: 'warning', label: '待审批', icon: <PauseCircleOutlined /> },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  cancelled: { color: 'default', label: '已取消', icon: <MinusCircleOutlined /> }
}

export interface WorkflowRunDetailPanelProps {
  runId: string
  defName?: string
  onGoBack: () => void
  onLoadSession?: (sessionId: string) => void
  onRerun?: (workflowName: string, args?: Record<string, unknown>) => void
}

export function WorkflowRunDetailPanel({
  runId,
  defName,
  onGoBack,
  onLoadSession,
  onRerun
}: WorkflowRunDetailPanelProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [inlineSessionId, setInlineSessionId] = useState<string | null>(null)
  const [inlineStepId, setInlineStepId] = useState<string | null>(null)
  const getRunDetail = useWorkflowStore((s) => s.getRunDetail)
  const resumeWorkflow = useWorkflowStore((s) => s.resumeWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const storeRuns = useWorkflowStore((s) => s.runs)
  const loadSession = useAgentSessionStore((s) => s.loadSession)
  const { currentScope } = useScope()

  useEffect(() => {
    const storeRun = storeRuns.find((r) => r.id === runId)
    if (storeRun) setRun(storeRun)
    void getRunDetail(runId).then((detail) => {
      if (detail) setRun(detail)
    })
  }, [runId, getRunDetail, storeRuns])

  useEffect(() => {
    setInlineSessionId(null)
    setInlineStepId(null)
  }, [runId])

  const handleApprove = useCallback(
    (token: string, approved: boolean) => {
      void resumeWorkflow(token, approved)
    },
    [resumeWorkflow]
  )

  const handleViewSession = useCallback(
    (sessionId: string, stepId?: string) => {
      if (currentScope) {
        void loadSession(sessionId, currentScope)
      }
      setInlineSessionId(sessionId)
      setInlineStepId(stepId ?? null)
    },
    [currentScope, loadSession]
  )

  if (!run) {
    return (
      <div className="wfp-run-detail wfp-fade-appear">
        <div className="wfp-breadcrumb" onClick={onGoBack}>
          <ArrowLeftOutlined /> 返回
        </div>
        <div className="wfp-skeleton">
          <div className="wfp-skeleton__bar" style={{ width: '40%' }} />
          <div className="wfp-skeleton__bar" style={{ width: '60%' }} />
          <div className="wfp-skeleton__bar" style={{ width: '80%' }} />
        </div>
      </div>
    )
  }

  const statusInfo = STATUS_LABELS[run.status] ?? STATUS_LABELS.pending
  const steps = Object.values(run.stepResults)
  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
  const isActive = run.status === 'running' || run.status === 'pending' || run.status === 'paused'

  return (
    <div className="wfp-run-detail wfp-fade-appear">
      {/* Breadcrumb */}
      <div className="wfp-breadcrumb" onClick={onGoBack}>
        <ArrowLeftOutlined />
        <span>← {defName ?? run.workflowName} / 运行历史</span>
      </div>

      {/* Header */}
      <div className="wfp-run-header">
        <div>
          <h3 className="wfp-run-header__title">
            {run.workflowName}
            <Tag
              icon={statusInfo.icon}
              color={statusInfo.color}
              style={{ marginLeft: 8, verticalAlign: 'middle' }}
            >
              {statusInfo.label}
            </Tag>
          </h3>
        </div>
        <Space>
          {isActive && (
            <Button danger onClick={() => void cancelRun(run.id)}>
              取消运行
            </Button>
          )}
          {onRerun && run.status !== 'running' && (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onRerun(run.workflowName, run.args)}
            >
              重新运行
            </Button>
          )}
        </Space>
      </div>

      {/* Approval alert */}
      {run.status === 'paused' && run.resumeToken && (
        <Alert
          type="warning"
          showIcon
          icon={<PauseCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="工作流等待审批"
          description={
            <Space>
              <Button type="primary" onClick={() => handleApprove(run.resumeToken!, true)}>
                批准并继续
              </Button>
              <Button danger onClick={() => handleApprove(run.resumeToken!, false)}>
                拒绝
              </Button>
            </Space>
          }
        />
      )}

      {/* Pipeline */}
      <WorkflowPipelineView run={run} onApprove={handleApprove} />

      {/* Descriptions */}
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

      {/* Run params */}
      {run.args && Object.keys(run.args).length > 0 && (
        <>
          <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
            运行参数
          </Typography.Title>
          <div className="wfp-run-params">
            {JSON.stringify(run.args, null, 2)}
          </div>
        </>
      )}

      {/* Step timeline with duration bars */}
      <Typography.Title level={5} style={{ marginTop: 20, marginBottom: 12 }}>
        步骤时间线
      </Typography.Title>
      {steps.length === 0 ? (
        <Text type="secondary">暂无步骤结果</Text>
      ) : (
        <Timeline
          items={steps.map((step) => ({
            color: timelineColor(step.status),
            children: (
              <StepTimelineItem
                step={step}
                maxDuration={totalDuration}
                onViewSession={handleViewSession}
                activeSessionId={inlineSessionId}
              />
            )
          }))}
        />
      )}

      {/* Run Workspace */}
      <Collapse
        ghost
        style={{ marginTop: 16 }}
        items={[{
          key: 'workspace',
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon icon={FolderOpen} size={14} />
              Run 工作空间
            </span>
          ),
          children: (
            <WorkflowWorkspacePanel
              workflowName={run.workflowName}
              activeRunId={run.id}
            />
          )
        }]}
      />

      {/* Inline session viewer */}
      {inlineSessionId && currentScope && (
        <div className="wfp-inline-session">
          <div className="wfp-inline-session__header">
            <Space size={8}>
              <Icon icon={MessageSquare} size={14} />
              <Text strong style={{ fontSize: 13 }}>
                步骤会话{inlineStepId ? ` — ${inlineStepId}` : ''}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {inlineSessionId.slice(0, 12)}…
              </Text>
            </Space>
            <Button
              type="text"
              size="small"
              icon={<Icon icon={X} size={14} />}
              onClick={() => { setInlineSessionId(null); setInlineStepId(null) }}
            />
          </div>
          <div className="wfp-inline-session__body">
            <SessionChatProvider sessionId={inlineSessionId} scope={currentScope} active>
              <SessionChatPanel />
            </SessionChatProvider>
          </div>
        </div>
      )}
    </div>
  )
}

function StepTimelineItem({
  step,
  maxDuration,
  onViewSession,
  activeSessionId
}: {
  step: WorkflowStepResult
  maxDuration: number
  onViewSession?: (sessionId: string, stepId?: string) => void
  activeSessionId?: string | null
}) {
  const duration = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''
  const pct = maxDuration > 0 && step.durationMs ? Math.round((step.durationMs / maxDuration) * 100) : 0
  const isViewing = step.sessionId != null && step.sessionId === activeSessionId

  return (
    <div className="wf-step-timeline-item">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong>{step.stepId}</Text>
        <Tag color={statusToTagColor(step.status)} style={{ fontSize: 11 }}>
          {step.status}
        </Tag>
        {duration && <Text type="secondary" style={{ fontSize: 11 }}>{duration}</Text>}
        {step.sessionId && onViewSession && (
          <Button
            type="link"
            size="small"
            style={{
              padding: 0,
              height: 'auto',
              fontSize: 11,
              fontWeight: isViewing ? 600 : undefined
            }}
            onClick={() => onViewSession(step.sessionId!, step.stepId)}
          >
            {isViewing ? '正在查看' : '查看会话'}
          </Button>
        )}
      </div>
      {pct > 0 && (
        <Progress
          percent={pct}
          size="small"
          showInfo={false}
          strokeColor={step.status === 'failed' ? 'var(--ant-color-error)' : undefined}
          style={{ marginTop: 4, marginBottom: 2, maxWidth: 240 }}
        />
      )}
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
    default: return 'default'
  }
}
