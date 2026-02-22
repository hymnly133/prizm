/**
 * WorkflowRunCard — 可复用的工作流运行卡片
 *
 * 展示运行状态 Tag、迷你 Pipeline、触发类型、创建时间和耗时。
 */

import { useCallback } from 'react'
import { Tag, Button, Space } from 'antd'
import type { WorkflowRun } from '@prizm/shared'
import { MiniPipelineView } from './WorkflowPipelineView'

const STATUS_COLORS: Record<string, string> = {
  running: 'processing',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
  pending: 'default'
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  paused: '待审批',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

export interface WorkflowRunCardProps {
  run: WorkflowRun
  onClick?: () => void
  onCancel?: () => void
  showName?: boolean
}

export function WorkflowRunCard({ run, onClick, onCancel, showName = true }: WorkflowRunCardProps) {
  const stepIds = Object.keys(run.stepResults)
  const totalDuration = Object.values(run.stepResults).reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0
  )
  const isActive = run.status === 'running' || run.status === 'pending' || run.status === 'paused'

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick?.()
      }
    },
    [onClick]
  )

  return (
    <div
      className={`wfp-run-card wfp-run-card--${run.status}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`运行 ${run.workflowName}，${STATUS_LABELS[run.status] ?? run.status}`}
    >
      <div className="wfp-run-card__top">
        <Space size={8}>
          {showName && <span className="wfp-run-card__name">{run.workflowName}</span>}
          <Tag color={STATUS_COLORS[run.status] ?? 'default'}>
            {STATUS_LABELS[run.status] ?? run.status}
          </Tag>
        </Space>
        <div className="wfp-run-card__actions">
          {totalDuration > 0 && (
            <span className="wfp-run-card__duration">
              {(totalDuration / 1000).toFixed(1)}s
            </span>
          )}
          {isActive && onCancel && (
            <Button
              size="small"
              type="link"
              danger
              title="取消运行"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
            >
              取消
            </Button>
          )}
        </div>
      </div>
      {stepIds.length > 0 && <MiniPipelineView stepResults={run.stepResults} stepIds={stepIds} />}
      <div className="wfp-run-card__meta">
        <span>{run.triggerType ?? 'manual'}</span>
        <span>{new Date(run.createdAt).toLocaleString()}</span>
        <span>{run.id.slice(0, 12)}…</span>
      </div>
    </div>
  )
}
