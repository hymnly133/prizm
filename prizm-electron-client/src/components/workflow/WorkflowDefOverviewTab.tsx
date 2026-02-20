/**
 * WorkflowDefOverviewTab — 定义总览 Tab
 *
 * 步骤流程图 + 参数 Schema + 触发器 + 运行统计
 */

import { useMemo } from 'react'
import { Tag } from 'antd'
import {
  RobotOutlined,
  CheckSquareOutlined,
  SwapOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  FileOutlined,
  CheckOutlined
} from '@ant-design/icons'
import type { WorkflowDef, WorkflowRun } from '@prizm/shared'
import { StatCard } from '../ui/StatCard'
import { WorkflowStepDiagram } from './WorkflowStepDiagram'

export interface WorkflowDefOverviewTabProps {
  def: WorkflowDef
  runs: WorkflowRun[]
}

export function WorkflowDefOverviewTab({ def, runs }: WorkflowDefOverviewTabProps) {
  const argsSchema = useMemo(() => {
    if (def.args && Object.keys(def.args).length > 0) {
      return Object.entries(def.args).map(([key, val]) => ({
        key,
        default: val?.default !== undefined ? JSON.stringify(val.default) : '-',
        description: val?.description ?? '-'
      }))
    }
    if (!def.steps.length) return null
    const refs = new Set<string>()
    const pattern = /\$args\.([a-zA-Z_][a-zA-Z0-9_.]*)/g
    for (const step of def.steps) {
      const texts = [step.prompt, step.input, step.condition, step.transform, step.approvePrompt]
      for (const t of texts) {
        if (!t) continue
        let match
        while ((match = pattern.exec(t)) !== null) {
          refs.add(match[1])
        }
        pattern.lastIndex = 0
      }
    }
    if (refs.size === 0) return null
    return Array.from(refs).map((key) => ({ key, default: '-', description: '-' }))
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
          <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13, padding: '12px 0' }}>
            暂无步骤定义
          </div>
        )}
      </div>

      {/* Parameters Schema */}
      {argsSchema && argsSchema.length > 0 && (
        <div className="wfp-overview-tab__section">
          <div className="wfp-overview-tab__section-title">参数 Schema</div>
          <table className="wfp-params-table">
            <thead>
              <tr>
                <th>参数名</th>
                <th>默认值</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {argsSchema.map((param) => (
                <tr key={param.key}>
                  <td><code>{param.key}</code></td>
                  <td>{param.default}</td>
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
