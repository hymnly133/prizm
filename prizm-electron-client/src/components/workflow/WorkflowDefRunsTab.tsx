/**
 * WorkflowDefRunsTab — 定义运行历史 Tab
 *
 * 状态过滤 Segmented + WorkflowRunCard 列表
 */

import { useMemo, useState } from 'react'
import { Button } from 'antd'
import { Segmented } from '../ui/Segmented'
import { EmptyState } from '../ui/EmptyState'
import { Play, RefreshCw } from 'lucide-react'
import type { WorkflowRun } from '@prizm/shared'
import { WorkflowRunCard } from './WorkflowRunCard'

type StatusFilter = '全部' | '运行中' | '已完成' | '失败'

export interface WorkflowDefRunsTabProps {
  runs: WorkflowRun[]
  loading?: boolean
  onSelectRun: (runId: string) => void
  onCancelRun: (runId: string) => void
  onRefresh: () => void
}

export function WorkflowDefRunsTab({
  runs,
  loading,
  onSelectRun,
  onCancelRun,
  onRefresh
}: WorkflowDefRunsTabProps) {
  const [filter, setFilter] = useState<StatusFilter>('全部')

  const filtered = useMemo(() => {
    const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt)
    switch (filter) {
      case '运行中':
        return sorted.filter(
          (r) => r.status === 'running' || r.status === 'pending' || r.status === 'paused'
        )
      case '已完成':
        return sorted.filter((r) => r.status === 'completed')
      case '失败':
        return sorted.filter((r) => r.status === 'failed')
      default:
        return sorted
    }
  }, [runs, filter])

  return (
    <div className="wfp-tab-content wfp-fade-appear">
      <div className="wfp-runs-tab__filters">
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as StatusFilter)}
          options={[
            { label: `全部 (${runs.length})`, value: '全部' },
            { label: '运行中', value: '运行中' },
            { label: '已完成', value: '已完成' },
            { label: '失败', value: '失败' }
          ]}
        />
        <Button
          size="small"
          icon={<RefreshCw size={14} />}
          loading={loading}
          onClick={onRefresh}
        >
          刷新
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Play}
          description={filter === '全部' ? '暂无运行记录' : `暂无${filter}的运行`}
          className="wfp-runs-tab__empty"
        />
      ) : (
        <div className="wfp-runs-list">
          {filtered.map((run) => (
            <WorkflowRunCard
              key={run.id}
              run={run}
              showName={false}
              onClick={() => onSelectRun(run.id)}
              onCancel={() => onCancelRun(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
