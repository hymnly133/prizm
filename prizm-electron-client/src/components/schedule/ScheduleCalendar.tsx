/**
 * ScheduleCalendar — 纯 CSS Grid 月历视图
 * 7 列 x 6 行网格，日期格子显示日程圆点，点击展开日程列表
 */
import { useState, useMemo, useCallback, useEffect, memo } from 'react'
import { ActionIcon, Icon } from '@lobehub/ui'
import { Badge } from 'antd'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { ScheduleCard } from './ScheduleCard'
import { SCHEDULE_TYPE_META, DAY_LABELS } from './types'
import { useScheduleStore } from '../../store/scheduleStore'
import { fadeUp, EASE_SMOOTH } from '../../theme/motionPresets'
import type { ScheduleItem } from '@prizm/shared'
import dayjs from 'dayjs'

interface ScheduleCalendarProps {
  onItemClick?: (item: ScheduleItem) => void
  onAddClick?: (date: number) => void
}

export const ScheduleCalendar = memo(function ScheduleCalendar({
  onItemClick,
  onAddClick
}: ScheduleCalendarProps) {
  const calendarItems = useScheduleStore((s) => s.calendarItems)
  const calendarLoading = useScheduleStore((s) => s.calendarLoading)
  const refreshCalendar = useScheduleStore((s) => s.refreshCalendar)
  const currentScope = useScheduleStore((s) => s.currentScope)

  const [viewMonth, setViewMonth] = useState(() => dayjs().startOf('month'))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const rangeStart = useMemo(() => viewMonth.startOf('week').valueOf(), [viewMonth])
  const rangeEnd = useMemo(() => viewMonth.endOf('month').endOf('week').valueOf(), [viewMonth])

  useEffect(() => {
    if (currentScope) {
      void refreshCalendar(rangeStart, rangeEnd)
    }
  }, [currentScope, rangeStart, rangeEnd, refreshCalendar])

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>()
    for (const item of calendarItems) {
      if (item.status === 'cancelled') continue
      const key = dayjs(item.startTime).format('YYYY-MM-DD')
      const arr = map.get(key) ?? []
      arr.push(item)
      map.set(key, arr)
    }
    return map
  }, [calendarItems])

  const calendarDays = useMemo(() => {
    const days: dayjs.Dayjs[] = []
    let cursor = viewMonth.startOf('week')
    const endDate = viewMonth.endOf('month').endOf('week')
    while (cursor.isBefore(endDate) || cursor.isSame(endDate, 'day')) {
      days.push(cursor)
      cursor = cursor.add(1, 'day')
    }
    while (days.length < 42) {
      days.push(cursor)
      cursor = cursor.add(1, 'day')
    }
    return days
  }, [viewMonth])

  const today = useMemo(() => dayjs().format('YYYY-MM-DD'), [])

  const goToPrev = useCallback(() => {
    setViewMonth((m) => m.subtract(1, 'month'))
    setSelectedDay(null)
  }, [])

  const goToNext = useCallback(() => {
    setViewMonth((m) => m.add(1, 'month'))
    setSelectedDay(null)
  }, [])

  const goToToday = useCallback(() => {
    setViewMonth(dayjs().startOf('month'))
    setSelectedDay(dayjs().format('YYYY-MM-DD'))
  }, [])

  const handleDayClick = useCallback((dateKey: string) => {
    setSelectedDay((prev) => (prev === dateKey ? null : dateKey))
  }, [])

  const selectedItems = useMemo(() => {
    if (!selectedDay) return []
    return itemsByDate.get(selectedDay) ?? []
  }, [selectedDay, itemsByDate])

  return (
    <div className="sc-cal">
      {/* Month navigation */}
      <div className="sc-cal__nav">
        <ActionIcon icon={ChevronLeft} size="small" onClick={goToPrev} title="上个月" />
        <button className="sc-cal__month-btn" onClick={goToToday} title="回到今天">
          {viewMonth.format('YYYY 年 M 月')}
        </button>
        <ActionIcon icon={ChevronRight} size="small" onClick={goToNext} title="下个月" />
      </div>

      {/* Weekday header */}
      <div className="sc-cal__weekdays">
        {DAY_LABELS.map((label) => (
          <div key={label} className="sc-cal__weekday">{label}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="sc-cal__grid">
        {calendarDays.map((day) => {
          const dateKey = day.format('YYYY-MM-DD')
          const isCurrentMonth = day.month() === viewMonth.month()
          const isToday = dateKey === today
          const isSelected = dateKey === selectedDay
          const dayItems = itemsByDate.get(dateKey)
          const hasItems = dayItems && dayItems.length > 0

          const dotColors = hasItems
            ? [...new Set(dayItems.map((i) => SCHEDULE_TYPE_META[i.type]?.color ?? 'default'))].slice(0, 3)
            : []

          return (
            <button
              key={dateKey}
              className={[
                'sc-cal__cell',
                !isCurrentMonth && 'sc-cal__cell--other',
                isToday && 'sc-cal__cell--today',
                isSelected && 'sc-cal__cell--selected',
                hasItems && 'sc-cal__cell--has-events'
              ].filter(Boolean).join(' ')}
              onClick={() => handleDayClick(dateKey)}
              title={hasItems ? `${dayItems.length} 个日程` : undefined}
            >
              <span className="sc-cal__cell-num">{day.date()}</span>
              {hasItems && (
                <div className="sc-cal__cell-dots">
                  {dotColors.map((color) => (
                    <span key={color} className={`sc-cal__dot sc-cal__dot--${color}`} />
                  ))}
                  {dayItems.length > 3 && (
                    <span className="sc-cal__dot-more">+{dayItems.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day items panel */}
      <AnimatePresence mode="wait">
        {selectedDay && (
          <motion.div
            key={selectedDay}
            className="sc-cal__day-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
          >
            <div className="sc-cal__day-header">
              <span className="sc-cal__day-label">
                {dayjs(selectedDay).format('M 月 D 日 dddd')}
              </span>
              {onAddClick && (
                <ActionIcon
                  icon={CalendarDays}
                  size="small"
                  title="添加日程到此日"
                  onClick={() => onAddClick(dayjs(selectedDay).startOf('day').valueOf())}
                />
              )}
            </div>
            {selectedItems.length === 0 ? (
              <div className="sc-cal__day-empty">当天无日程</div>
            ) : (
              <div className="sc-cal__day-list">
                {selectedItems.map((item, i) => (
                  <motion.div key={item.id} {...fadeUp(i * 0.04)}>
                    <ScheduleCard item={item} compact onClick={() => onItemClick?.(item)} />
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {calendarLoading && (
        <div className="sc-cal__loading">加载中...</div>
      )}
    </div>
  )
})
