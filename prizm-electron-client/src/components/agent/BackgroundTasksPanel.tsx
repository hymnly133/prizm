/**
 * BackgroundTasksPanel - 后台任务管理面板
 *
 * 展示活跃/已完成/失败的 BG Session 列表，
 * 支持查看详情、取消任务、批量操作。
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, Tag, Button, Space, Empty, Spin, Tooltip, Statistic, Row, Col, Modal, Typography, Collapse } from 'antd'
import {
  ReloadOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
  PauseCircleOutlined
} from '@ant-design/icons'
import type { PrizmClient, AgentSession } from '@prizm/client-core'

const { Text, Paragraph } = Typography

interface BgSummary {
  active: number
  completed: number
  failed: number
  timeout: number
  cancelled: number
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <ThunderboltOutlined />, label: '运行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
  timeout: { color: 'warning', icon: <ExclamationCircleOutlined />, label: '超时' },
  cancelled: { color: 'default', icon: <PauseCircleOutlined />, label: '已取消' }
}

interface BackgroundTasksPanelProps {
  client: PrizmClient | null
  scope: string
}

export function BackgroundTasksPanel({ client, scope }: BackgroundTasksPanelProps) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [summary, setSummary] = useState<BgSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [resultModal, setResultModal] = useState<{ sessionId: string; output: string } | null>(null)

  const fetchData = useCallback(async () => {
    if (!client) return
    setLoading(true)
    try {
      const [sessionsRes, summaryRes] = await Promise.all([
        client.listAgentSessions(scope).then((s) => s.filter((ss) => ss.kind === 'background')),
        client.getBgSummary(scope)
      ])
      setSessions(sessionsRes)
      setSummary(summaryRes)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [client, scope])

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 10_000)
    return () => clearInterval(timer)
  }, [fetchData])

  const handleCancel = useCallback(
    async (sessionId: string) => {
      if (!client) return
      try {
        await client.cancelBgSession(sessionId, scope)
        fetchData()
      } catch {
        // silent
      }
    },
    [client, scope, fetchData]
  )

  const handleBatchCancel = useCallback(async () => {
    if (!client) return
    try {
      await client.batchCancelBgSessions(undefined, scope)
      fetchData()
    } catch {
      // silent
    }
  }, [client, scope, fetchData])

  const handleViewResult = useCallback(
    async (sessionId: string) => {
      if (!client) return
      try {
        const result = await client.getBgSessionResult(sessionId, scope)
        if (result) {
          setResultModal({ sessionId, output: result.output })
        }
      } catch {
        // silent
      }
    },
    [client, scope]
  )

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))
  }, [sessions])

  const activeSessions = sortedSessions.filter(
    (s) => s.bgStatus === 'running' || s.bgStatus === 'pending'
  )
  const completedSessions = sortedSessions.filter(
    (s) => s.bgStatus === 'completed' || s.bgStatus === 'failed' || s.bgStatus === 'timeout' || s.bgStatus === 'cancelled'
  )

  return (
    <div style={{ padding: 16 }}>
      {summary && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Statistic title="活跃" value={summary.active} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col span={5}>
            <Statistic title="已完成" value={summary.completed} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={5}>
            <Statistic title="失败" value={summary.failed} valueStyle={{ color: '#ff4d4f' }} />
          </Col>
          <Col span={5}>
            <Statistic title="超时" value={summary.timeout} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={5}>
            <Statistic title="已取消" value={summary.cancelled} />
          </Col>
        </Row>
      )}

      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading} size="small">
          刷新
        </Button>
        {activeSessions.length > 0 && (
          <Button
            icon={<StopOutlined />}
            danger
            size="small"
            onClick={handleBatchCancel}
          >
            全部取消
          </Button>
        )}
      </Space>

      {sessions.length === 0 && !loading && (
        <Empty description="暂无后台任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {loading && sessions.length === 0 && <Spin style={{ display: 'block', margin: '40px auto' }} />}

      {activeSessions.length > 0 && (
        <Collapse
          defaultActiveKey={['active']}
          items={[
            {
              key: 'active',
              label: `运行中 (${activeSessions.length})`,
              children: activeSessions.map((s) => (
                <BgSessionCard
                  key={s.id}
                  session={s}
                  onCancel={handleCancel}
                  onViewResult={handleViewResult}
                />
              ))
            }
          ]}
          style={{ marginBottom: 12 }}
        />
      )}

      {completedSessions.length > 0 && (
        <Collapse
          items={[
            {
              key: 'history',
              label: `历史记录 (${completedSessions.length})`,
              children: completedSessions.slice(0, 20).map((s) => (
                <BgSessionCard
                  key={s.id}
                  session={s}
                  onCancel={handleCancel}
                  onViewResult={handleViewResult}
                />
              ))
            }
          ]}
        />
      )}

      <Modal
        title="任务结果"
        open={!!resultModal}
        onCancel={() => setResultModal(null)}
        footer={null}
        width={600}
      >
        {resultModal && (
          <Paragraph
            style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}
          >
            {resultModal.output || '(无输出)'}
          </Paragraph>
        )}
      </Modal>
    </div>
  )
}

function BgSessionCard({
  session,
  onCancel,
  onViewResult
}: {
  session: AgentSession
  onCancel: (id: string) => void
  onViewResult: (id: string) => void
}) {
  const status = session.bgStatus ?? 'pending'
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const duration = session.finishedAt && session.startedAt
    ? session.finishedAt - session.startedAt
    : session.startedAt
      ? Date.now() - session.startedAt
      : 0

  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      extra={
        <Space size={4}>
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
          {(status === 'running' || status === 'pending') && (
            <Tooltip title="取消">
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                onClick={() => onCancel(session.id)}
              />
            </Tooltip>
          )}
          {(status === 'completed' || status === 'failed') && (
            <Button size="small" type="link" onClick={() => onViewResult(session.id)}>
              查看结果
            </Button>
          )}
        </Space>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text strong>{session.bgMeta?.label ?? session.id.slice(0, 8)}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            触发: {session.bgMeta?.triggerType ?? 'unknown'}
            {session.bgMeta?.parentSessionId && ` | 父会话: ${session.bgMeta.parentSessionId.slice(0, 8)}...`}
          </Text>
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {duration > 0 ? `${(duration / 1000).toFixed(1)}s` : '-'}
        </Text>
      </div>
      {session.bgResult && (
        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: '#666' }}
        >
          {session.bgResult}
        </Paragraph>
      )}
    </Card>
  )
}
