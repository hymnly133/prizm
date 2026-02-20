/**
 * ScheduleTimeline — 分组时间线视图
 * 从 WorkPage 内联提取为独立组件，增加点击/快速操作交互
 */
import { useMemo, useCallback, memo, useEffect } from 'react'
import { ActionIcon, Icon } from '@lobehub/ui'
import { Tag } from 'antd'
import { Calendar, Check, CheckCircle2, Clock, Plus, Repeat } from 'lucide-react'
import { SectionHeader } from '../ui/SectionHeader'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { EmptyState } from '../ui/EmptyState'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { SCHEDULE_TYPE_META, getRecurrenceLabel } from './types'
import { useScheduleStore } from '../../store/scheduleStore'
import type { ScheduleItem } from '@prizm/shared'
import dayjs from 'dayjs'

interface ScheduleTimelineProps {
  onItemClick?: (item: ScheduleItem) => void
  onAddClick?: () => void
  showHeader?: boolean
}

export const ScheduleTimeline = memo(function ScheduleTimeline({
  onItemClick,
  onAddClick,
  showHeader = true
}: ScheduleTimelineProps) {
  const schedules = useScheduleStore((s) => s.schedules)
  const loading = useScheduleStore((s) => s.loading)
  const refreshSchedules = useScheduleStore((s) => s.refreshSchedules)
  const updateSchedule = useScheduleStore((s) => s.updateSchedule)
  const currentScope = useScheduleStore((s) => s.currentScope)

  useEffect(() => {
    if (currentScope) void refreshSchedules()
  }, [currentScope, refreshSchedules])

  const grouped = useMemo(() => {
    const upcoming = schedules
      .filter((s) => s.status !== 'completed' && s.status !== 'cancelled')
      .sort((a, b) => a.startTime - b.startTime)

    const groups: { label: string; key: string; items: ScheduleItem[] }[] = []
    const now = dayjs()
    const today = now.startOf('day')
    const tomorrow = today.add(1, 'day')
    const weekEnd = today.add(7, 'day')

    const buckets = {
      overdue: [] as ScheduleItem[],
      today: [] as ScheduleItem[],
      tomorrow: [] as ScheduleItem[],
      thisWeek: [] as ScheduleItem[],
      later: [] as ScheduleItem[]
    }

    for (const item of upcoming) {
      const d = dayjs(item.startTime)
      if (d.isBefore(today)) buckets.overdue.push(item)
      else if (d.isBefore(tomorrow)) buckets.today.push(item)
      else if (d.isBefore(tomorrow.add(1, 'day'))) buckets.tomorrow.push(item)
      else if (d.isBefore(weekEnd)) buckets.thisWeek.push(item)
      else buckets.later.push(item)
    }

    if (buckets.overdue.length) groups.push({ label: '已过期', key: 'overdue', items: buckets.overdue })
    if (buckets.today.length) groups.push({ label: '今天', key: 'today', items: buckets.today })
    if (buckets.tomorrow.length) groups.push({ label: '明天', key: 'tomorrow', items: buckets.tomorrow })
    if (buckets.thisWeek.length) groups.push({ label: '本周', key: 'thisWeek', items: buckets.thisWeek })
    if (buckets.later.length) groups.push({ label: '之后', key: 'later', items: buckets.later })

    return groups
  }, [schedules])

  const completedCount = useMemo(
    () => schedules.filter((s) => s.status === 'completed').length,
    [schedules]
  )

  const handleComplete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      void updateSchedule(id, { status: 'completed' })
    },
    [updateSchedule]
  )

  return (
    <div className="sc-timeline">
      {showHeader && (
        <SectionHeader
          icon={Calendar}
          title="日程"
          count={schedules.length}
          extra={
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <RefreshIconButton onClick={() => void refreshSchedules()} disabled={loading} title="刷新" />
              {onAddClick && (
                <ActionIcon icon={Plus} size="small" title="新建日程" onClick={onAddClick} />
              )}
            </div>
          }
        />
      )}

      {loading ? (
        <LoadingPlaceholder />
      ) : grouped.length === 0 ? (
        <EmptyState icon={Calendar} description="暂无即将到来的日程" />
      ) : (
        <div className="sc-timeline__body">
          {grouped.map((group) => (
            <div key={group.key} className="sc-timeline__group">
              <div className={`sc-timeline__group-label ${group.key === 'overdue' ? 'sc-timeline__group-label--overdue' : ''}`}>
                {group.label}
                <span className="sc-timeline__group-count">{group.items.length}</span>
              </div>
              <div className="sc-timeline__group-items">
                {group.items.map((item) => {
                  const meta = SCHEDULE_TYPE_META[item.type] ?? { color: 'default', label: item.type }
                  const timeStr = item.allDay ? '全天' : dayjs(item.startTime).format('HH:mm')
                  const recLabel = getRecurrenceLabel(item)
                  return (
                    <div
                      key={item.id}
                      className="sc-timeline__item"
                      role="button"
                      tabIndex={0}
                      onClick={() => onItemClick?.(item)}
                      onKeyDown={(e) => e.key === 'Enter' && onItemClick?.(item)}
                    >
                      <div className="sc-timeline__item-time">{timeStr}</div>
                      <div className="sc-timeline__item-indicator">
                        <span className={`sc-timeline__item-dot sc-timeline__item-dot--${meta.color}`} />
                      </div>
                      <div className="sc-timeline__item-body">
                        <span className="sc-timeline__item-title">{item.title}</span>
                        {item.description && (
                          <span className="sc-timeline__item-desc">
                            {item.description.length > 50 ? item.description.slice(0, 50) + '…' : item.description}
                          </span>
                        )}
                        <div className="sc-timeline__item-tags">
                          <Tag color={meta.color} style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>{meta.label}</Tag>
                          {recLabel && (
                            <span className="sc-timeline__item-recurrence">
                              <Icon icon={Repeat} size={10} /> {recLabel}
                            </span>
                          )}
                          {item.endTime && !item.allDay && (
                            <span className="sc-timeline__item-duration">
                              {Math.round((item.endTime - item.startTime) / 60000)} 分钟
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className="sc-timeline__item-actions"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={() => {}}
                      >
                        <ActionIcon
                          icon={Check}
                          size="small"
                          title="完成"
                          onClick={(e: React.MouseEvent) => handleComplete(e, item.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {completedCount > 0 && (
            <div className="sc-timeline__completed">
              <CheckCircle2 size={14} /> 已完成 {completedCount} 项日程
            </div>
          )}
        </div>
      )}
    </div>
  )
})
