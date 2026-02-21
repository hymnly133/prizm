/**
 * TaskTabContent — single-task detail view for a tab.
 *
 * Fetches one TaskRun by ID and renders its execution details and result.
 */
import { memo, useEffect, useState, useCallback } from 'react'
import { Button, Descriptions, Tag } from 'antd'
import { Bot, RefreshCw } from 'lucide-react'
import type { TaskRun } from '@prizm/shared'
import { useTaskStore } from '../../../store/taskStore'
import { ExecutionStatusTag, ExecutionResultView } from '../../execution'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { EmptyState } from '../../ui/EmptyState'
import type { TabContentProps } from '../CollabTabContent'

export const TaskTabContent = memo(function TaskTabContent({
  entityId,
  onLoadSession
}: TabContentProps) {
  const getTaskDetail = useTaskStore((s) => s.getTaskDetail)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const [task, setTask] = useState<TaskRun | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchTask = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const detail = await getTaskDetail(entityId)
      setTask(detail)
    } finally {
      setLoading(false)
    }
  }, [entityId, getTaskDetail])

  useEffect(() => { void fetchTask() }, [fetchTask])

  const handleCancel = useCallback(async () => {
    if (!entityId) return
    await cancelTask(entityId)
    void fetchTask()
  }, [entityId, cancelTask, fetchTask])

  if (!entityId) return <EmptyState description="缺少任务 ID" />
  if (loading) return <LoadingPlaceholder />
  if (!task) return <EmptyState description="未找到任务" />

  const isActive = task.status === 'running' || task.status === 'pending'

  return (
    <div className="collab-tab-entity-detail">
      <div className="collab-tab-entity-detail__header">
        <h3 className="collab-tab-entity-detail__title">
          {task.label ?? task.id.slice(0, 12)}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ExecutionStatusTag status={task.status} />
          <Button
            size="small"
            type="text"
            icon={<RefreshCw size={12} />}
            onClick={() => void fetchTask()}
          />
        </div>
      </div>

      <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="ID">
          <code style={{ fontSize: 11 }}>{task.id}</code>
        </Descriptions.Item>
        {task.triggerType && (
          <Descriptions.Item label="触发方式">
            <Tag>{task.triggerType}</Tag>
          </Descriptions.Item>
        )}
        {task.durationMs != null && (
          <Descriptions.Item label="耗时">
            {task.durationMs < 1000
              ? `${task.durationMs}ms`
              : `${(task.durationMs / 1000).toFixed(1)}s`}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="创建时间">
          {new Date(task.createdAt).toLocaleString()}
        </Descriptions.Item>
        {task.parentSessionId && (
          <Descriptions.Item label="父会话">
            <button
              type="button"
              className="collab-ref-chip"
              onClick={() => onLoadSession?.(task.parentSessionId!)}
            >
              <Bot size={10} />
              {task.parentSessionId.slice(0, 8)}...
            </button>
          </Descriptions.Item>
        )}
      </Descriptions>

      {isActive && (
        <Button size="small" danger onClick={() => void handleCancel()} style={{ marginBottom: 12 }}>
          取消任务
        </Button>
      )}

      {(task.output || task.structuredData || task.artifacts || task.error) && (
        <div style={{ marginTop: 8 }}>
          <ExecutionResultView
            output={task.output}
            structuredData={task.structuredData}
            artifacts={task.artifacts}
            error={task.error}
          />
        </div>
      )}
    </div>
  )
})
