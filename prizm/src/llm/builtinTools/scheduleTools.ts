/**
 * 内置工具：日程管理
 *
 * Action: list / read / create / update / delete / link / unlink
 */

import {
  readScheduleItems,
  readScheduleItemsByRange,
  readSingleScheduleById,
  writeSingleSchedule,
  deleteSingleSchedule,
  findSchedulesByLinkedItem
} from '../../core/mdStore'
import { scopeStore } from '../../core/ScopeStore'
import { emit } from '../../core/eventBus'
import { genUniqueId } from '../../id'
import type { ScheduleItem, ScheduleLinkedItem, RecurrenceRule } from '@prizm/shared'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

function buildOpCtx(ctx: BuiltinToolContext) {
  return {
    scope: ctx.scope,
    actor: {
      type: 'agent' as const,
      sessionId: ctx.sessionId,
      source: `tool:${ctx.toolName}`
    }
  }
}

export function executeList(ctx: BuiltinToolContext): BuiltinToolResult {
  const scopeRoot = ctx.scopeRoot
  const from = typeof ctx.args.from === 'string' ? new Date(ctx.args.from).getTime() : undefined
  const to = typeof ctx.args.to === 'string' ? new Date(ctx.args.to).getTime() : undefined

  let items: ScheduleItem[]
  if (from && to && !isNaN(from) && !isNaN(to)) {
    items = readScheduleItemsByRange(scopeRoot, from, to)
  } else {
    items = readScheduleItems(scopeRoot)
  }

  if (items.length === 0) {
    return { text: '当前没有日程。' }
  }

  const lines = items.map((s) => {
    const start = new Date(s.startTime).toLocaleString()
    const linked = s.linkedItems?.length ? ` [关联${s.linkedItems.length}项]` : ''
    const rec = s.recurrence ? ` (循环:${s.recurrence.frequency})` : ''
    return `- [${s.status}] ${s.title} (${s.type}) | ${start}${rec}${linked} | id:${s.id}`
  })
  return { text: `共 ${items.length} 个日程：\n${lines.join('\n')}` }
}

export function executeRead(ctx: BuiltinToolContext): BuiltinToolResult {
  const id = typeof ctx.args.scheduleId === 'string' ? ctx.args.scheduleId : ''
  if (!id) return { text: '需要 scheduleId', isError: true }

  const item = readSingleScheduleById(ctx.scopeRoot, id)
  if (!item) return { text: `日程 ${id} 不存在`, isError: true }

  const lines = [
    `标题: ${item.title}`,
    `类型: ${item.type}`,
    `状态: ${item.status}`,
    `开始: ${new Date(item.startTime).toLocaleString()}`,
    item.endTime ? `结束: ${new Date(item.endTime).toLocaleString()}` : null,
    item.allDay ? '全天事件' : null,
    item.description ? `描述: ${item.description}` : null,
    item.recurrence ? `循环: ${JSON.stringify(item.recurrence)}` : null,
    item.reminders?.length ? `提醒: 提前 ${item.reminders.join(', ')} 分钟` : null,
    item.tags?.length ? `标签: ${item.tags.join(', ')}` : null,
    item.linkedItems?.length
      ? `关联: ${item.linkedItems.map((l) => `${l.type}:${l.id}`).join(', ')}`
      : null,
    `ID: ${item.id}`
  ].filter(Boolean)

  ctx.record(item.id, 'document', 'read')
  return { text: lines.join('\n') }
}

export async function executeCreate(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const title = typeof ctx.args.title === 'string' ? ctx.args.title.trim() : ''
  if (!title) return { text: '需要 title', isError: true }

  const startTimeStr = typeof ctx.args.startTime === 'string' ? ctx.args.startTime : ''
  const startTime = startTimeStr ? new Date(startTimeStr).getTime() : 0
  if (!startTime || isNaN(startTime))
    return { text: '需要有效的 startTime (ISO 日期格式)', isError: true }

  const endTimeStr = typeof ctx.args.endTime === 'string' ? ctx.args.endTime : ''
  const endTime = endTimeStr ? new Date(endTimeStr).getTime() : undefined

  const type =
    typeof ctx.args.type === 'string' && ['event', 'reminder', 'deadline'].includes(ctx.args.type)
      ? (ctx.args.type as ScheduleItem['type'])
      : 'event'

  let recurrence: RecurrenceRule | undefined
  if (typeof ctx.args.recurrence === 'string') {
    try {
      recurrence = JSON.parse(ctx.args.recurrence)
    } catch {
      /* ignore */
    }
  }

  const reminders = Array.isArray(ctx.args.reminders)
    ? ctx.args.reminders.filter((n): n is number => typeof n === 'number')
    : undefined

  const now = Date.now()
  const item: ScheduleItem = {
    id: genUniqueId(),
    title,
    description: typeof ctx.args.description === 'string' ? ctx.args.description : undefined,
    type,
    startTime,
    endTime,
    allDay: typeof ctx.args.allDay === 'boolean' ? ctx.args.allDay : undefined,
    recurrence,
    reminders,
    tags: Array.isArray(ctx.args.tags)
      ? ctx.args.tags.filter((t): t is string => typeof t === 'string')
      : undefined,
    status: 'upcoming',
    relativePath: '',
    createdAt: now,
    updatedAt: now
  }

  const relativePath = writeSingleSchedule(ctx.scopeRoot, item)
  item.relativePath = relativePath

  const opCtx = buildOpCtx(ctx)
  void emit('schedule:created', {
    scope: ctx.scope,
    scheduleId: item.id,
    title: item.title,
    type: item.type,
    startTime: item.startTime,
    actor: opCtx.actor
  })

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'create',
    resourceType: 'schedule',
    resourceId: item.id,
    resourceTitle: item.title,
    result: 'success'
  })

  return {
    text: `日程已创建: "${item.title}" (${item.type}) | ${new Date(
      item.startTime
    ).toLocaleString()} | id:${item.id}`
  }
}

