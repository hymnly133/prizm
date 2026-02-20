/**
 * ExecutionCard — 通用执行单元卡片
 *
 * 展示 label + status + 耗时 + 操作按钮。
 * Task / Workflow step / BG Session 共用.
 * Supports reverse-reference chips for parent session and related documents.
 */

import { Card, Space, Button, Typography } from 'antd'
import { Bot } from 'lucide-react'
import { ExecutionStatusTag } from './ExecutionStatusTag'

const { Text, Paragraph } = Typography

export interface ExecutionCardProps {
  id: string
  label?: string
  status: string
  triggerType?: string
  parentId?: string
  durationMs?: number
  output?: string
  createdAt?: number
  onClick?: (id: string) => void
  onViewResult?: (id: string) => void
  onCancel?: (id: string) => void
  onJumpToSession?: (sessionId: string) => void
  extra?: React.ReactNode
}

export function ExecutionCard({
  id,
  label,
  status,
  triggerType,
  parentId,
  durationMs,
  output,
  createdAt,
  onClick,
  onViewResult,
  onCancel,
  onJumpToSession,
  extra
}: ExecutionCardProps) {
  const hasResult = status === 'completed' || status === 'failed' || status === 'success'
  const isActive = status === 'running' || status === 'pending'

  return (
    <Card
      size="small"
      hoverable
      className="exec-card"
      onClick={() => onClick?.(id)}
      extra={
        <Space size={4}>
          <ExecutionStatusTag status={status} size="small" />
          {hasResult && onViewResult && (
            <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); onViewResult(id) }}>
              查看结果
            </Button>
          )}
          {isActive && onCancel && (
            <Button size="small" type="link" danger onClick={(e) => { e.stopPropagation(); onCancel(id) }}>
              取消
            </Button>
          )}
          {extra}
        </Space>
      }
    >
      <div className="exec-card__body">
        <div className="exec-card__main">
          <Text strong>{label ?? id.slice(0, 12)}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {triggerType && `来源: ${triggerType}`}
            {createdAt && ` | ${new Date(createdAt).toLocaleString()}`}
          </Text>
          {parentId && onJumpToSession && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="collab-ref-chip"
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToSession(parentId)
                }}
              >
                <Bot size={10} />
                父会话 {parentId.slice(0, 8)}…
              </button>
            </div>
          )}
        </div>
        <Text type="secondary" className="exec-card__duration">
          {durationMs != null && durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '-'}
        </Text>
      </div>
      {output && (
        <Paragraph
          ellipsis={{ rows: 2 }}
          className="exec-card__output"
        >
          {output}
        </Paragraph>
      )}
    </Card>
  )
}
