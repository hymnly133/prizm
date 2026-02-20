/**
 * Layer 1: Schedule (prizm_type: schedule) CRUD.
 */

import fs from 'fs'
import path from 'path'
import type { ScheduleItem, ScheduleStatus, ScheduleLinkedItem, RecurrenceRule } from '../../types'
import { scanUserFiles } from '../MetadataCache'
import {
  EXT,
  readMd,
  writeMd,
  readUserFilesByType,
  getScopeExcludePatterns,
  sanitizeFileName,
  resolveConflict,
  ensureDir,
  readPrizmType
} from './utils'

function parseScheduleItem(
  fp: string,
  d: Record<string, unknown>,
  _content: string,
  scopeRoot: string
): ScheduleItem | null {
  const id = typeof d.id === 'string' ? d.id : null
  if (!id) return null

  const validStatuses: ScheduleStatus[] = ['upcoming', 'active', 'completed', 'cancelled']
  const status = validStatuses.includes(d.status as ScheduleStatus)
    ? (d.status as ScheduleStatus)
    : 'upcoming'

  const validTypes = ['event', 'reminder', 'deadline']
  const type = validTypes.includes(d.type as string) ? (d.type as ScheduleItem['type']) : 'event'

  const relativePath = path.relative(scopeRoot, fp).replace(/\\/g, '/')

  return {
    id,
    title: typeof d.title === 'string' ? d.title : '(无标题)',
    description: typeof d.description === 'string' ? d.description : undefined,
    type,
    startTime: typeof d.startTime === 'number' ? d.startTime : 0,
    endTime: typeof d.endTime === 'number' ? d.endTime : undefined,
    allDay: typeof d.allDay === 'boolean' ? d.allDay : undefined,
    recurrence: parseRecurrence(d.recurrence),
    reminders: Array.isArray(d.reminders) ? d.reminders.filter((n): n is number => typeof n === 'number') : undefined,
    linkedItems: parseLinkedItems(d.linkedItems),
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : undefined,
    status,
    completedAt: typeof d.completedAt === 'number' ? d.completedAt : undefined,
    relativePath,
    createdAt: (d.createdAt as number) ?? 0,
    updatedAt: (d.updatedAt as number) ?? 0
  }
}

function parseRecurrence(raw: unknown): RecurrenceRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const validFreqs = ['daily', 'weekly', 'monthly', 'yearly', 'custom']
  if (!validFreqs.includes(r.frequency as string)) return undefined
  return {
    frequency: r.frequency as RecurrenceRule['frequency'],
    interval: typeof r.interval === 'number' ? r.interval : 1,
    daysOfWeek: Array.isArray(r.daysOfWeek) ? r.daysOfWeek.filter((n): n is number => typeof n === 'number') : undefined,
    dayOfMonth: typeof r.dayOfMonth === 'number' ? r.dayOfMonth : undefined,
    endDate: typeof r.endDate === 'number' ? r.endDate : undefined,
    maxOccurrences: typeof r.maxOccurrences === 'number' ? r.maxOccurrences : undefined
  }
}

function parseLinkedItems(raw: unknown): ScheduleLinkedItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
    .filter((item) => (item.type === 'todo' || item.type === 'document') && typeof item.id === 'string')
    .map((item) => ({
      type: item.type as 'todo' | 'document',
      id: item.id as string,
      title: typeof item.title === 'string' ? item.title : undefined
    }))
}

function buildFrontmatter(item: ScheduleItem): Record<string, unknown> {
  return {
    prizm_type: 'schedule',
    id: item.id,
    title: item.title,
    ...(item.description && { description: item.description }),
    type: item.type,
    startTime: item.startTime,
    ...(item.endTime != null && { endTime: item.endTime }),
    ...(item.allDay != null && { allDay: item.allDay }),
    ...(item.recurrence && { recurrence: item.recurrence }),
    ...(item.reminders && item.reminders.length > 0 && { reminders: item.reminders }),
    ...(item.linkedItems && item.linkedItems.length > 0 && { linkedItems: item.linkedItems }),
    ...(item.tags && item.tags.length > 0 && { tags: item.tags }),
    status: item.status,
    ...(item.completedAt && { completedAt: item.completedAt }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

export function readScheduleItems(scopeRoot: string): ScheduleItem[] {
  const items = readUserFilesByType(scopeRoot, 'schedule', (fp, d, c) =>
    parseScheduleItem(fp, d, c, scopeRoot)
  )
  return items.sort((a, b) => a.startTime - b.startTime)
}

export function readScheduleItemsByRange(
  scopeRoot: string,
  startMs: number,
  endMs: number
): ScheduleItem[] {
  const all = readScheduleItems(scopeRoot)
  return all.filter((item) => {
    const itemEnd = item.endTime ?? item.startTime
    return item.startTime <= endMs && itemEnd >= startMs
  })
}

export function readSingleScheduleById(root: string, scheduleId: string): ScheduleItem | null {
  const excludes = getScopeExcludePatterns(root)
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'schedule' && p.data.id === scheduleId) {
      return parseScheduleItem(fp, p.data, p.content, root)
    }
  }
  return null
}

export function writeSingleSchedule(root: string, item: ScheduleItem): string {
  const frontmatter = buildFrontmatter(item)

  const excludes = getScopeExcludePatterns(root)
  let existingPath: string | undefined
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'schedule' && p.data.id === item.id) {
      existingPath = fp
      break
    }
  }

  let fp: string
  if (existingPath) {
    const oldBaseName = path.basename(existingPath, EXT)
    const expectedBaseName = sanitizeFileName(item.title)
    if (oldBaseName !== expectedBaseName) {
      const dir = path.dirname(existingPath)
      fp = resolveConflict(dir, expectedBaseName, EXT, existingPath)
      if (existingPath !== fp) {
        try { fs.unlinkSync(existingPath) } catch {}
      }
    } else {
      fp = existingPath
    }
  } else {
    const dir = item.relativePath ? path.dirname(path.join(root, item.relativePath)) : root
    ensureDir(dir)
    fp = resolveConflict(dir, sanitizeFileName(item.title), EXT)
  }

  writeMd(fp, frontmatter, item.description ?? '')
  return path.relative(root, fp).replace(/\\/g, '/')
}