export async function executeUpdate(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.scheduleId === 'string' ? ctx.args.scheduleId : ''
  if (!id) return { text: '需要 scheduleId', isError: true }

  const existing = readSingleScheduleById(ctx.scopeRoot, id)
  if (!existing) return { text: `日程 ${id} 不存在`, isError: true }

  const now = Date.now()
  const updated: ScheduleItem = { ...existing, updatedAt: now }

  if (typeof ctx.args.title === 'string') updated.title = ctx.args.title
  if (typeof ctx.args.description === 'string') updated.description = ctx.args.description
  if (
    typeof ctx.args.type === 'string' &&
    ['event', 'reminder', 'deadline'].includes(ctx.args.type)
  ) {
    updated.type = ctx.args.type as ScheduleItem['type']
  }
  if (typeof ctx.args.startTime === 'string') {
    const t = new Date(ctx.args.startTime).getTime()
    if (!isNaN(t)) updated.startTime = t
  }
  if (typeof ctx.args.endTime === 'string') {
    const t = new Date(ctx.args.endTime).getTime()
    if (!isNaN(t)) updated.endTime = t
  }
  if (typeof ctx.args.allDay === 'boolean') updated.allDay = ctx.args.allDay
  if (typeof ctx.args.status === 'string') {
    const valid = ['upcoming', 'active', 'completed', 'cancelled']
    if (valid.includes(ctx.args.status)) {
      updated.status = ctx.args.status as ScheduleItem['status']
      if (ctx.args.status === 'completed') updated.completedAt = now
    }
  }

  writeSingleSchedule(ctx.scopeRoot, updated)

  const opCtx = buildOpCtx(ctx)
  void emit('schedule:updated', {
    scope: ctx.scope,
    scheduleId: id,
    title: updated.title,
    status: updated.status,
    actor: opCtx.actor
  })

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'update',
    resourceType: 'schedule',
    resourceId: id,
    resourceTitle: updated.title,
    result: 'success'
  })

  return { text: `日程已更新: "${updated.title}" | 状态:${updated.status}` }
}

export async function executeDelete(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.scheduleId === 'string' ? ctx.args.scheduleId : ''
  if (!id) return { text: '需要 scheduleId', isError: true }

  const existing = readSingleScheduleById(ctx.scopeRoot, id)
  if (!existing) return { text: `日程 ${id} 不存在`, isError: true }

  const deleted = deleteSingleSchedule(ctx.scopeRoot, id)
  if (!deleted) return { text: '删除失败', isError: true }

  const opCtx = buildOpCtx(ctx)
  void emit('schedule:deleted', {
    scope: ctx.scope,
    scheduleId: id,
    actor: opCtx.actor
  })

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'delete',
    resourceType: 'schedule',
    resourceId: id,
    resourceTitle: existing.title,
    result: 'success'
  })

  return { text: `日程已删除: "${existing.title}"` }
}

export async function executeLink(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.scheduleId === 'string' ? ctx.args.scheduleId : ''
  const linkedType = typeof ctx.args.linkedType === 'string' ? ctx.args.linkedType : ''
  const linkedId = typeof ctx.args.linkedId === 'string' ? ctx.args.linkedId : ''

  if (!id || !linkedType || !linkedId) {
    return { text: '需要 scheduleId, linkedType, linkedId', isError: true }
  }
  if (linkedType !== 'todo' && linkedType !== 'document') {
    return { text: 'linkedType 必须是 "todo" 或 "document"', isError: true }
  }

  const existing = readSingleScheduleById(ctx.scopeRoot, id)
  if (!existing) return { text: `日程 ${id} 不存在`, isError: true }

  const links: ScheduleLinkedItem[] = existing.linkedItems ?? []
  if (links.some((l) => l.type === linkedType && l.id === linkedId)) {
    return { text: '已存在相同关联' }
  }

  links.push({ type: linkedType, id: linkedId })
  existing.linkedItems = links
  existing.updatedAt = Date.now()

  writeSingleSchedule(ctx.scopeRoot, existing)

  void emit('schedule:updated', {
    scope: ctx.scope,
    scheduleId: id,
    title: existing.title,
    actor: buildOpCtx(ctx).actor
  })

  return { text: `已关联 ${linkedType}:${linkedId} 到日程 "${existing.title}"` }
}

export async function executeUnlink(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const id = typeof ctx.args.scheduleId === 'string' ? ctx.args.scheduleId : ''
  const linkedType = typeof ctx.args.linkedType === 'string' ? ctx.args.linkedType : ''
  const linkedId = typeof ctx.args.linkedId === 'string' ? ctx.args.linkedId : ''

  if (!id || !linkedType || !linkedId) {
    return { text: '需要 scheduleId, linkedType, linkedId', isError: true }
  }

  const existing = readSingleScheduleById(ctx.scopeRoot, id)
  if (!existing) return { text: `日程 ${id} 不存在`, isError: true }

  const links = existing.linkedItems ?? []
  const idx = links.findIndex((l) => l.type === linkedType && l.id === linkedId)
  if (idx < 0) return { text: '未找到该关联' }

  links.splice(idx, 1)
  existing.linkedItems = links.length > 0 ? links : undefined
  existing.updatedAt = Date.now()

  writeSingleSchedule(ctx.scopeRoot, existing)

  void emit('schedule:updated', {
    scope: ctx.scope,
    scheduleId: id,
    title: existing.title,
    actor: buildOpCtx(ctx).actor
  })

  return { text: `已解除 ${linkedType}:${linkedId} 与日程 "${existing.title}" 的关联` }
}
