/**
 * 工作流运行状态与错误展示 — 统一常量与可复用组件
 * 供 WorkflowRunDetailPanel、WorkflowRunDetail、WorkflowTabContent、WorkflowDefTabContent 等使用
 */
import { useCallback } from 'react'
import { Button, Collapse, Space } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  MinusCircleOutlined
} from '@ant-design/icons'
import type { ReactNode } from 'react'

export const WORKFLOW_RUN_STATUS_META: Record<
  string,
  { color: string; label: string; icon: ReactNode }
> = {
  pending: { color: 'default', label: '等待中', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', label: '运行中', icon: <ThunderboltOutlined /> },
  paused: { color: 'warning', label: '待审批', icon: <PauseCircleOutlined /> },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
  cancelled: { color: 'default', label: '已取消', icon: <MinusCircleOutlined /> }
}

export function getWorkflowRunStatusTagColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'processing'
    case 'failed':
      return 'error'
    case 'paused':
      return 'warning'
    case 'skipped':
    case 'pending':
      return 'default'
    default:
      return 'default'
  }
}

export function getWorkflowRunTimelineColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'green'
    case 'running':
      return 'blue'
    case 'failed':
      return 'red'
    case 'skipped':
      return 'gray'
    default:
      return 'gray'
  }
}

/** 可折叠的错误详情/堆栈，带复制；使用统一样式类 wfp-run-pre */
export function WorkflowErrorDetailBlock({
  content,
  compact = false
}: {
  content: string
  compact?: boolean
}) {
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content)
  }, [content])
  return (
    <Collapse
      ghost
      size={compact ? 'small' : 'middle'}
      items={[
        {
          key: 'detail',
          label: '查看堆栈/详情',
          children: (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={handleCopy}
                style={{ padding: 0 }}
              >
                复制
              </Button>
              <pre className="wfp-run-pre">{content}</pre>
            </Space>
          )
        }
      ]}
    />
  )
}
