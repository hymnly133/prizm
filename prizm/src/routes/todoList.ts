/**
 * Todo 列表路由 - RESTful /todo/lists 与 /todo/items
 * list：包装层（title）；item：顶层元素，独立 CRUD。
 * GET/POST /todo 为向后兼容别名。
 */

import type { Router, Request, Response } from 'express'
import type { ITodoListAdapter } from '../adapters/interfaces'
import type { TodoItem, TodoItemStatus, TodoList } from '../types'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { ensureStringParam, getScopeForCreate, requireScopeForList } from '../scopeUtils'
import { parseTodoItemsFromInput } from '../utils/todoItems'
import { lockManager } from '../core/resourceLockManager'
import { emit } from '../core/eventBus'

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

function broadcastTodoListDeleted(req: Request, scope: string, listId: string): void {
  const wsServer = req.prizmServer
  if (wsServer) {
    wsServer.broadcast(
      EVENT_TYPES.TODO_LIST_DELETED,
      { scope, listId, deleted: true as const, sourceClientId: getSourceClientId(req) },
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

/**
 * 检查待办列表是否被 agent claimed。
 * 返回 true 表示请求应被阻断（已发送 423 响应），false 表示可继续。
 */
function checkTodoListLock(req: Request, res: Response, scope: string, listId: string): boolean {
  const lock = lockManager.getLock(scope, 'todo_list', listId)
  if (!lock) return false

  const force = req.query.force === 'true'
  if (force) {
    emit('tool:executed', {
      scope,
      sessionId: lock.sessionId,
      toolName: 'api:force_override',
      auditInput: {
        toolName: 'api:force_override',
        action: 'force_override',
        resourceType: 'todo_list',
        resourceId: listId,
        detail: `User forced override via API`,
        result: 'success'
      }
    }).catch(() => {})
    return false
  }

  res.status(423).json({
    error: 'Resource is locked',
    code: 'RESOURCE_LOCKED',
    lock: {
      sessionId: lock.sessionId,
      acquiredAt: lock.acquiredAt,
      reason: lock.reason,
      expiresAt: lock.lastHeartbeat + lock.ttlMs
    }
  })
  return true
}

export function createTodoListRoutes(router: Router, adapter?: ITodoListAdapter): void {
  if (!adapter) {
    log.warn('TodoList adapter not provided, routes will return 503')
  }

  // ----- 新 API：/todo/lists -----

  // GET /todo/lists - 列出所有 TodoList
  router.get('/todo/lists', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getTodoLists) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const todoLists = await adapter.getTodoLists(scope)
      res.json({ todoLists })
    } catch (error) {
      log.error('get todo lists error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /todo/lists - 新建 list
  router.post('/todo/lists', async (req: Request, res: Response) => {
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

  // GET /todo/lists/:listId - 获取指定 list
  router.get('/todo/lists/:listId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const listId = ensureStringParam(req.params.listId)
      if (!listId) return res.status(400).json({ error: 'listId required' })
      const todoList = await adapter.getTodoList(scope, listId)
      if (!todoList) return res.status(404).json({ error: 'TodoList not found' })
      res.json({ todoList })
    } catch (error) {
      log.error('get todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /todo/lists/:listId - 更新 list title
  router.patch('/todo/lists/:listId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoListTitle) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const listId = ensureStringParam(req.params.listId)
      if (!listId) return res.status(400).json({ error: 'listId required' })
      const { title } = req.body ?? {}
      if (typeof title !== 'string') {
        return res.status(400).json({ error: 'title required' })
      }
      const todoList = await adapter.updateTodoListTitle(scope, listId, title)
      broadcastTodoListUpdated(req, scope, todoList, { lightweight: true })
      res.json({ todoList })
    } catch (error) {
      log.error('update todo list title error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /todo/lists/:listId - 删除 list
  router.delete('/todo/lists/:listId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const listId = ensureStringParam(req.params.listId)
      if (!listId) return res.status(400).json({ error: 'listId required' })
      if (checkTodoListLock(req, res, scope, listId)) return
      await adapter.deleteTodoList(scope, listId)
      broadcastTodoListDeleted(req, scope, listId)
      res.status(204).send()
    } catch (error) {
      log.error('delete todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /todo/lists/:listId/items - 在指定 list 中创建 item
  router.post('/todo/lists/:listId/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const listId = ensureStringParam(req.params.listId)
      if (!listId) return res.status(400).json({ error: 'listId required' })
      if (checkTodoListLock(req, res, scope, listId)) return
      const { title, description, status } = req.body ?? {}
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title required' })
      }
      const payload = {
        title: title.trim(),
        listId,
        ...(typeof description === 'string' && { description }),
        ...(status &&
          ['todo', 'doing', 'done'].includes(status) && { status: status as TodoItemStatus })
      }
      const { list: todoList, item } = await adapter.createTodoItem(scope, payload)
      broadcastTodoItemCreated(req, scope, todoList, item)
      res.status(201).json({ todoList })
    } catch (error) {
      log.error('create todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /todo/lists/:listId/items - 全量替换 list 的 items
  router.put('/todo/lists/:listId/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.replaceTodoItems) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const listId = ensureStringParam(req.params.listId)
      if (!listId) return res.status(400).json({ error: 'listId required' })
      if (checkTodoListLock(req, res, scope, listId)) return
      const { items } = req.body ?? {}
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items array required' })
      }
      const todoList = await adapter.replaceTodoItems(scope, listId, parseTodoItemsFromInput(items))
      broadcastTodoListUpdated(req, scope, todoList)
      res.json({ todoList })
    } catch (error) {
      log.error('replace todo items error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // ----- Item 操作（按 itemId，跨 list） -----

  // PATCH /todo/items/:itemId - 更新 item
  router.patch('/todo/items/:itemId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const itemId = ensureStringParam(req.params.itemId)
      if (!itemId) return res.status(400).json({ error: 'item id required' })

      // 查找 item 所属的 list 并检查 claim
      if (adapter.getTodoLists) {
        const allLists = await adapter.getTodoLists(scope)
        const parentList = allLists.find((l) => l.items?.some((it) => it.id === itemId))
        if (parentList && checkTodoListLock(req, res, scope, parentList.id)) return
      }

      const { status, title, description } = req.body ?? {}
      const payload: { status?: TodoItemStatus; title?: string; description?: string } = {}
      if (status && ['todo', 'doing', 'done'].includes(status))
        payload.status = status as TodoItemStatus
      if (typeof title === 'string') payload.title = title
      if (typeof description === 'string') payload.description = description
      const todoList = await adapter.updateTodoItem(scope, itemId, payload)
      if (!todoList) return res.status(404).json({ error: 'TodoItem not found' })
      const updatedItem = todoList.items.find((it) => it.id === itemId)
      if (updatedItem) broadcastTodoItemUpdated(req, scope, todoList, updatedItem)
      res.json({ todoList })
    } catch (error) {
      log.error('update todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /todo/items/:itemId - 删除 item
  router.delete('/todo/items/:itemId', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const itemId = ensureStringParam(req.params.itemId)
      if (!itemId) return res.status(400).json({ error: 'item id required' })

      // 查找 item 所属的 list 并检查 claim
      if (adapter.getTodoLists) {
        const allLists = await adapter.getTodoLists(scope)
        const parentList = allLists.find((l) => l.items?.some((it) => it.id === itemId))
        if (parentList && checkTodoListLock(req, res, scope, parentList.id)) return
      }

      const todoList = await adapter.deleteTodoItem(scope, itemId)
      broadcastTodoItemDeleted(req, scope, itemId)
      if (!todoList) return res.status(404).json({ error: 'TodoItem not found' })
      res.json({ todoList })
    } catch (error) {
      log.error('delete todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // ----- 向后兼容：/todo、/todo/items -----

  // GET /todo - 兼容：返回首个 list 或按 itemId 查找
  router.get('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined
      const todoList = await adapter.getTodoList(scope, undefined, { itemId })
      res.json({ todoList })
    } catch (error) {
      log.error('get todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /todo - 兼容：新建 list，等同 POST /todo/lists
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

  // PATCH /todo - 兼容：需 query listId
  router.patch('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.updateTodoListTitle) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const listId = typeof req.query.listId === 'string' ? req.query.listId : undefined
      if (!listId) {
        return res
          .status(400)
          .json({ error: 'listId required (use ?listId= or PATCH /todo/lists/:listId)' })
      }
      const { title } = req.body ?? {}
      if (typeof title !== 'string') {
        return res.status(400).json({ error: 'title required' })
      }
      const todoList = await adapter.updateTodoListTitle(scope, listId, title)
      broadcastTodoListUpdated(req, scope, todoList, { lightweight: true })
      res.json({ todoList })
    } catch (error) {
      log.error('update todo list title error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /todo - 兼容：需 query listId
  router.delete('/todo', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteTodoList) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const listId = typeof req.query.listId === 'string' ? req.query.listId : undefined
      if (!listId) {
        return res
          .status(400)
          .json({ error: 'listId required (use ?listId= or DELETE /todo/lists/:listId)' })
      }
      if (checkTodoListLock(req, res, scope, listId)) return
      await adapter.deleteTodoList(scope, listId)
      broadcastTodoListDeleted(req, scope, listId)
      res.status(204).send()
    } catch (error) {
      log.error('delete todo list error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PUT /todo/items - 兼容：需 body listId
  router.put('/todo/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.replaceTodoItems) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { items, listId } = req.body ?? {}
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items array required' })
      }
      if (typeof listId !== 'string' || !listId) {
        return res
          .status(400)
          .json({ error: 'listId required in body (use PUT /todo/lists/:listId/items)' })
      }
      if (checkTodoListLock(req, res, scope, listId)) return
      const todoList = await adapter.replaceTodoItems(scope, listId, parseTodoItemsFromInput(items))
      broadcastTodoListUpdated(req, scope, todoList)
      res.json({ todoList })
    } catch (error) {
      log.error('replace todo items error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /todo/items - 兼容：支持 listId、listTitle
  router.post('/todo/items', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createTodoItem) {
        return res.status(503).json({ error: 'TodoList adapter not available' })
      }
      const scope = getScopeForCreate(req)
      const { title, description, status, listId, listTitle } = req.body ?? {}
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title required' })
      }
      const hasListId = typeof listId === 'string' && listId
      const hasListTitle = typeof listTitle === 'string' && listTitle.trim()
      if (!hasListId && !hasListTitle) {
        return res
          .status(400)
          .json({ error: '必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）' })
      }
      const payload = {
        title: title.trim(),
        ...(hasListId && { listId }),
        ...(hasListTitle && { listTitle: (listTitle as string).trim() }),
        ...(typeof description === 'string' && { description }),
        ...(status &&
          ['todo', 'doing', 'done'].includes(status) && { status: status as TodoItemStatus })
      }
      const { list: todoList } = await adapter.createTodoItem(scope, payload)
      const newItem = todoList.items[todoList.items.length - 1]
      if (newItem) broadcastTodoItemCreated(req, scope, todoList, newItem)
      res.status(201).json({ todoList })
    } catch (error) {
      log.error('create todo item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
