/**
 * WorkflowDefOverviewTab — 定义总览 Tab
 *
 * 步骤流程图 + 参数 Schema + 触发器 + 运行统计 + 版本历史（一键回溯）
 */

import { useMemo, useState, useEffect, useCallback } from 'react'
import { Tag, Button, Popconfirm, message } from 'antd'
import {
  RobotOutlined,
  CheckSquareOutlined,
  SwapOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  FileOutlined,
  CheckOutlined,
  HistoryOutlined,
  RollbackOutlined
} from '@ant-design/icons'
import type { WorkflowDef, WorkflowRun, WorkflowDefVersionItem } from '@prizm/shared'
import { StatCard } from '../ui/StatCard'
import { EmptyState } from '../ui/EmptyState'
import { getWorkflowArgsSchema } from './workflowArgsSchema'
import { WorkflowStepDiagram } from './WorkflowStepDiagram'
import { GitBranch } from 'lucide-react'
import { usePrizmContext } from '../../context/PrizmContext'

export interface WorkflowDefOverviewTabProps {
  def: WorkflowDef
  runs: WorkflowRun[]
  /** 定义 ID，用于版本列表与一键回溯 */
  defId?: string
  /** 回溯成功后回调（用于刷新定义列表） */
  onRollbackSuccess?: () => void
}

function formatVersionTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function WorkflowDefOverviewTab({
  def,
  runs,
  defId,
  onRollbackSuccess
}: WorkflowDefOverviewTabProps) {
  const { manager } = usePrizmContext()
  const [versions, setVersions] = useState<WorkflowDefVersionItem[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [rollbackingId, setRollbackingId] = useState<string | null>(null)

  useEffect(() => {
    if (!defId) {
      setVersions([])
      return
    }
    let cancelled = false
    setVersionsLoading(true)
    const http = manager.getHttpClient()
    http
      .getWorkflowDefVersions(defId)
      .then((list) => {
        if (!cancelled) setVersions(list)
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [defId, manager])

  const handleRollback = useCallback(
    async (versionId: string) => {
      if (!defId) return
      setRollbackingId(versionId)
      try {
        const http = manager.getHttpClient()
        await http.rollbackWorkflowDef(defId, versionId)
        message.success('已回溯到该版本')
        onRollbackSuccess?.()
        const list = await http.getWorkflowDefVersions(defId)
        setVersions(list)
      } catch (e) {
        message.error(e instanceof Error ? e.message : '回溯失败')
      } finally {
        setRollbackingId(null)
      }
    },
    [defId, manager, onRollbackSuccess]
  )
  const argsSchema = useMemo(() => {
    const raw = getWorkflowArgsSchema(def)
    if (!raw?.length) return null
    return raw.map((p) => ({
      key: p.key,
      default: p.default !== undefined ? JSON.stringify(p.default) : '-',
      description: p.description || '-',
      optional: p.optional ?? false
    }))
  }, [def])

  const runStats = useMemo(() => {
    let completed = 0
    let failed = 0
    let cancelled = 0
    let totalDuration = 0
    let durCount = 0
    for (const run of runs) {
      if (run.status === 'completed') {
        completed++
        const dur = Object.values(run.stepResults).reduce((s, r) => s + (r.durationMs ?? 0), 0)
        if (dur > 0) {
          totalDuration += dur
          durCount++
        }
      } else if (run.status === 'failed') failed++
      else if (run.status === 'cancelled') cancelled++
    }
    const avgDuration = durCount > 0 ? totalDuration / durCount : 0
    const successRate = runs.length > 0 ? Math.round((completed / runs.length) * 100) : 0
    return { total: runs.length, completed, failed, cancelled, avgDuration, successRate }
  }, [runs])

  const triggers = def.triggers ?? []

  return (
    <div className="wfp-tab-content wfp-fade-appear">
      {/* Step Diagram */}
      <div className="wfp-overview-tab__section">
        <div className="wfp-overview-tab__section-title">
          步骤流程 ({def.steps.length} 步)
        </div>
        {def.steps.length > 0 ? (
          <WorkflowStepDiagram steps={def.steps} />
        ) : (
          <EmptyState
            icon={GitBranch}
            description="暂无步骤定义"
            className="wfp-overview-tab__empty"
          />
        )}
      </div>

      {/* Parameters Schema */}
      {argsSchema && argsSchema.length > 0 && (
        <div className="wfp-overview-tab__section">
          <div className="wfp-overview-tab__section-title">参数 Schema</div>
          <div className="wfp-overview-tab__section-desc" style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 8 }}>
            有默认值即为可选，运行时不填则使用默认值。
          </div>
          <table className="wfp-params-table">
            <thead>
              <tr>
                <th>参数名</th>
                <th>默认值</th>
                <th title="有默认值即为可选">可选</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {argsSchema.map((param) => (
                <tr key={param.key}>
                  <td><code>{param.key}</code></td>
                  <td>{param.default}</td>
                  <td>{param.optional ? '是' : '否'}</td>
                  <td>{param.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Triggers */}
      {triggers.length > 0 && (
        <div className="wfp-overview-tab__section">
          <div className="wfp-overview-tab__section-title">触发器</div>
          <div className="wfp-trigger-list">
            {triggers.map((trigger, i) => (
              <div key={i} className="wfp-trigger-chip">
                {triggerIcon(trigger.type)}
                <span>{triggerLabel(trigger.type)}</span>
                {trigger.filter && (
                  <Tag style={{ fontSize: 11 }}>
                    {Object.entries(trigger.filter).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </Tag>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run Statistics */}
      <div className="wfp-overview-tab__section">
        <div className="wfp-overview-tab__section-title">运行统计</div>
        {runStats.total === 0 ? (
          <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>
            暂无运行记录
          </div>
        ) : (
          <div className="wfp-run-stats">
            <StatCard
              label="总运行"
              value={String(runStats.total)}
              size="compact"
            />
            <StatCard
              label="成功率"
              value={`${runStats.successRate}%`}
              size="compact"
              iconColor="var(--ant-color-success)"
            />
            <StatCard
              label="平均耗时"
              value={runStats.avgDuration > 0 ? `${(runStats.avgDuration / 1000).toFixed(1)}s` : '-'}
              size="compact"
            />
            <StatCard
              label="失败"
              value={String(runStats.failed)}
              size="compact"
              iconColor="var(--ant-color-error)"
            />
          </div>
        )}
      </div>

      {/* 版本历史（无记忆功能，仅快照与一键回溯） */}
      {defId && (
        <div className="wfp-overview-tab__section">
          <div className="wfp-overview-tab__section-title">
            <HistoryOutlined style={{ marginRight: 6 }} />
            版本历史
          </div>
          {versionsLoading ? (
            <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>加载中…</div>
          ) : versions.length === 0 ? (
            <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>
              暂无历史版本（每次保存会生成快照）
            </div>
          ) : (
            <ul className="wfp-version-list">
              {versions.map((v) => (
                <li key={v.id} className="wfp-version-list__item">
                  <span className="wfp-version-list__time">{formatVersionTime(v.createdAt)}</span>
                  <Popconfirm
                    title="确定回溯到此版本？"
                    description="当前内容会先被保存为快照，再替换为该版本。"
                    onConfirm={() => handleRollback(v.id)}
                    okText="回溯"
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<RollbackOutlined />}
                      loading={rollbackingId === v.id}
                    >
                      回溯
                    </Button>
                  </Popconfirm>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function triggerIcon(type: string): React.ReactNode {
  switch (type) {
    case 'cron': return <ClockCircleOutlined />
    case 'schedule_remind': return <FieldTimeOutlined />
    case 'document_saved': return <FileOutlined />
    case 'todo_completed': return <CheckOutlined />
    default: return <ClockCircleOutlined />
  }
}

function triggerLabel(type: string): string {
  switch (type) {
    case 'cron': return '定时触发'
    case 'schedule_remind': return '日程提醒'
    case 'document_saved': return '文档保存'
    case 'todo_completed': return '待办完成'
    default: return type
  }
}
