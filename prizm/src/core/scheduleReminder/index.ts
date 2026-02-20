/**
 * Schedule Reminder Service
 *
 * Periodically checks upcoming schedule items for reminders
 * and emits schedule:reminded events when it's time to notify.
 */

import { createLogger } from '../../logger'
import { emit } from '../eventBus/eventBus'
import { scopeStore } from '../ScopeStore'
import { readScheduleItems } from '../mdStore'
import type { ScheduleItem } from '@prizm/shared'

const log = createLogger('ScheduleReminder')

const CHECK_INTERVAL_MS = 60_000
const EXPIRY_MS = 24 * 60 * 60_000

/** key → timestamp when fired, enables time-based expiry instead of size-based clear */
const firedReminders = new Map<string, number>()

let _timer: ReturnType<typeof setInterval> | null = null

export function startReminderService(): void {
  if (_timer) return

  _timer = setInterval(checkReminders, CHECK_INTERVAL_MS)
  log.info('Schedule reminder service started')
}

export function stopReminderService(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  firedReminders.clear()
  log.info('Schedule reminder service stopped')
}

function cleanupExpiredReminders(nowMs: number): void {
  const cutoff = nowMs - EXPIRY_MS
  for (const [key, ts] of firedReminders) {
    if (ts < cutoff) firedReminders.delete(key)
  }
}

function checkReminders(): void {
  const now = Date.now()

  cleanupExpiredReminders(now)

  for (const scope of scopeStore.getAllScopes()) {
    try {
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const items = readScheduleItems(scopeRoot)

      for (const item of items) {
        if (item.status === 'completed' || item.status === 'cancelled') continue
        if (!item.reminders || item.reminders.length === 0) continue

        for (const minutesBefore of item.reminders) {
          const reminderTime = item.startTime - minutesBefore * 60_000
          const key = `${item.id}:${minutesBefore}`

          if (firedReminders.has(key)) continue
          if (now >= reminderTime && now < item.startTime) {
            firedReminders.set(key, now)

            void emit('schedule:reminded', {
              scope,
              scheduleId: item.id,
              title: item.title,
              startTime: item.startTime,
              reminderMinutes: minutesBefore
            })

            log.info(`Reminder fired: "${item.title}" in ${minutesBefore}min (scope: ${scope})`)
          }
        }
      }
    } catch (err) {
      log.warn(`Reminder check failed for scope ${scope}:`, err)
    }
  }
}
