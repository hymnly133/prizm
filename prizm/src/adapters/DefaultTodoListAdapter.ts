/**
 * Prizm Server 默认 TODO 列表适配器
 * list 为包装层，item 独立 CRUD。支持多 list 每 scope。
 */

import { createLogger } from '../logger'
import type { ITodoListAdapter, CreateTodoItemPayloadExt } from './interfaces'
import type {
  TodoList,
  TodoItem,
  TodoItemStatus,
  UpdateTodoItemPayload
} from '../types'
import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'

const log = createLogger('Adapter')

function ensureTodoItem(
  it: Partial<TodoItem> & { title: string },
  usedIds?: Set<string>
): TodoItem {
  const now = Date.now()
  let id = (it as TodoItem).id
  if (!id || (usedIds && usedIds.has(id))) {
    id = genUniqueId()
  }
  usedIds?.add(id)
  return {
    id,
    title: it.title,
    description: it.description,
    status: (it as TodoItem).status ?? 'todo',
    createdAt: (it as TodoItem).createdAt ?? now,
    updatedAt: (it as TodoItem).updatedAt ?? now
  }
}

function findListByItemId(lists: TodoList[], itemId: string): TodoList | null {
  return lists.find((l) => l.items.some((it) => it.id === itemId)) ?? null
}

export class DefaultTodoListAdapter implements ITodoListAdapter {
  async getTodoLists(scope: string): Promise<TodoList[]> {
    const data = scopeStore.getScopeData(scope)
    return [...(data.todoLists ?? [])]
  }

  async getTodoList(
    scope: string,
    listId?: string,
    options?: { itemId?: string }
  ): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    if (options?.itemId) {
      const list = findListByItemId(lists, options.itemId)
      if (!list) return null
      const item = list.items.find((it) => it.id === options.itemId)
      return item ? { ...list, items: [item] } : list
    }
    if (listId) {
      return lists.find((l) => l.id === listId) ?? null
    }
    return lists[0] ?? null
  }

  async createTodoList(scope: string, payload?: { title?: string }): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const list: TodoList = {
      id: genUniqueId(),
      title: payload?.title ?? '待办',
      items: [],
      relativePath: '',
      createdAt: now,
      updatedAt: now
    }
    if (!data.todoLists) data.todoLists = []
    data.todoLists.push(list)
    scopeStore.saveScope(scope)
    log.info('TodoList created:', list.id, 'scope:', scope)
    return list
  }

  async updateTodoListTitle(scope: string, listId: string, title: string): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    const idx = lists.findIndex((l) => l.id === listId)
    if (idx < 0) throw new Error(`TodoList not found: ${listId}`)
    const updated: TodoList = { ...lists[idx], title, updatedAt: Date.now() }
    data.todoLists[idx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async deleteTodoList(scope: string, listId: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const lists = data.todoLists ?? []
    data.todoLists = lists.filter((l) => l.id !== listId)
    scopeStore.saveScope(scope)
    log.info('TodoList deleted:', listId, 'scope:', scope)
  }

  async createTodoItem(
    scope: string,
    payload: CreateTodoItemPayloadExt
  ): Promise<{ list: TodoList; item: TodoItem }> {
    const data = scopeStore.getScopeData(scope)
    if (!data.todoLists) data.todoLists = []

    const hasListTarget =
      (typeof payload.listTitle === 'string' && payload.listTitle.trim()) ||
      (typeof payload.listId === 'string' && payload.listId)
    if (!hasListTarget) {
      throw new Error('必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）')
    }
    let list: TodoList
    if (typeof payload.listTitle === 'string' && payload.listTitle.trim()) {
      list = await this.createTodoList(scope, { title: payload.listTitle.trim() })
    } else {
      const found = data.todoLists.find((l) => l.id === payload.listId)
      if (!found) throw new Error(`TodoList not found: ${payload.listId}`)
      list = found
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
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    const items = [...list.items, item]
    const updated: TodoList = { ...list, items, updatedAt: now }
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return { list: updated, item }
  }

  async updateTodoItem(
    scope: string,
    itemId: string,
    payload: UpdateTodoItemPayload
  ): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const list = findListByItemId(data.todoLists ?? [], itemId)
    if (!list) return null
    const idx = list.items.findIndex((it) => it.id === itemId)
    if (idx < 0) return list
    const cur = list.items[idx]
    const items = [...list.items]
    items[idx] = {
      ...cur,
      ...(payload.status !== undefined && { status: payload.status as TodoItemStatus }),
      ...(payload.title !== undefined && { title: payload.title }),
      ...(payload.description !== undefined && { description: payload.description }),
      updatedAt: Date.now()
    }
    const updated: TodoList = { ...list, items, updatedAt: Date.now() }
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async deleteTodoItem(scope: string, itemId: string): Promise<TodoList | null> {
    const data = scopeStore.getScopeData(scope)
    const list = findListByItemId(data.todoLists ?? [], itemId)
    if (!list) return null
    const items = list.items.filter((it) => it.id !== itemId)
    const updated: TodoList = { ...list, items, updatedAt: Date.now() }
    const listIdx = data.todoLists.findIndex((l) => l.id === list.id)
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return updated
  }

  async replaceTodoItems(
    scope: string,
    listId: string,
    items: Pick<TodoItem, 'id' | 'title' | 'status' | 'description'>[]
  ): Promise<TodoList> {
    const data = scopeStore.getScopeData(scope)
    const listIdx = (data.todoLists ?? []).findIndex((l) => l.id === listId)
    if (listIdx < 0) throw new Error(`TodoList not found: ${listId}`)
    const list = data.todoLists[listIdx]
    const usedIds = new Set<string>()
    const normalized = items.map((it) =>
      ensureTodoItem(it as Partial<TodoItem> & { title: string }, usedIds)
    )
    const updated: TodoList = { ...list, items: normalized, updatedAt: Date.now() }
    data.todoLists[listIdx] = updated
    scopeStore.saveScope(scope)
    return updated
  }
}
