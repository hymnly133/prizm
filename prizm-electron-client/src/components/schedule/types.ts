/**
 * Schedule 组件内部类型
 */
import type { ScheduleItem } from '@prizm/shared'

export type ScheduleViewMode = 'timeline' | 'calendar' | 'cron'

export const SCHEDULE_TYPE_META: Record<string, { color: string; label: string }> = {
  event: { color: 'blue', label: '事件' },
  reminder: { color: 'orange', label: '提醒' },
  deadline: { color: 'red', label: '截止' }
}

export const SCHEDULE_STATUS_META: Record<string, { color: string; label: string }> = {
  upcoming: { color: 'default', label: '即将到来' },
  active: { color: 'processing', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  cancelled: { color: 'default', label: '已取消' }
}

export const REMINDER_OPTIONS = [
  { value: 5, label: '5 分钟前' },
  { value: 15, label: '15 分钟前' },
  { value: 30, label: '30 分钟前' },
  { value: 60, label: '1 小时前' },
  { value: 120, label: '2 小时前' },
  { value: 1440, label: '1 天前' }
]

export const RECURRENCE_FREQ_LABELS: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
  custom: '自定义'
}

export const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function getRecurrenceLabel(item: ScheduleItem): string | null {
  if (!item.recurrence) return null
  const freq = RECURRENCE_FREQ_LABELS[item.recurrence.frequency] ?? item.recurrence.frequency
  const interval = item.recurrence.interval
  if (interval === 1) return freq
  return `每 ${interval} ${freq.replace('每', '')}`
}
