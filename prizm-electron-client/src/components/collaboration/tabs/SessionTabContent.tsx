/**
 * SessionTabContent — read-only view of a background session for a tab.
 *
 * Shows session summary, status, messages, and a button to jump into the full session.
 */
import { isToolSession } from '@prizm/shared'
import { memo, useMemo } from 'react'
import { Button, Descriptions, Tag, Typography } from 'antd'
import { ExternalLink, FileText } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { useCollabInteraction } from '../../../hooks/useCollabInteraction'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { EmptyState } from '../../ui/EmptyState'
import type { TabContentProps } from '../CollabTabContent'

const { Paragraph, Text } = Typography

function statusTag(status?: string) {
  const colors: Record<string, string> = {
    running: 'processing',
    completed: 'success',
    failed: 'error',
    pending: 'default',
    paused: 'warning',
    timeout: 'warning',
    cancelled: 'default'
  }
  const labels: Record<string, string> = {
    running: '运行中',
    completed: '完成',
    failed: '失败',
    pending: '等待',
    paused: '暂停',
    timeout: '超时',
    cancelled: '已取消'
  }
  return (
    <Tag color={colors[status ?? ''] ?? 'default'}>{labels[status ?? ''] ?? status ?? '未知'}</Tag>
  )
}

export const SessionTabContent = memo(function SessionTabContent({
  entityId,
  onLoadSession
}: TabContentProps) {
  const sessions = useAgentSessionStore((s) => s.sessions)
  const { openWorkflowDef } = useCollabInteraction()
  const session = useMemo(() => sessions.find((s) => s.id === entityId), [sessions, entityId])

  if (!entityId) return <EmptyState description="缺少会话 ID" />
  if (!session) return <EmptyState description="未找到会话（可能尚未加载）" />

  const isBg = session.kind === 'background'
  const isWorkflowMgmt = isToolSession(session)
  const typeLabel = isWorkflowMgmt ? '工作流管理会话' : isBg ? '后台任务' : '交互会话'
  const toolMeta = (
    session as { toolMeta?: { label?: string; workflowDefId?: string; workflowName?: string } }
  ).toolMeta
  const label =
    toolMeta?.label ??
    session.bgMeta?.label ??
    session.llmSummary?.trim() ??
    session.id.slice(0, 12)
  const messageCount = session.messages?.length ?? 0
  const workflowDefId = toolMeta?.workflowDefId ?? session.bgMeta?.workflowDefId
  const workflowName = toolMeta?.workflowName ?? session.bgMeta?.workflowName

  return (
    <div className="collab-tab-entity-detail">
      <div className="collab-tab-entity-detail__header">
        <h3 className="collab-tab-entity-detail__title">{label}</h3>
        {isBg && statusTag(session.bgStatus)}
      </div>

      <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="ID">
          <code style={{ fontSize: 11 }}>{session.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="类型">
          <Tag>{typeLabel}</Tag>
        </Descriptions.Item>
        {(workflowDefId || workflowName) && (
          <Descriptions.Item label="所属工作流">
            <span style={{ marginRight: 8 }}>{workflowName ?? workflowDefId}</span>
            <Button
              size="small"
              type="link"
              icon={<FileText size={11} />}
              onClick={() =>
                openWorkflowDef(workflowDefId ?? workflowName ?? '', workflowName ?? '工作流定义')
              }
              style={{ padding: 0, height: 'auto' }}
            >
              查看工作流定义
            </Button>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="消息数">{messageCount}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(session.createdAt).toLocaleString()}
        </Descriptions.Item>
        {session.updatedAt && (
          <Descriptions.Item label="更新时间">
            {new Date(session.updatedAt).toLocaleString()}
          </Descriptions.Item>
        )}
      </Descriptions>

      <Button
        type="primary"
        icon={<ExternalLink size={13} />}
        onClick={() => onLoadSession?.(session.id)}
        style={{ marginBottom: 16 }}
      >
        在主聊天区打开
      </Button>

      {messageCount > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
            最近消息 (最新 5 条)
          </Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {session.messages.slice(-5).map((msg) => (
              <div
                key={msg.id}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background:
                    msg.role === 'user'
                      ? 'var(--ant-color-primary-bg)'
                      : 'var(--ant-color-fill-quaternary)',
                  fontSize: 12
                }}
              >
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {msg.role}
                </Text>
                <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0, fontSize: 12 }}>
                  {msg.parts
                    ?.filter((p) => p.type === 'text')
                    .map((p) => (p as { type: 'text'; content: string }).content)
                    .join('\n') || '(无文本内容)'}
                </Paragraph>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
