/**
 * ScheduleConflictBadge — 冲突警告徽标
 */
import { useEffect, useMemo, memo } from 'react'
import { Badge, Tooltip } from 'antd'
import { AlertTriangle } from 'lucide-react'
import { Icon } from '@lobehub/ui'
import { useScheduleStore } from '../../store/scheduleStore'
import dayjs from 'dayjs'

export const ScheduleConflictBadge = memo(function ScheduleConflictBadge() {
  const conflicts = useScheduleStore((s) => s.conflicts)
  const refreshConflicts = useScheduleStore((s) => s.refreshConflicts)
  const currentScope = useScheduleStore((s) => s.currentScope)

  useEffect(() => {
    if (!currentScope) return
    const now = dayjs()
    const from = now.startOf('day').valueOf()
    const to = now.add(30, 'day').endOf('day').valueOf()
    void refreshConflicts(from, to)
  }, [currentScope, refreshConflicts])

  if (conflicts.length === 0) return null

  const tooltipContent = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{conflicts.length} 个日程冲突</div>
      {conflicts.slice(0, 3).map((c, i) => (
        <div key={i} style={{ fontSize: 12 }}>
          「{c.schedule1.title}」与「{c.schedule2.title}」
        </div>
      ))}
      {conflicts.length > 3 && (
        <div style={{ fontSize: 12, opacity: 0.7 }}>…还有 {conflicts.length - 3} 个</div>
      )}
    </div>
  )

  return (
    <Tooltip title={tooltipContent}>
      <Badge count={conflicts.length} size="small" offset={[-4, 4]}>
        <Icon icon={AlertTriangle} size={14} style={{ color: 'var(--ant-color-warning)' }} />
      </Badge>
    </Tooltip>
  )
})
