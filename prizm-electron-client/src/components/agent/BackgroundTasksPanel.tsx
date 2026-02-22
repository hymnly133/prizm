/**
 * BackgroundTasksPanel - 后台任务监控面板
 *
 * 使用共享执行组件（ExecutionCard / ExecutionStatusTag / ExecutionResultView）。
 * 所有数据从 agentSessionStore.sessions 派生。
 */

import { useState, useCallback, useMemo } from 'react'
import { Button, Space, Statistic, Row, Col, Modal, Collapse } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { AgentSession } from '@prizm/client-core'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { useScopeDataStore } from '../../store/scopeDataStore'
import { EmptyState } from '../ui/EmptyState'
import { ExecutionCard, ExecutionResultView } from '../execution'
import { FeedbackWidget } from '../ui/FeedbackWidget'

export interface BackgroundTasksPanelProps {
  onLoadSession?: (id: string) => void
}

export function BackgroundTasksPanel({ onLoadSession }: BackgroundTasksPanelProps = {}) {
  const allSessions = useAgentSessionStore((s) => s.sessions)
  const refreshSessions = useAgentSessionStore((s) => s.refreshSessions)
  const currentScope = useScopeDataStore((s) => s.currentScope)
  const loading = useAgentSessionStore((s) => s.loading)

  const [resultModal, setResultModal] = useState<AgentSession | null>(null)

  const bgSessions = useMemo(
    () =>
      allSessions
        .filter((s) => {
          if (s.kind !== 'background') return false
          const src = s.bgMeta?.source
          return !src || src === 'direct'
        })
        .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)),
    [allSessions]
  )

  const summary = useMemo(() => {
    const s = { active: 0, completed: 0, failed: 0, timeout: 0, cancelled: 0, interrupted: 0 }
    for (const sess of bgSessions) {
      const st = sess.bgStatus
      if (st === 'running' || st === 'pending') s.active++
      else if (st === 'completed') s.completed++
      else if (st === 'failed') s.failed++
      else if (st === 'timeout') s.timeout++
      else if (st === 'cancelled') s.cancelled++
      else if (st === 'interrupted') s.interrupted++
    }
    return s
  }, [bgSessions])

  const activeSessions = useMemo(
    () => bgSessions.filter((s) => s.bgStatus === 'running' || s.bgStatus === 'pending'),
    [bgSessions]
  )
  const completedSessions = useMemo(
    () =>
      bgSessions.filter(
        (s) =>
          s.bgStatus === 'completed' ||
          s.bgStatus === 'failed' ||
          s.bgStatus === 'timeout' ||
          s.bgStatus === 'cancelled' ||
          s.bgStatus === 'interrupted'
      ),
    [bgSessions]
  )

  const handleViewResult = useCallback(
    (sessionId: string) => {
      const session = bgSessions.find((s) => s.id === sessionId)
      if (session) setResultModal(session)
    },
    [bgSessions]
  )

  const handleRefresh = useCallback(() => {
    if (currentScope) void refreshSessions(currentScope)
  }, [currentScope, refreshSessions])

  const total =
    summary.active +
    summary.completed +
    summary.failed +
    summary.timeout +
    summary.cancelled +
    summary.interrupted

  const handleJumpToSession = useCallback(
    (sessionId: string) => onLoadSession?.(sessionId),
    [onLoadSession]
  )

  const mapSessionToCard = (s: AgentSession) => {
    const duration =
      s.finishedAt && s.startedAt
        ? s.finishedAt - s.startedAt
        : s.startedAt
        ? Date.now() - s.startedAt
        : 0

    const isFinished =
      s.bgStatus === 'completed' || s.bgStatus === 'failed' || s.bgStatus === 'timeout'

    return (
      <ExecutionCard
        key={s.id}
        id={s.id}
        label={s.bgMeta?.label ?? s.id.slice(0, 8)}
        status={s.bgStatus ?? 'pending'}
        triggerType={s.bgMeta?.triggerType}
        parentId={s.bgMeta?.parentSessionId}
        durationMs={duration}
        output={s.bgResult}
        onClick={(id) => onLoadSession?.(id)}
        onViewResult={handleViewResult}
        onJumpToSession={handleJumpToSession}
        extra={
          isFinished ? (
            <span onClick={(e) => e.stopPropagation()}>
              <FeedbackWidget
                targetType="task_run"
                targetId={s.id}
                metadata={{ label: s.bgMeta?.label, status: s.bgStatus }}
                variant="inline"
              />
            </span>
          ) : undefined
        }
      />
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {total > 0 && (
        <Row gutter={[12, 8]} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Statistic
              title="活跃"
              value={summary.active}
              styles={{ content: { color: 'var(--ant-color-primary)' } }}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="已完成"
              value={summary.completed}
              styles={{ content: { color: 'var(--ant-color-success)' } }}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="失败"
              value={summary.failed}
              styles={{ content: { color: 'var(--ant-color-error)' } }}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="超时"
              value={summary.timeout}
              styles={{ content: { color: 'var(--ant-color-warning)' } }}
            />
          </Col>
          <Col span={4}>
            <Statistic title="已取消" value={summary.cancelled} />
          </Col>
          <Col span={4}>
            <Statistic
              title="已中断"
              value={summary.interrupted}
              styles={{ content: { color: 'var(--ant-color-warning)' } }}
            />
          </Col>
        </Row>
      )}

      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} size="small">
          刷新
        </Button>
      </Space>

      {bgSessions.length === 0 && (
        <EmptyState description="暂无后台任务" />
      )}

      {activeSessions.length > 0 && (
        <Collapse
          defaultActiveKey={['active']}
          items={[
            {
              key: 'active',
              label: `运行中 (${activeSessions.length})`,
              children: activeSessions.map(mapSessionToCard)
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
              children: completedSessions.slice(0, 20).map(mapSessionToCard)
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
          <ExecutionResultView
            output={resultModal.bgResult}
            structuredData={resultModal.bgStructuredData}
            artifacts={resultModal.bgArtifacts}
          />
        )}
      </Modal>
    </div>
  )
}
