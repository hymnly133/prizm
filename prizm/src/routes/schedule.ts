/**
 * 日程路由 - Schedule CRUD + 日期范围查询 + 关联查询
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  ensureStringParam,
  getScopeForCreate,
  requireScopeForList,
  getScopeForReadById,
  findAcrossScopes
} from '../scopeUtils'
import { scopeStore } from '../core/ScopeStore'
import { emit } from '../core/eventBus'
import { genUniqueId } from '../id'
import {
  readScheduleItems,
  readScheduleItemsByRange,
  readScheduleItemsExpanded,
  readSingleScheduleById,
  writeSingleSchedule,
  deleteSingleSchedule,
  findSchedulesByLinkedItem,
  detectConflicts
} from '../core/mdStore'
import type {
  ScheduleItem,
  CreateSchedulePayload,
  UpdateSchedulePayload,
  ScheduleStatus
} from '../types'

const log = createLogger('Schedule')

export function createScheduleRoutes(router: Router): void {
  // GET /schedule — 列出日程（支持 ?from=&to= 日期范围）
  router.get('/schedule', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const from = req.query.from ? Number(req.query.from) : undefined
      const to = req.query.to ? Number(req.query.to) : undefined

      let items: ScheduleItem[]
      if (from != null && to != null) {
        items = readScheduleItemsByRange(scopeRoot, from, to)
      } else {
        items = readScheduleItems(scopeRoot)
      }

      res.json(items)
    } catch (err) {
      log.error('GET /schedule error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /schedule/calendar — 日历视图（按月/周展开循环）
  router.get('/schedule/calendar', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const from = Number(req.query.from)
      const to = Number(req.query.to)
      if (!from || !to) {
        res.status(400).json({ error: 'from and to query params are required (Unix ms)' })
        return
      }

      const items = readScheduleItemsExpanded(scopeRoot, from, to)
      res.json(items)
    } catch (err) {
      log.error('GET /schedule/calendar error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /schedule/conflicts — 检测日程冲突
  router.get('/schedule/conflicts', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const from = Number(req.query.from)
      const to = Number(req.query.to)
      if (!from || !to) {
        res.status(400).json({ error: 'from and to query params are required (Unix ms)' })
        return
      }

      const conflicts = detectConflicts(scopeRoot, from, to)
      res.json({
        count: conflicts.length,
        conflicts: conflicts.map(([a, b]) => ({
          schedule1: { id: a.id, title: a.title, startTime: a.startTime, endTime: a.endTime },
          schedule2: { id: b.id, title: b.title, startTime: b.startTime, endTime: b.endTime }
        }))
      })
    } catch (err) {
      log.error('GET /schedule/conflicts error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /schedule/:id — 获取单个日程
  router.get('/schedule/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      if (scopeHint) {
        const scopeRoot = scopeStore.getScopeRootPath(scopeHint)
        const item = readSingleScheduleById(scopeRoot, id)
        if (item) {
          res.json(item)
          return
        }
      }
      const result = await findAcrossScopes(req, async (sc) =>
        readSingleScheduleById(scopeStore.getScopeRootPath(sc), id)
      )
      if (result) {
        res.json(result.item)
        return
      }
      res.status(404).json({ error: 'Schedule not found' })
    } catch (err) {
      log.error('GET /schedule/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // POST /schedule — 创建日程
  router.post('/schedule', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const body = req.body as CreateSchedulePayload

      if (!body.title || !body.startTime) {
        res.status(400).json({ error: 'title and startTime are required' })
        return
      }

      const now = Date.now()
      const item: ScheduleItem = {
        id: genUniqueId(),
        title: body.title,
        description: body.description,
        type: body.type || 'event',
        startTime: body.startTime,
        endTime: body.endTime,
        allDay: body.allDay,
        recurrence: body.recurrence,
        reminders: body.reminders,
        linkedItems: body.linkedItems,
        tags: body.tags,
        status: 'upcoming',
        relativePath: '',
        createdAt: now,
        updatedAt: now
      }

      const relativePath = writeSingleSchedule(scopeRoot, item)
      item.relativePath = relativePath

      void emit('schedule:created', {
        scope,
        scheduleId: item.id,
        title: item.title,
        type: item.type,
        startTime: item.startTime,
        actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:schedule' }
      })

      res.status(201).json(item)
    } catch (err) {
      log.error('POST /schedule error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // PATCH /schedule/:id — 更新日程
  router.patch('/schedule/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeForCreate(req)
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      const existing = readSingleScheduleById(scopeRoot, id)
      if (!existing) {
        res.status(404).json({ error: 'Schedule not found' })
        return
      }

      const body = req.body as UpdateSchedulePayload
      const now = Date.now()

      const updated: ScheduleItem = {
        ...existing,
        ...(body.title != null && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.type != null && { type: body.type }),
        ...(body.startTime != null && { startTime: body.startTime }),
        ...(body.endTime !== undefined && { endTime: body.endTime }),
        ...(body.allDay !== undefined && { allDay: body.allDay }),
        ...(body.recurrence !== undefined && { recurrence: body.recurrence ?? undefined }),
        ...(body.reminders !== undefined && { reminders: body.reminders ?? undefined }),
        ...(body.linkedItems !== undefined && { linkedItems: body.linkedItems }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.status != null && { status: body.status }),
        ...(body.status === 'completed' && { completedAt: now }),
        updatedAt: now
      }

      const relativePath = writeSingleSchedule(scopeRoot, updated)
      updated.relativePath = relativePath

      void emit('schedule:updated', {
        scope,
        scheduleId: id,
        title: updated.title,
        status: updated.status,
        actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:schedule' }
      })

      res.json(updated)
    } catch (err) {
      log.error('PATCH /schedule/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // DELETE /schedule/:id — 删除日程
  router.delete('/schedule/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scope = getScopeForCreate(req)
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      const deleted = deleteSingleSchedule(scopeRoot, id)
      if (!deleted) {
        res.status(404).json({ error: 'Schedule not found' })
        return
      }

      void emit('schedule:deleted', {
        scope,
        scheduleId: id,
        actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:schedule' }
      })

      res.json({ success: true })
    } catch (err) {
      log.error('DELETE /schedule/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /schedule/:id/linked — 获取关联的 todo/document
  router.get('/schedule/:id/linked', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      if (scopeHint) {
        const scopeRoot = scopeStore.getScopeRootPath(scopeHint)
        const item = readSingleScheduleById(scopeRoot, id)
        if (item) {
          res.json(item.linkedItems ?? [])
          return
        }
      }
      const result = await findAcrossScopes(req, async (sc) =>
        readSingleScheduleById(scopeStore.getScopeRootPath(sc), id)
      )
      if (result) {
        res.json(result.item.linkedItems ?? [])
        return
      }
      res.status(404).json({ error: 'Schedule not found' })
    } catch (err) {
      log.error('GET /schedule/:id/linked error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /schedule/by-linked/:type/:linkedId — 查找关联到指定资源的日程
  router.get('/schedule/by-linked/:type/:linkedId', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const linkedType = ensureStringParam(req.params.type) as 'todo' | 'document'
      const linkedId = ensureStringParam(req.params.linkedId)

      if (linkedType !== 'todo' && linkedType !== 'document') {
        res.status(400).json({ error: 'type must be "todo" or "document"' })
        return
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const items = findSchedulesByLinkedItem(scopeRoot, linkedType, linkedId)
      res.json(items)
    } catch (err) {
      log.error('GET /schedule/by-linked error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })
}