export function deleteSingleSchedule(root: string, scheduleId: string): boolean {
  const excludes = getScopeExcludePatterns(root)
  for (const fp of scanUserFiles(root, excludes)) {
    const p = readMd(fp)
    if (p && readPrizmType(p.data) === 'schedule' && p.data.id === scheduleId) {
      try {
        fs.unlinkSync(fp)
        return true
      } catch {
        return false
      }
    }
  }
  return false
}

/**
 * Expand a recurring schedule item into individual occurrences within a date range.
 * Returns virtual ScheduleItem instances (same id, different startTime/endTime).
 */
export function expandRecurrence(
  item: ScheduleItem,
  rangeStart: number,
  rangeEnd: number
): ScheduleItem[] {
  if (!item.recurrence) return [item]

  const rule = item.recurrence
  const duration = (item.endTime ?? item.startTime) - item.startTime
  const occurrences: ScheduleItem[] = []
  let count = 0
  const maxOccurrences = rule.maxOccurrences ?? 365

  const startDate = new Date(item.startTime)
  let current = new Date(startDate)

  while (current.getTime() <= rangeEnd && count < maxOccurrences) {
    if (rule.endDate && current.getTime() > rule.endDate) break

    const occStart = current.getTime()
    const occEnd = occStart + duration

    if (occEnd >= rangeStart && occStart <= rangeEnd) {
      occurrences.push({
        ...item,
        startTime: occStart,
        endTime: item.endTime != null ? occEnd : undefined,
        recurrence: item.recurrence
      })
    }

    current = advanceDate(current, rule)
    count++
  }

  return occurrences
}

function advanceDate(date: Date, rule: RecurrenceRule): Date {
  const next = new Date(date)
  const interval = rule.interval || 1

  switch (rule.frequency) {
    case 'daily':
      next.setDate(next.getDate() + interval)
      break
    case 'weekly':
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        let advanced = false
        for (let i = 1; i <= 7 * interval; i++) {
          const candidate = new Date(date)
          candidate.setDate(candidate.getDate() + i)
          if (rule.daysOfWeek.includes(candidate.getDay())) {
            next.setTime(candidate.getTime())
            advanced = true
            break
          }
        }
        if (!advanced) next.setDate(next.getDate() + 7 * interval)
      } else {
        next.setDate(next.getDate() + 7 * interval)
      }
      break
    case 'monthly':
      next.setMonth(next.getMonth() + interval)
      if (rule.dayOfMonth) {
        const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
        next.setDate(Math.min(rule.dayOfMonth, maxDay))
      }
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + interval)
      break
    case 'custom':
      next.setDate(next.getDate() + interval)
      break
  }

  return next
}

/**
 * Read schedule items within a range, expanding recurring items.
 */
export function readScheduleItemsExpanded(
  scopeRoot: string,
  startMs: number,
  endMs: number
): ScheduleItem[] {
  const all = readScheduleItems(scopeRoot)
  const result: ScheduleItem[] = []

  for (const item of all) {
    if (item.recurrence) {
      result.push(...expandRecurrence(item, startMs, endMs))
    } else {
      const itemEnd = item.endTime ?? item.startTime
      if (item.startTime <= endMs && itemEnd >= startMs) {
        result.push(item)
      }
    }
  }

  return result.sort((a, b) => a.startTime - b.startTime)
}

/**
 * Detect schedule conflicts within a time range.
 * Returns pairs of conflicting schedule items.
 */
export function detectConflicts(
  scopeRoot: string,
  startMs: number,
  endMs: number
): Array<[ScheduleItem, ScheduleItem]> {
  const items = readScheduleItemsExpanded(scopeRoot, startMs, endMs).filter(
    (i) => i.type === 'event' && i.status !== 'cancelled' && i.status !== 'completed'
  )

  const conflicts: Array<[ScheduleItem, ScheduleItem]> = []

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (a.allDay || b.allDay) continue

      const aEnd = a.endTime ?? a.startTime
      const bEnd = b.endTime ?? b.startTime

      if (a.startTime < bEnd && b.startTime < aEnd) {
        conflicts.push([a, b])
      }
    }
  }

  return conflicts
}

/** Find schedule items linked to a specific todo or document */
export function findSchedulesByLinkedItem(
  root: string,
  linkedType: 'todo' | 'document',
  linkedId: string
): ScheduleItem[] {
  const all = readScheduleItems(root)
  return all.filter((item) =>
    item.linkedItems?.some((link) => link.type === linkedType && link.id === linkedId)
  )
}
