/**
 * WorkflowOverview — 全局总览面板
 *
 * 当未选中任何定义时展示：Hero 区域、AccentSpotlightCard 统计卡片行、
 * 最近运行时间线、工作空间（可选工作流后查看工作流空间 + Run 工具）、快速操作。
 */

import { useMemo, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { Button, Space, Select } from 'antd'
import {
  GitBranch,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Workflow,
  MessageSquare,
  FolderGit2
} from 'lucide-react'
import { Icon } from '@lobehub/ui'
import type { WorkflowRun, WorkflowDefRecord } from '@prizm/shared'
import { AccentSpotlightCard } from '../ui/AccentSpotlightCard'
import { StatCard } from '../ui/StatCard'
import { EmptyState } from '../ui/EmptyState'
import { SectionHeader } from '../ui/SectionHeader'
import { ContentCard } from '../ui/ContentCard'
import { WorkflowRunCard } from './WorkflowRunCard'
import { WorkflowWorkspacePanel } from './WorkflowWorkspacePanel'
import { fadeUpStagger, getReducedMotionProps } from '../../theme/motionPresets'

export interface WorkflowOverviewProps {
  defs: WorkflowDefRecord[]
  runs: WorkflowRun[]
  onSelectRun: (runId: string) => void
  onSelectDef: (defId: string) => void
  onNewWorkflow: () => void
  /** 用对话创建：新建待创建会话并在主内容区展示 */
  onNewSession?: () => void
  onCancelRun: (runId: string) => void
}

export function WorkflowOverview({
  defs,
  runs,
  onSelectRun,
  onSelectDef,
  onNewWorkflow,
  onNewSession,
  onCancelRun
}: WorkflowOverviewProps) {
  const stats = useMemo(() => {
    const total = runs.length
    let running = 0
    let completed = 0
    let failed = 0
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'pending' || run.status === 'paused') running++
      else if (run.status === 'completed') completed++
      else if (run.status === 'failed') failed++
    }
    return { total, running, completed, failed, defCount: defs.length }
  }, [runs, defs])

  const recentRuns = useMemo(() => {
    return [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  }, [runs])

  const [selectedWorkflowForWorkspace, setSelectedWorkflowForWorkspace] = useState<string | null>(
    null
  )
  const runsForSelectedWorkflow = useMemo(() => {
    if (!selectedWorkflowForWorkspace) return []
    return runs.filter((r) => r.workflowName === selectedWorkflowForWorkspace)
  }, [runs, selectedWorkflowForWorkspace])

  const handleWorkspaceSelectRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.id === runId)
      if (run) {
        const def = defs.find((d) => d.name === run.workflowName)
        if (def) onSelectDef(def.id)
        onSelectRun(runId)
      }
    },
    [defs, runs, onSelectDef, onSelectRun]
  )

  const spotlightItems = [
    {
      icon: <Icon icon={GitBranch} size={20} />,
      iconColor: 'var(--ant-color-primary)',
      label: '工作流定义',
      value: String(stats.defCount)
    },
    {
      icon: <Icon icon={Loader2} size={20} />,
      iconColor: 'var(--ant-color-warning)',
      label: '运行中',
      value: String(stats.running)
    },
    {
      icon: <Icon icon={CheckCircle2} size={20} />,
      iconColor: 'var(--ant-color-success)',
      label: '已完成',
      value: String(stats.completed)
    },
    {
      icon: <Icon icon={XCircle} size={20} />,
      iconColor: 'var(--ant-color-error)',
      label: '失败',
      value: String(stats.failed)
    }
  ]

  return (
    <div className="wfp-overview wfp-fade-appear">
      {/* Hero */}
      <div className="wfp-hero">
        <div className="wfp-hero__icon">
          <Icon icon={Workflow} size={36} />
        </div>
        <div className="wfp-hero__text">
          <h2 className="wfp-hero__title">工作流中心</h2>
          <p className="wfp-hero__subtitle">
            {stats.defCount} 个工作流 · {stats.total} 次运行 · {stats.running} 个进行中
          </p>
        </div>
        <div className="wfp-hero__actions" style={{ display: 'flex', gap: 8 }}>
          <Button
            type="primary"
            size="large"
            icon={<Icon icon={Plus} size={16} />}
            onClick={onNewWorkflow}
          >
            新建工作流
          </Button>
          {onNewSession && (
            <Button
              size="large"
              icon={<Icon icon={MessageSquare} size={16} />}
              onClick={onNewSession}
            >
              用对话创建
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards with Spotlight */}
      <AccentSpotlightCard
        items={spotlightItems}
        renderItem={(item) => (
          <motion.div {...fadeUpStagger(spotlightItems.indexOf(item))} {...getReducedMotionProps()}>
            <StatCard
              icon={item.icon}
              iconColor={item.iconColor}
              label={item.label}
              value={item.value}
              size="compact"
            />
          </motion.div>
        )}
        className="wfp-stats-spotlight"
      />

      {/* Recent Runs */}
      <div className="wfp-recent-section">
        <div className="wfp-recent-section__header">
          <div className="wfp-recent-section__title">最近运行</div>
        </div>
        {recentRuns.length === 0 ? (
          <EmptyState
            icon={Play}
            description="暂无工作流运行记录"
            actions={
              <Button size="small" onClick={onNewWorkflow}>
                创建第一个工作流
              </Button>
            }
          />
        ) : (
          <div className="wfp-runs-list">
            {recentRuns.map((run, i) => (
              <motion.div key={run.id} {...fadeUpStagger(i)} {...getReducedMotionProps()}>
                <WorkflowRunCard
                  run={run}
                  onClick={() => {
                    const def = defs.find((d) => d.name === run.workflowName)
                    if (def) onSelectDef(def.id)
                    onSelectRun(run.id)
                  }}
                  onCancel={() => onCancelRun(run.id)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 工作空间：选择工作流后查看其工作流空间 + Run 工具 */}
      <div className="wfp-workspace-section">
        <SectionHeader icon={FolderGit2} title="工作空间" />
        <ContentCard variant="subtle" className="wfp-workspace-card">
          <div className="wfp-workspace-select-row">
            <Select
              placeholder="选择工作流以查看其工作空间与 Run 工具"
              allowClear
              value={selectedWorkflowForWorkspace ?? undefined}
              onChange={(v) => setSelectedWorkflowForWorkspace(v ?? null)}
              options={defs.map((d) => ({ value: d.name, label: d.name }))}
              style={{ minWidth: 260 }}
              aria-label="选择工作流"
            />
          </div>
          {selectedWorkflowForWorkspace ? (
            <WorkflowWorkspacePanel
              workflowName={selectedWorkflowForWorkspace}
              mode="overview"
              runsForWorkflow={runsForSelectedWorkflow}
              onSelectRun={handleWorkspaceSelectRun}
              onCancelRun={onCancelRun}
            />
          ) : (
            <EmptyState
              icon={FolderGit2}
              description="在上方选择工作流后可查看其持久空间文件与 Run 列表"
            />
          )}
        </ContentCard>
      </div>
    </div>
  )
}
