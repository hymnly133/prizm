/**
 * TODO 列表路由 - 列表级操作，不暴露单个 TODO 项
 */

import type { Router, Request, Response } from 'express'
import type { ITodoListAdapter } from '../adapters/interfaces'
import type { TodoItem, TodoItemStatus } from '../types'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { getScopeForCreate, requireScopeForList } from '../scopeUtils'

const log = createLogger('TodoList')

export function createTodoListRoutes(router: Router, adapter?: ITodoListAdapter): void {
  if (!adapter) {
    log.warn('TodoList adapter not provided, routes will return 503')
  }

  // GET /tasks - 获取 TODO 列表，scope 必填 ?scope=xxx，可选 ?itemId=xxx 仅返回该 item
  router.get('/tasks', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return

      const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined
      const todoList = await adapter.getTodoList(scope, { itemId })
      res.json({ todoList })
    } catch (error) {
      log.error('get todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /tasks - 更新列表（title/items）或单/批量 item（updateItem/updateItems）
  router.patch('/tasks', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }

      const { title, items, updateItem, updateItems } = req.body ?? {}
      const scope = getScopeForCreate(req)

      const payload: {
        title?: string
        items?: TodoItem[]
        updateItem?: { id: string; status?: TodoItemStatus; title?: string; description?: string }
        updateItems?: Array<{
          id: string
          status?: TodoItemStatus
          title?: string
          description?: string
        }>
      } = {}
      if (typeof title === 'string') payload.title = title
      if (Array.isArray(items)) {
        payload.items = items.filter(
          (it: unknown): it is TodoItem =>
            it && typeof it === 'object' && typeof (it as TodoItem).title === 'string'
        ) as TodoItem[]
      }
      if (updateItem && typeof updateItem === 'object' && typeof updateItem.id === 'string') {
        payload.updateItem = {
          id: updateItem.id,
          ...(updateItem.status &&
            ['todo', 'doing', 'done'].includes(updateItem.status) && {
              status: updateItem.status as TodoItemStatus
            }),
          ...(typeof updateItem.title === 'string' && { title: updateItem.title }),
          ...(typeof updateItem.description === 'string' && { description: updateItem.description })
        }
      }
      if (Array.isArray(updateItems)) {
        payload.updateItems = updateItems
          .filter(
            (
              u: unknown
            ): u is { id: string; status?: string; title?: string; description?: string } =>
              u && typeof u === 'object' && typeof (u as { id?: string }).id === 'string'
          )
          .map((u) => ({
            id: u.id,
            ...(u.status &&
              ['todo', 'doing', 'done'].includes(u.status) && {
                status: u.status as TodoItemStatus
              }),
            ...(typeof u.title === 'string' && { title: u.title }),
            ...(typeof u.description === 'string' && { description: u.description })
          }))
          .filter((u) => Object.keys(u).length > 1)
      }

      const hasPayload =
        payload.title !== undefined ||
        payload.items !== undefined ||
        payload.updateItem !== undefined ||
        (payload.updateItems?.length ?? 0) > 0
      if (!hasPayload) {
        return res.status(400).json({ error: 'title, items, updateItem or updateItems required' })
      }

      const todoList = await adapter.updateTodoList(scope, payload)

      const wsServer = req.prizmServer
      if (wsServer) {
        const payload_ws = todoList
          ? {
              id: todoList.id,
              scope,
              title: todoList.title,
              itemCount: todoList.items.length,
              doneCount: todoList.items.filter((it) => it.status === 'done').length,
              sourceClientId: req.prizmClient?.clientId
            }
          : { id: '', scope, cleared: true, sourceClientId: req.prizmClient?.clientId }
        wsServer.broadcast(EVENT_TYPES.TODO_LIST_UPDATED, payload_ws, scope)
      }

      res.json({ todoList })
    } catch (error) {
      log.error('update todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
