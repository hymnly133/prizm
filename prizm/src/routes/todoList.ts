/**
 * Todo 列表路由 - /todo
 * list：包装层（title）；item：顶层元素，独立 CRUD。
 * 职责正交：PATCH /todo 仅改 title；item 操作走 /todo/items。
 */

import type { Router, Request, Response } from 'express'
import type { ITodoListAdapter } from '../adapters/interfaces'
import type { TodoItem, TodoItemStatus, TodoList } from '../types'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { getScopeForCreate, requireScopeForList } from '../scopeUtils'
import { parseTodoItemsFromInput } from '../utils/todoItems'

const log = createLogger('TodoList')

function getSourceClientId(req: Request): string | undefined {
  return req.prizmClient?.clientId
}

function broadcastTodoListCreated(req: Request, scope: string, todoList: TodoList): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_LIST_CREATED,
      {
        ...todoList,
        listId: todoList.id,
        scope,
        sourceClientId: getSourceClientId(req)
      },
      scope
    )
  }
}

function broadcastTodoListUpdated(
  req: Request,
  scope: string,
  todoList: { id: string; items: TodoItem[]; title: string; updatedAt?: number },
  options?: { lightweight?: boolean }
): void {
  const wsServer = req.prizmServer
  if (!wsServer) return
  const doneCount = todoList.items.filter((it) => it.status === 'done').length
  const updatedAt = todoList.updatedAt ?? Date.now()
  if (options?.lightweight) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_LIST_UPDATED,
      {
        listId: todoList.id,
        scope,
        title: todoList.title,
        itemCount: todoList.items.length,
        doneCount,
        updatedAt,
        itemsOmitted: true as const,
        sourceClientId: getSourceClientId(req)
      },
      scope
    )
  } else {
    wsServer.broadcast(
      EVENT_TYPES.TODO_LIST_UPDATED,
      {
        listId: todoList.id,
        scope,
        title: todoList.title,
        itemCount: todoList.items.length,
        doneCount,
        items: todoList.items,
        updatedAt,
        sourceClientId: getSourceClientId(req)
      },
      scope
    )
  }
}

function broadcastTodoListDeleted(req: Request, scope: string): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_LIST_DELETED,
      { scope, deleted: true as const, sourceClientId: getSourceClientId(req) },
      scope
    )
  }
}

function broadcastTodoItemCreated(
  req: Request,
  scope: string,
  todoList: TodoList,
  item: TodoItem
): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_ITEM_CREATED,
      {
        ...item,
        itemId: item.id,
        listId: todoList.id,
        scope,
        sourceClientId: getSourceClientId(req)
      },
      scope
    )
  }
}

function broadcastTodoItemUpdated(
  req: Request,
  scope: string,
  todoList: TodoList,
  item: TodoItem
): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_ITEM_UPDATED,
      {
        ...item,
        itemId: item.id,
        listId: todoList.id,
        scope,
        sourceClientId: getSourceClientId(req)
      },
      scope
    )
  }
}

function broadcastTodoItemDeleted(req: Request, scope: string, itemId: string): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_ITEM_DELETED,
      { itemId, scope, sourceClientId: getSourceClientId(req) },
      scope
    )
  }
}

export function createTodoListRoutes(router: Router, adapter?: ITodoListAdapter): void {
  if (!adapter) {
    log.warn('TodoList adapter not provided, routes will return 503')
  }

  // GET /todo - 获取 list（含 items）
  router.get('/todo', async (req: Request, res: Response) => {
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

  // POST /todo - 确保 list 存在（幂等）
  router.post('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { title } = req.body ?? {}
      const todoList = await adapter.createTodoList(scope, {
        title: typeof title === 'string' ? title : undefined
      })
      broadcastTodoListCreated(req, scope, todoList)
      res.status(201).json({ todoList })
    } catch (error) {
      log.error('create todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /todo - 删除 list 实体（scope 从 query，与 GET 一致）
  router.delete('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      await adapter.deleteTodoList(scope)
      broadcastTodoListDeleted(req, scope)
      res.status(204).send()
    } catch (error) {
      log.error('delete todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /todo - 仅更新 title
  router.patch('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoListTitle) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { title } = req.body ?? {}
      if (typeof title !== 'string') {
        return res.status(400).json({ error: 'title required' })
      }
      const todoList = await adapter.updateTodoListTitle(scope, title)
      broadcastTodoListUpdated(req, scope, todoList, { lightweight: true })
      res.json({ todoList })
    } catch (error) {
      log.error('update todo list title error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /todo/items - 全量替换（与 PATCH :itemId 互斥）
  router.put('/todo/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.replaceTodoItems) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { items } = req.body ?? {}
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items array required' })
      }
      const todoList = await adapter.replaceTodoItems(scope, parseTodoItemsFromInput(items))
      broadcastTodoListUpdated(req, scope, todoList)
      res.json({ todoList })
    } catch (error) {
      log.error('replace todo items error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /todo/items - 创建 item
  router.post('/todo/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { title, description, status } = req.body ?? {}
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title required' })
      }
      const payload = {
        title: title.trim(),
        ...(typeof description === 'string' && { description }),
        ...(status &&
          ['todo', 'doing', 'done'].includes(status) && { status: status as TodoItemStatus })
      }
      const todoList = await adapter.createTodoItem(scope, payload)
      const newItem = todoList.items[todoList.items.length - 1]
      if (newItem) broadcastTodoItemCreated(req, scope, todoList, newItem)
      res.status(201).json({ todoList })
    } catch (error) {
      log.error('create todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /todo/items/:itemId - 更新单条 item
  router.patch('/todo/items/:itemId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const itemId = req.params.itemId
      if (!itemId) return res.status(400).json({ error: 'item id required' })
      const { status, title, description } = req.body ?? {}
      const payload: { status?: TodoItemStatus; title?: string; description?: string } = {}
      if (status && ['todo', 'doing', 'done'].includes(status))
        payload.status = status as TodoItemStatus
      if (typeof title === 'string') payload.title = title
      if (typeof description === 'string') payload.description = description
      const todoList = await adapter.updateTodoItem(scope, itemId, payload)
      const updatedItem = todoList.items.find((it) => it.id === itemId)
      if (updatedItem) broadcastTodoItemUpdated(req, scope, todoList, updatedItem)
      res.json({ todoList })
    } catch (error) {
      log.error('update todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /todo/items/:itemId - 删除单条 item
  router.delete('/todo/items/:itemId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const itemId = req.params.itemId
      if (!itemId) return res.status(400).json({ error: 'item id required' })
      const todoList = await adapter.deleteTodoItem(scope, itemId)
      broadcastTodoItemDeleted(req, scope, itemId)
      res.json({ todoList })
    } catch (error) {
      log.error('delete todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
