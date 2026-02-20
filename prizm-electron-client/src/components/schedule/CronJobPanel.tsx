/**
 * CronJobPanel — 定时任务管理面板
 * 显示 cron job 列表，支持暂停/恢复/触发/删除/查看日志
 */
import { useState, useCallback, useEffect, memo } from 'react'
import { ActionIcon, Button, Icon, toast } from '@lobehub/ui'
import { Modal, Tag, Collapse } from 'antd'
import {
  Clock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
  ChevronDown,
  AlertCircle
} from 'lucide-react'
import { motion } from 'motion/react'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { fadeUpStagger } from '../../theme/motionPresets'
import { useScheduleStore } from '../../store/scheduleStore'
import type { CronJob, CronRunLog } from '@prizm/shared'
import dayjs from 'dayjs'

const CRON_STATUS_META: Record<string, { color: string; label: string }> = {
  active: { color: 'green', label: '运行中' },
  paused: { color: 'default', label: '已暂停' },
  completed: { color: 'blue', label: '已完成' },
  failed: { color: 'red', label: '失败' }
}

function describeCron(expr: string): string {
  if (expr.startsWith('once:')) return `一次性: ${dayjs(expr.slice(5)).format('MM/DD HH:mm')}`

  const parts = expr.split(' ')
  if (parts.length < 5) return expr

  const [min, hour, dom, mon, dow] = parts

  if (min === '0' && hour === '*') return '每小时整点'
  if (min === '*/5') return '每 5 分钟'
  if (min === '*/10') return '每 10 分钟'
  if (min === '*/15') return '每 15 分钟'
  if (min === '*/30') return '每 30 分钟'
  if (hour !== '*' && dom === '*' && dow === '*') return `每天 ${hour}:${min.padStart(2, '0')}`
  if (dow !== '*' && dow !== '?') return `每周${dow}的 ${hour}:${min.padStart(2, '0')}`
  if (dom !== '*') return `每月${dom}日 ${hour}:${min.padStart(2, '0')}`

  return expr
}

interface CronJobCardProps {
  job: CronJob
  index: number
}

function CronJobCard({ job, index }: CronJobCardProps) {
  const { pauseCronJob, resumeCronJob, triggerCronJob, deleteCronJob, getCronJobLogs } = useScheduleStore.getState()
  const [logs, setLogs] = useState<CronRunLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const meta = CRON_STATUS_META[job.status] ?? { color: 'default', label: job.status }
  const lastRun = job.lastRunAt ? dayjs(job.lastRunAt).format('MM/DD HH:mm') : '从未'
  const nextRun = job.nextRunAt ? dayjs(job.nextRunAt).format('MM/DD HH:mm') : '-'

  const handlePause = useCallback(async () => {
    await pauseCronJob(job.id)
    toast.success('已暂停')
  }, [job.id, pauseCronJob])

  const handleResume = useCallback(async () => {
    await resumeCronJob(job.id)
    toast.success('已恢复')
  }, [job.id, resumeCronJob])

  const handleTrigger = useCallback(async () => {
    const sid = await triggerCronJob(job.id)
    if (sid) toast.success(`已触发，会话: ${sid.slice(0, 8)}`)
  }, [job.id, triggerCronJob])

  const handleDelete = useCallback(() => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除定时任务「${job.name}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteCronJob(job.id)
    })
  }, [job.id, job.name, deleteCronJob])

  const handleToggleLogs = useCallback(async () => {
    if (!expanded && logs.length === 0) {
      setLogsLoading(true)
      const result = await getCronJobLogs(job.id, 10)
      setLogs(result)
      setLogsLoading(false)
    }
    setExpanded((v) => !v)
  }, [expanded, logs.length, job.id, getCronJobLogs])

  return (
    <motion.div {...fadeUpStagger(index)}>
      <div className="sc-cron-card">
        <div className="sc-cron-card__header">
          <div className="sc-cron-card__name">{job.name}</div>
          <Tag color={meta.color} style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
            {meta.label}
          </Tag>
        </div>

        {job.description && (
          <div className="sc-cron-card__desc">{job.description}</div>
        )}

        <div className="sc-cron-card__schedule">
          <code>{describeCron(job.schedule)}</code>
          <span className="sc-cron-card__schedule-raw" title={job.schedule}>
            ({job.schedule})
          </span>
        </div>

        <div className="sc-cron-card__stats">
          <span>执行 {job.runCount} 次</span>
          <span>上次: {lastRun}</span>
          <span>下次: {nextRun}</span>
        </div>

        <div className="sc-cron-card__actions">
          {job.status === 'active' ? (
            <ActionIcon icon={Pause} size="small" title="暂停" onClick={handlePause} />
          ) : job.status === 'paused' ? (
            <ActionIcon icon={Play} size="small" title="恢复" onClick={handleResume} />
          ) : null}
          <ActionIcon icon={Zap} size="small" title="手动触发" onClick={handleTrigger} />
          <ActionIcon icon={Trash2} size="small" title="删除" onClick={handleDelete} />
          <button className="sc-cron-card__logs-btn" onClick={handleToggleLogs}>
            <Icon icon={ChevronDown} size={12} style={expanded ? { transform: 'rotate(180deg)' } : undefined} />
            日志
          </button>
        </div>

        {expanded && (
          <div className="sc-cron-card__logs">
            {logsLoading ? (
              <div className="sc-cron-card__logs-loading">加载中...</div>
            ) : logs.length === 0 ? (
              <div className="sc-cron-card__logs-empty">暂无执行日志</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className={`sc-cron-log sc-cron-log--${l.status}`}>
                  <span className="sc-cron-log__time">
                    {dayjs(l.startedAt).format('MM/DD HH:mm:ss')}
                  </span>
                  <Tag
                    color={l.status === 'success' ? 'green' : l.status === 'failed' ? 'red' : 'blue'}
                    style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
                  >
                    {l.status}
                  </Tag>
                  {l.durationMs != null && (
                    <span className="sc-cron-log__duration">{l.durationMs}ms</span>
                  )}
                  {l.error && (
                    <span className="sc-cron-log__error" title={l.error}>
                      <Icon icon={AlertCircle} size={10} /> {l.error.slice(0, 60)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

interface CronJobPanelProps {
  onAddClick?: () => void
}

export const CronJobPanel = memo(function CronJobPanel({ onAddClick }: CronJobPanelProps) {
  const cronJobs = useScheduleStore((s) => s.cronJobs)
  const refreshCronJobs = useScheduleStore((s) => s.refreshCronJobs)
  const currentScope = useScheduleStore((s) => s.currentScope)

  useEffect(() => {
    if (currentScope) void refreshCronJobs()
  }, [currentScope, refreshCronJobs])

  return (
    <div className="sc-cron-panel">
      <div className="sc-cron-panel__header">
        <span className="sc-cron-panel__title">
          <Icon icon={Clock} size={14} /> 定时任务
          {cronJobs.length > 0 && (
            <span className="sc-cron-panel__count">{cronJobs.length}</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <RefreshIconButton onClick={() => void refreshCronJobs()} title="刷新" />
          {onAddClick && (
            <ActionIcon icon={Plus} size="small" title="新建定时任务" onClick={onAddClick} />
          )}
        </div>
      </div>

      {cronJobs.length === 0 ? (
        <EmptyState icon={Clock} description="暂无定时任务" />
      ) : (
        <div className="sc-cron-panel__list">
          {cronJobs.map((job, i) => (
            <CronJobCard key={job.id} job={job} index={i} />
          ))}
        </div>
      )}
    </div>
  )
})
