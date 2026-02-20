/**
 * WorkflowPipelineView — 流水线可视化组件
 *
 * 水平布局展示工作流各步骤节点、连接线和状态颜色。
 * 支持步骤过多时自动切换垂直布局。
 */

import { useMemo, Fragment } from 'react'
import { Popover, Tag, Button, Space, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  MinusCircleOutlined,
  RobotOutlined,
  CheckSquareOutlined,
  SwapOutlined
} from '@ant-design/icons'
import type { WorkflowRun, WorkflowStepResult } from '@prizm/shared'

const { Text, Paragraph } = Typography

const MAX_HORIZONTAL_STEPS = 8

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <ThunderboltOutlined />,
  completed: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
  skipped: <MinusCircleOutlined />,
  paused: <PauseCircleOutlined />
}

const STEP_TYPE_ICON: Record<string, React.ReactNode> = {
  agent: <RobotOutlined />,
  approve: <CheckSquareOutlined />,
  transform: <SwapOutlined />
}

interface StepInfo {
  id: string
  type: string
  label: string
  status: string
  result?: WorkflowStepResult
}

export interface WorkflowPipelineViewProps {
  run: WorkflowRun
  /** 工作流定义的 steps 名称，用于显示 label */
  stepDefs?: { id: string; type: string; prompt?: string; approvePrompt?: string }[]
  onApprove?: (resumeToken: string, approved: boolean) => void
  compact?: boolean
}

export function WorkflowPipelineView({
  run,
  stepDefs,
  onApprove,
  compact
}: WorkflowPipelineViewProps) {
  const steps = useMemo<StepInfo[]>(() => {
    if (stepDefs) {
      return stepDefs.map((sd) => {
        const result = run.stepResults[sd.id]
        let status: string = result?.status ?? 'pending'
        if (run.status === 'paused' && run.currentStepIndex === stepDefs.indexOf(sd) && !result?.status) {
          status = 'paused'
        }
        return {
          id: sd.id,
          type: sd.type,
          label: sd.id,
          status,
          result
        }
      })
    }

    return Object.entries(run.stepResults).map(([stepId, result]) => ({
      id: stepId,
      type: result.type ?? 'agent',
      label: stepId,
      status: result.status,
      result
    }))
  }, [run, stepDefs])

  const isVertical = steps.length > MAX_HORIZONTAL_STEPS

  return (
    <div className={`wf-pipeline${isVertical ? ' wf-pipeline--vertical' : ''}`}>
      {steps.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && (
            <div className="wf-connector">
              <div
                className={`wf-connector__line${
                  step.result?.status === 'completed' || steps[i - 1]?.result?.status === 'completed'
                    ? ' wf-connector__line--active'
                    : ''
                }`}
              />
            </div>
          )}
          <StepNode
            step={step}
            run={run}
            onApprove={onApprove}
            compact={compact}
          />
        </Fragment>
      ))}
    </div>
  )
}

function StepNode({
  step,
  run,
  onApprove,
  compact
}: {
  step: StepInfo
  run: WorkflowRun
  onApprove?: (token: string, approved: boolean) => void
  compact?: boolean
}) {
  const icon = STATUS_ICON[step.status] ?? STATUS_ICON.pending
  const typeIcon = STEP_TYPE_ICON[step.type] ?? STEP_TYPE_ICON.agent
  const durationStr = step.result?.durationMs
    ? `${(step.result.durationMs / 1000).toFixed(1)}s`
    : undefined

  const showInlineApprove = step.status === 'paused' && step.type === 'approve' && run.resumeToken && onApprove && !compact

  const content = (
    <div className="wf-step">
      <div className={`wf-step__node wf-step__node--${step.status}`}>
        {step.status === 'pending' || step.status === 'skipped' ? typeIcon : icon}
      </div>
      {!compact && (
        <>
          <div className="wf-step__label">{step.label}</div>
          <div className="wf-step__meta">
            {step.status === 'running' ? '执行中…' : step.status === 'paused' ? '待审批' : durationStr ?? ''}
          </div>
        </>
      )}
      {showInlineApprove && (
        <Space size={4} style={{ marginTop: 4 }}>
          <Button
            type="primary"
            size="small"
            onClick={(e) => { e.stopPropagation(); onApprove!(run.resumeToken!, true) }}
          >
            批准
          </Button>
          <Button
            danger
            size="small"
            onClick={(e) => { e.stopPropagation(); onApprove!(run.resumeToken!, false) }}
          >
            拒绝
          </Button>
        </Space>
      )}
    </div>
  )

  const popoverContent = (
    <div className="wf-step-detail">
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <div>
          <Text strong>{step.id}</Text>
          <Tag style={{ marginLeft: 8 }}>{step.type}</Tag>
          <Tag color={statusColor(step.status)}>{step.status}</Tag>
        </div>
        {step.result?.sessionId && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Session: {step.result.sessionId.slice(0, 12)}…
          </Text>
        )}
        {durationStr && (
          <Text type="secondary" style={{ fontSize: 12 }}>耗时: {durationStr}</Text>
        )}
        {step.result?.error && (
          <Text type="danger" style={{ fontSize: 12 }}>错误: {step.result.error}</Text>
        )}
        {step.result?.output && (
          <div className="wf-step-detail__output">
            {step.result.output.slice(0, 500)}
            {(step.result.output.length ?? 0) > 500 ? '…' : ''}
          </div>
        )}
        {step.status === 'paused' && step.type === 'approve' && run.resumeToken && onApprove && (
          <Space style={{ marginTop: 8 }}>
            <Button
              type="primary"
              size="small"
              onClick={() => onApprove(run.resumeToken!, true)}
            >
              批准
            </Button>
            <Button
              danger
              size="small"
              onClick={() => onApprove(run.resumeToken!, false)}
            >
              拒绝
            </Button>
          </Space>
        )}
      </Space>
    </div>
  )

  return (
    <Popover content={popoverContent} trigger="click" placement="bottom">
      {content}
    </Popover>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'processing'
    case 'failed': return 'error'
    case 'paused': return 'warning'
    case 'skipped': return 'default'
    default: return 'default'
  }
}

/** 迷你版流水线（用于 tool card 内嵌） */
export function MiniPipelineView({
  stepResults,
  stepIds
}: {
  stepResults: Record<string, WorkflowStepResult>
  stepIds?: string[]
}) {
  const ids = stepIds ?? Object.keys(stepResults)
  return (
    <div className="wf-mini-pipeline">
      {ids.map((id, i) => {
        const result = stepResults[id]
        const status = result?.status ?? 'pending'
        return (
          <Fragment key={id}>
            {i > 0 && (
              <div
                className={`wf-mini-line${status === 'completed' ? ' wf-mini-line--active' : ''}`}
              />
            )}
            <div className={`wf-mini-dot wf-mini-dot--${status}`} title={`${id}: ${status}`} />
          </Fragment>
        )
      })}
    </div>
  )
}
