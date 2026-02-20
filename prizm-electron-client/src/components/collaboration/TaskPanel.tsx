/**
 * TaskPanel — 单步任务管理面板
 *
 * 使用 taskStore (TaskRun) 作为独立数据源，不再委托给 BackgroundTasksPanel。
 * TaskRun 有独立的 SQLite 持久化（task_runs 表）和 REST API。
 */
import { useState, memo, useCallback, useMemo } from 'react'
import { Button, Space, Empty, Statistic, Row, Col, Modal, Collapse } from 'antd'
import { Zap } from 'lucide-react'
import { ReloadOutlined } from '@ant-design/icons'
import type { TaskRun } from '@prizm/shared'
import { useTaskStore } from '../../store/taskStore'
import { ExecutionCard, ExecutionResultView } from '../execution'
import { SectionHeader } from '../ui/SectionHeader'
import { RefreshIconButton } from '../ui/RefreshIconButton'

export interface TaskPanelProps {
  onLoadSession?: (sessionId: string) => void
}

export const TaskPanel = memo(function TaskPanel({ onLoadSession }: TaskPanelProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const refreshTasks = useTaskStore((s) => s.refreshTasks)
  const cancelTask = useTaskStore((s) => s.cancelTask)

  const [resultModal, setResultModal] = useState<TaskRun | null>(null)

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.createdAt - a.createdAt),
    [tasks]
  )

  const summary = useMemo(() => {
    const s = { active: 0, completed: 0, failed: 0, timeout: 0, cancelled: 0 }
    for (const t of sortedTasks) {
      if (t.status === 'running' || t.status === 'pending') s.active++
      else if (t.status === 'completed') s.completed++
      else if (t.status === 'failed') s.failed++
      else if (t.status === 'timeout') s.timeout++
      else if (t.status === 'cancelled') s.cancelled++
    }
    return s
  }, [sortedTasks])

  const activeTasks = useMemo(
    () => sortedTasks.filter((t) => t.status === 'running' || t.status === 'pending'),
    [sortedTasks]
  )
  const completedTasks = useMemo(
    () => sortedTasks.filter((t) =>
      t.status === 'completed' || t.status === 'failed' ||
      t.status === 'timeout' || t.status === 'cancelled'
    ),
    [sortedTasks]
  )

  const handleViewResult = useCallback(
    (taskId: string) => {
      const task = sortedTasks.find((t) => t.id === taskId)
      if (task) setResultModal(task)
    },
    [sortedTasks]
  )

  const handleCancel = useCallback(
    (taskId: string) => { void cancelTask(taskId) },
    [cancelTask]
  )

  const handleRefresh = useCallback(() => {
    void refreshTasks()
  }, [refreshTasks])

  const handleJumpToSession = useCallback(
    (sessionId: string) => onLoadSession?.(sessionId),
    [onLoadSession]
  )

  const total = summary.active + summary.completed + summary.failed + summary.timeout + summary.cancelled

  const mapTaskToCard = (t: TaskRun) => (
    <ExecutionCard
      key={t.id}
      id={t.id}
      label={t.label ?? t.id.slice(0, 8)}
      status={t.status}
      triggerType={t.triggerType}
      parentId={t.parentSessionId}
      durationMs={t.durationMs}
      output={t.output}
      createdAt={t.createdAt}
      onClick={t.sessionId ? () => onLoadSession?.(t.sessionId!) : undefined}
      onViewResult={handleViewResult}
      onCancel={t.status === 'running' || t.status === 'pending' ? handleCancel : undefined}
      onJumpToSession={t.parentSessionId ? handleJumpToSession : undefined}
    />
  )

  return (
    <div className="collab-task-panel">
      <div className="collab-panel-toolbar">
        <SectionHeader icon={Zap} title="任务" />
        <RefreshIconButton onClick={handleRefresh} disabled={loading} title="刷新" />
      </div>
      <div className="collab-task-panel__body" style={{ padding: '4px 0' }}>
        {total > 0 && (
          <Row gutter={[12, 8]} style={{ marginBottom: 16 }}>
            <Col span={5}>
              <Statistic
                title="活跃"
                value={summary.active}
                valueStyle={{ color: 'var(--ant-color-primary)' }}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title="已完成"
                value={summary.completed}
                valueStyle={{ color: 'var(--ant-color-success)' }}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title="失败"
                value={summary.failed}
                valueStyle={{ color: 'var(--ant-color-error)' }}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title="超时"
                value={summary.timeout}
                valueStyle={{ color: 'var(--ant-color-warning)' }}
              />
            </Col>
            <Col span={4}>
              <Statistic title="已取消" value={summary.cancelled} />
            </Col>
          </Row>
        )}

        <Space style={{ marginBottom: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} size="small">
            刷新
          </Button>
        </Space>

        {sortedTasks.length === 0 && (
          <Empty description="暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}

        {activeTasks.length > 0 && (
          <Collapse
            defaultActiveKey={['active']}
            items={[
              {
                key: 'active',
                label: `运行中 (${activeTasks.length})`,
                children: activeTasks.map(mapTaskToCard)
              }
            ]}
            style={{ marginBottom: 12 }}
          />
        )}

        {completedTasks.length > 0 && (
          <Collapse
            items={[
              {
                key: 'history',
                label: `历史记录 (${completedTasks.length})`,
                children: completedTasks.slice(0, 20).map(mapTaskToCard)
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
              output={resultModal.output}
              structuredData={resultModal.structuredData}
              artifacts={resultModal.artifacts}
              error={resultModal.error}
            />
          )}
        </Modal>
      </div>
    </div>
  )
})
