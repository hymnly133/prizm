import { PrizmClient } from '../client'
import type { TodoList, TodoItem, CreateTodoItemPayload, UpdateTodoItemPayload } from '../../types'

declare module '../client' {
  interface PrizmClient {
    getTodoLists(scope?: string): Promise<TodoList[]>
    getTodoList(
      scope?: string,
      listId?: string,
      options?: { itemId?: string }
    ): Promise<TodoList | null>
    createTodoList(scope?: string, payload?: { title?: string }): Promise<TodoList>
    updateTodoListTitle(scope: string | undefined, listId: string, title: string): Promise<TodoList>
    replaceTodoItems(
      scope: string | undefined,
      listId: string,
      items: TodoItem[]
    ): Promise<TodoList>
    createTodoItem(
      scope: string | undefined,
      payload: CreateTodoItemPayload & { listId?: string; listTitle?: string }
    ): Promise<TodoList>
    updateTodoItem(
      itemId: string,
      payload: UpdateTodoItemPayload,
      scope?: string
    ): Promise<TodoList>
    deleteTodoItem(itemId: string, scope?: string): Promise<TodoList | null>
    deleteTodoList(scope: string | undefined, listId: string): Promise<void>
  }
}

PrizmClient.prototype.getTodoLists = async function (this: PrizmClient, scope?: string) {
  const data = await this.request<{ todoLists: TodoList[] }>('/todo/lists', { scope })
  return data.todoLists ?? []
}

PrizmClient.prototype.getTodoList = async function (
  this: PrizmClient,
  scope?: string,
  listId?: string,
  options?: { itemId?: string }
) {
  const s = scope ?? this.defaultScope
  if (listId) {
    const data = await this.request<{ todoList: TodoList }>(
      `/todo/lists/${encodeURIComponent(listId)}`,
      { scope: s }
    )
    return data.todoList ?? null
  }
  const query: Record<string, string | undefined> = { scope: s }
  if (options?.itemId) query.itemId = options.itemId
  const url = this.buildUrl('/todo', query)
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { todoList: TodoList | null }
  return data.todoList
}

PrizmClient.prototype.createTodoList = async function (
  this: PrizmClient,
  scope?: string,
  payload?: { title?: string }
) {
  const data = await this.request<{ todoList: TodoList }>('/todo/lists', {
    method: 'POST',
    scope,
    body: JSON.stringify(payload ?? {})
  })
  return data.todoList
}

PrizmClient.prototype.updateTodoListTitle = async function (
  this: PrizmClient,
  scope: string | undefined,
  listId: string,
  title: string
) {
  const data = await this.request<{ todoList: TodoList }>(
    `/todo/lists/${encodeURIComponent(listId)}`,
    {
      method: 'PATCH',
      scope,
      body: JSON.stringify({ title })
    }
  )
  return data.todoList
}

PrizmClient.prototype.replaceTodoItems = async function (
  this: PrizmClient,
  scope: string | undefined,
  listId: string,
  items: TodoItem[]
) {
  const data = await this.request<{ todoList: TodoList }>(
    `/todo/lists/${encodeURIComponent(listId)}/items`,
    {
      method: 'PUT',
      scope,
      body: JSON.stringify({ items })
    }
  )
  return data.todoList
}

PrizmClient.prototype.createTodoItem = async function (
  this: PrizmClient,
  scope: string | undefined,
  payload: CreateTodoItemPayload & { listId?: string; listTitle?: string }
) {
  const data = await this.request<{ todoList: TodoList }>('/todo/items', {
    method: 'POST',
    scope,
    body: JSON.stringify(payload)
  })
  return data.todoList
}

PrizmClient.prototype.updateTodoItem = async function (
  this: PrizmClient,
  itemId: string,
  payload: UpdateTodoItemPayload,
  scope?: string
) {
  const data = await this.request<{ todoList: TodoList }>(
    `/todo/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      scope,
      body: JSON.stringify(payload)
    }
  )
  return data.todoList
}

PrizmClient.prototype.deleteTodoItem = async function (
  this: PrizmClient,
  itemId: string,
  scope?: string
) {
  const data = await this.request<{ todoList: TodoList | null }>(
    `/todo/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      scope
    }
  )
  return data.todoList ?? null
}

PrizmClient.prototype.deleteTodoList = async function (
  this: PrizmClient,
  scope: string | undefined,
  listId: string
) {
  await this.request<void>(`/todo/lists/${encodeURIComponent(listId)}`, {
    method: 'DELETE',
    scope
  })
}
