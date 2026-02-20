/**
 * ScheduleCard — 复用日程卡片组件
 * 用于时间线列表、月历日详情等场景
 */
import { useCallback } from 'react'
import { ActionIcon, Icon } from '@lobehub/ui'
import { Tag } from 'antd'
import { Check, Clock, Link2, Repeat, Trash2, X } from 'lucide-react'
import { SCHEDULE_TYPE_META, getRecurrenceLabel } from './types'
import type { ScheduleItem } from '@prizm/shared'
import dayjs from 'dayjs'

interface ScheduleCardProps {
  item: ScheduleItem
  compact?: boolean
  onClick?: (item: ScheduleItem) => void
  onComplete?: (id: string) => void
  onCancel?: (id: string) => void
  onDelete?: (id: string) => void
}

export function ScheduleCard({
  item,
  compact,
  onClick,
  onComplete,
  onCancel,
  onDelete
}: ScheduleCardProps) {
  const meta = SCHEDULE_TYPE_META[item.type] ?? { color: 'default', label: item.type }
  const recLabel = getRecurrenceLabel(item)
  const isFinished = item.status === 'completed' || item.status === 'cancelled'

  const timeStr = item.allDay
    ? '全天'
    : dayjs(item.startTime).format('HH:mm')
  const endStr = item.endTime && !item.allDay
    ? dayjs(item.endTime).format('HH:mm')
    : null
  const dateStr = dayjs(item.startTime).format('MM/DD')

  const handleClick = useCallback(() => {
    onClick?.(item)
  }, [onClick, item])

  const stopProp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  if (compact) {
    return (
      <div
        className={`sc-card sc-card--compact ${isFinished ? 'sc-card--finished' : ''}`}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      >
        <span className={`sc-card__dot sc-card__dot--${meta.color}`} />
        <span className="sc-card__time">{timeStr}</span>
        <span className="sc-card__title">{item.title}</span>
        {recLabel && <Icon icon={Repeat} size={11} style={{ opacity: 0.5 }} />}
      </div>
    )
  }

  return (
    <div
      className={`sc-card ${isFinished ? 'sc-card--finished' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <div className="sc-card__header">
        <div className="sc-card__tags">
          <Tag color={meta.color} style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
            {meta.label}
          </Tag>
          {recLabel && (
            <Tag color="purple" style={{ fontSize: 11, lineHeight: '18px', margin: 0 }}>
              <Icon icon={Repeat} size={10} /> {recLabel}
            </Tag>
          )}
          {item.linkedItems && item.linkedItems.length > 0 && (
            <Icon icon={Link2} size={12} style={{ color: 'var(--ant-color-text-quaternary)' }} />
          )}
        </div>
        {!isFinished && (
          <div className="sc-card__actions" onClick={stopProp} onKeyDown={() => {}}>
            {onComplete && (
              <ActionIcon icon={Check} size="small" title="完成" onClick={() => onComplete(item.id)} />
            )}
            {onCancel && (
              <ActionIcon icon={X} size="small" title="取消" onClick={() => onCancel(item.id)} />
            )}
            {onDelete && (
              <ActionIcon icon={Trash2} size="small" title="删除" onClick={() => onDelete(item.id)} />
            )}
          </div>
        )}
      </div>

      <div className="sc-card__title">{item.title}</div>

      <div className="sc-card__time-row">
        <Icon icon={Clock} size={12} />
        <span>
          {dateStr} {timeStr}
          {endStr && ` – ${endStr}`}
        </span>
        {item.endTime && !item.allDay && (
          <span className="sc-card__duration">
            {Math.round((item.endTime - item.startTime) / 60000)} 分钟
          </span>
        )}
      </div>

      {item.description && (
        <div className="sc-card__desc">
          {item.description.length > 80 ? item.description.slice(0, 80) + '…' : item.description}
        </div>
      )}

      {item.tags && item.tags.length > 0 && (
        <div className="sc-card__tag-row">
          {item.tags.map((t) => (
            <Tag key={t} style={{ fontSize: 11, margin: 0 }}>{t}</Tag>
          ))}
        </div>
      )}
    </div>
  )
}
