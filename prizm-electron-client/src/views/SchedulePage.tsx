/**
 * SchedulePage — 日程管理入口
 *
 * 功能已完全迁移到 components/schedule/ 组件库并集成到 WorkPage 侧边栏。
 * 此页面保留为独立全屏入口，复用组件库实现。
 */
import { useState, useCallback, useEffect } from 'react'
import { ActionIcon, Icon } from '@lobehub/ui'
import { Calendar, Plus } from 'lucide-react'
import { Segmented } from '../components/ui/Segmented'
import { SectionHeader } from '../components/ui/SectionHeader'
import { RefreshIconButton } from '../components/ui/RefreshIconButton'
import {
  ScheduleTimeline,
  ScheduleCalendar,
  ScheduleDetailDrawer,
  ScheduleCreateModal,
  ScheduleConflictBadge,
  CronJobPanel,
  CronJobCreateModal
} from '../components/schedule'
import type { ScheduleViewMode } from '../components/schedule'
import { useScheduleStore } from '../store/scheduleStore'
import type { ScheduleItem } from '@prizm/shared'

export default function SchedulePage() {
  const schedules = useScheduleStore((s) => s.schedules)
  const loading = useScheduleStore((s) => s.loading)
  const refreshSchedules = useScheduleStore((s) => s.refreshSchedules)
  const refreshCronJobs = useScheduleStore((s) => s.refreshCronJobs)
  const selectedScheduleId = useScheduleStore((s) => s.selectedScheduleId)
  const setSelectedScheduleId = useScheduleStore((s) => s.setSelectedScheduleId)
  const currentScope = useScheduleStore((s) => s.currentScope)

  const [tab, setTab] = useState<ScheduleViewMode>('timeline')
  const [createOpen, setCreateOpen] = useState(false)
  const [cronCreateOpen, setCronCreateOpen] = useState(false)
  const [createInitialDate, setCreateInitialDate] = useState<number | undefined>()

  useEffect(() => {
    if (!currentScope) return
    void refreshSchedules()
    void refreshCronJobs()
  }, [currentScope, refreshSchedules, refreshCronJobs])

  const handleItemClick = useCallback(
    (item: ScheduleItem) => setSelectedScheduleId(item.id),
    [setSelectedScheduleId]
  )

  const handleAddClick = useCallback((date?: number) => {
    setCreateInitialDate(date)
    setCreateOpen(true)
  }, [])

  const handleRefresh = useCallback(() => {
    void refreshSchedules()
    void refreshCronJobs()
  }, [refreshSchedules, refreshCronJobs])

  return (
    <div className="schedule-page">
      <div className="schedule-page-header">
        <SectionHeader icon={Calendar} title="日程" count={schedules.length} />
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ScheduleConflictBadge />
          <Segmented
            size="small"
            value={tab}
            onChange={(v) => setTab(v as ScheduleViewMode)}
            options={[
              { label: '时间线', value: 'timeline' },
              { label: '月历', value: 'calendar' },
              { label: '定时任务', value: 'cron' }
            ]}
          />
          <RefreshIconButton onClick={handleRefresh} disabled={loading} title="刷新" />
          <ActionIcon
            icon={Plus}
            size="small"
            title={tab === 'cron' ? '新建定时任务' : '新建日程'}
            onClick={() =>
              tab === 'cron' ? setCronCreateOpen(true) : handleAddClick()
            }
          />
        </span>
      </div>

      <div className="schedule-page-content" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'timeline' && (
          <ScheduleTimeline
            showHeader={false}
            onItemClick={handleItemClick}
            onAddClick={() => handleAddClick()}
          />
        )}
        {tab === 'calendar' && (
          <ScheduleCalendar
            onItemClick={handleItemClick}
            onAddClick={(date) => handleAddClick(date)}
          />
        )}
        {tab === 'cron' && (
          <CronJobPanel onAddClick={() => setCronCreateOpen(true)} />
        )}
      </div>

      <ScheduleDetailDrawer
        open={!!selectedScheduleId}
        scheduleId={selectedScheduleId}
        onClose={() => setSelectedScheduleId(null)}
      />
      <ScheduleCreateModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateInitialDate(undefined) }}
        initialDate={createInitialDate}
      />
      <CronJobCreateModal
        open={cronCreateOpen}
        onClose={() => setCronCreateOpen(false)}
      />
    </div>
  )
}
