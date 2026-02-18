/**
 * TodoService — 统一待办 CRUD 业务逻辑
 * Agent 工具和 API 路由共用
 */

import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'
import { emit } from '../core/eventBus'
import { lockManager } from '../core/resourceLockManager'
import { createLogger } from '../logger'
import { ResourceLockedException, ResourceNotFoundException } from './errors'
import type { TodoList, TodoItem, TodoItemStatus } from '../types'
import type { OperationContext } from './types'

const log = createLogger('TodoService')

// ─── 查询 ───

export async function listTodoLists(scope: string): Promise<TodoList[]> {
  const data = scopeStore.getScopeData(scope)
  return [...(data.todoLists ?? [])]
}

export async function getTodoList(scope: string, listId: string): Promise<TodoList | null> {
  const data = scopeStore.getScopeData(scope)
  return (data.todoLists ?? []).find((l) => l.id === listId) ?? null
}

export async function findTodoItem(
  scope: string,
  itemId: string
): Promise<{ list: TodoList; item: TodoItem; itemIndex: number } | null> {
  const data = scopeStore.getScopeData(scope)
  for (const list of data.todoLists ?? []) {
    const idx = list.items.findIndex((it) => it.id === itemId)
    if (idx >= 0) return { list, item: list.items[idx], itemIndex: idx }
  }
  return null
}

// ─── 锁检查工具 ───

function assertNotLocked(scope: string, listId: string, ownSessionId?: string): void {
  const lock = lockManager.getLock(scope, 'todo_list', listId)
  if (lock && lock.sessionId !== ownSessionId) {
    throw new ResourceLockedException(
      `待办列表 ${listId} 已被会话 ${lock.sessionId} 领取，无法修改。`,
      lock.sessionId
    )
  }
}

// ─── 列表操作 ───

/**
 * 导入一个已有完整字段的待办列表（如从 session workspace 提升到主工作区）。
 * 保留原有 id 等字段。
 */
export async function importTodoList(ctx: OperationContext, list: TodoList): Promise<TodoList> {
  const data = scopeStore.getScopeData(ctx.scope)
  if (!data.todoLists) data.todoLists = []
  data.todoLists.push(list)
  scopeStore.saveScope(ctx.scope)
  log.info('TodoList imported:', list.id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('todo:mutated', {
    action: 'created',
    scope: ctx.scope,
    resourceType: 'list',
    listId: list.id,
    actor: ctx.actor
  }).catch(() => {})

  return list
}

export async function createTodoList(
  ctx: OperationContext,
  payload: { title: string; relativePath?: string }
): Promise<TodoList> {
  const data = scopeStore.getScopeData(ctx.scope)
  if (!data.todoLists) data.todoLists = []
  const now = Date.now()
  const list: TodoList = {
    id: genUniqueId(),
    title: payload.title,
    items: [],
    relativePath: payload.relativePath ?? '',
    createdAt: now,
    updatedAt: now
  }
  data.todoLists.push(list)
  scopeStore.saveScope(ctx.scope)
  log.info('TodoList created:', list.id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('todo:mutated', {
    action: 'created',
    scope: ctx.scope,
    resourceType: 'list',
    listId: list.id,
    actor: ctx.actor
  }).catch(() => {})

  return list
}

export async function deleteTodoList(
  ctx: OperationContext,
  listId: string,
  options?: { checkLock?: boolean; lockSessionId?: string }
): Promise<void> {
  const data = scopeStore.getScopeData(ctx.scope)
  const lists = data.todoLists ?? []
  const idx = lists.findIndex((l) => l.id === listId)
  if (idx < 0) throw new ResourceNotFoundException(`待办列表不存在: ${listId}`)

  if (options?.checkLock) {
    assertNotLocked(ctx.scope, listId, options.lockSessionId ?? ctx.actor.sessionId)
  }

  lists.splice(idx, 1)
  scopeStore.saveScope(ctx.scope)
  log.info('TodoList deleted:', listId, 'scope:', ctx.scope)

  emit('todo:mutated', {
    action: 'deleted',
    scope: ctx.scope,
    resourceType: 'list',
    listId,
    actor: ctx.actor
  }).catch(() => {})
}

// ─── Item 操作 ───

export interface CreateTodoItemPayload {
  title: string
  description?: string
  status?: TodoItemStatus
}

export async function createTodoItem(
  ctx: OperationContext,
  listId: string,
  payload: CreateTodoItemPayload,
  options?: { checkLock?: boolean; lockSessionId?: string }
): Promise<{ list: TodoList; item: TodoItem }> {
  const data = scopeStore.getScopeData(ctx.scope)
  const list = (data.todoLists ?? []).find((l) => l.id === listId)
  if (!list) throw new ResourceNotFoundException(`待办列表不存在: ${listId}`)

  if (options?.checkLock) {
    assertNotLocked(ctx.scope, listId, options.lockSessionId ?? ctx.actor.sessionId)
  }

  const now = Date.now()
  const item: TodoItem = {
    id: genUniqueId(),
    title: payload.title,
    description: payload.description,
    status: payload.status ?? 'todo',
    createdAt: now,
    updatedAt: now
  }
  list.items.push(item)
  list.updatedAt = now
  scopeStore.saveScope(ctx.scope)
  log.info('TodoItem created:', item.id, 'in list:', listId, 'actor:', ctx.actor.type)

  emit('todo:mutated', {
    action: 'created',
    scope: ctx.scope,
    resourceType: 'item',
    listId,
    itemId: item.id,
    actor: ctx.actor,
    title: item.title,
    status: item.status,
    description: item.description,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }).catch(() => {})

  return { list, item }
}

export interface UpdateTodoItemPayload {
  title?: string
  description?: string | null
  status?: TodoItemStatus
}

export async function updateTodoItem(
  ctx: OperationContext,
  itemId: string,
  payload: UpdateTodoItemPayload,
  options?: { checkLock?: boolean; lockSessionId?: string }
): Promise<{ list: TodoList; item: TodoItem }> {
  const found = await findTodoItem(ctx.scope, itemId)
  if (!found) throw new ResourceNotFoundException(`待办项不存在: ${itemId}`)

  if (options?.checkLock) {
    assertNotLocked(ctx.scope, found.list.id, options.lockSessionId ?? ctx.actor.sessionId)
  }

  const item = found.item
  if (payload.status !== undefined) item.status = payload.status
  if (payload.title !== undefined) item.title = payload.title
  if (payload.description !== undefined) {
    ;(item as { description?: string }).description =
      payload.description === null ? undefined : payload.description
  }
  item.updatedAt = Date.now()
  found.list.updatedAt = Date.now()
  scopeStore.saveScope(ctx.scope)
  log.info('TodoItem updated:', itemId, 'actor:', ctx.actor.type)

  emit('todo:mutated', {
    action: 'updated',
    scope: ctx.scope,
    resourceType: 'item',
    listId: found.list.id,
    itemId,
    actor: ctx.actor,
    title: item.title,
    status: item.status,
    description: item.description,
    updatedAt: item.updatedAt
  }).catch(() => {})

  return { list: found.list, item }
}

export async function deleteTodoItem(
  ctx: OperationContext,
  itemId: string,
  options?: { checkLock?: boolean; lockSessionId?: string }
): Promise<{ list: TodoList; deletedTitle: string }> {
  const found = await findTodoItem(ctx.scope, itemId)
  if (!found) throw new ResourceNotFoundException(`待办项不存在: ${itemId}`)

  if (options?.checkLock) {
    assertNotLocked(ctx.scope, found.list.id, options.lockSessionId ?? ctx.actor.sessionId)
  }

  const deletedTitle = found.item.title
  found.list.items.splice(found.itemIndex, 1)
  found.list.updatedAt = Date.now()
  scopeStore.saveScope(ctx.scope)
  log.info('TodoItem deleted:', itemId, 'actor:', ctx.actor.type)

  emit('todo:mutated', {
    action: 'deleted',
    scope: ctx.scope,
    resourceType: 'item',
    listId: found.list.id,
    itemId,
    actor: ctx.actor
  }).catch(() => {})

  return { list: found.list, deletedTitle }
}
