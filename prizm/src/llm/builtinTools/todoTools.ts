/**
 * 内置工具：待办项 list/read/create/update/delete 执行逻辑
 */

import { scopeStore } from '../../core/ScopeStore'
import * as mdStore from '../../core/mdStore'
import { genUniqueId } from '../../id'
import type { TodoItemStatus, TodoList } from '../../types'
import { getScopeRefItem } from '../scopeItemRegistry'
import { lockManager } from '../../core/resourceLockManager'
import {
  resolveWorkspaceType,
  resolveFolder,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/**
 * 检查待办列表是否被其他会话 claimed，返回错误信息或 null
 */
function checkTodoListClaim(ctx: BuiltinToolContext, listId: string): string | null {
  const lock = lockManager.getLock(ctx.scope, 'todo_list', listId)
  if (lock && lock.sessionId !== ctx.sessionId) {
    const since = new Date(lock.acquiredAt).toISOString()
    return `待办列表 ${listId} 已被会话 ${lock.sessionId} 领取（${since}起），无法修改。可等待释放或联系用户强制释放。`
  }
  return null
}

export async function executeListTodos(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  const lists = ws === 'session' ? mdStore.readTodoLists(wsRoot) : ctx.data.todoLists ?? []
  if (!lists.length) return { text: `当前无待办列表。${wsTypeLabel(ws)}` }
  const lines: string[] = []
  for (const list of lists) {
    if (list.items?.length) {
      lines.push(`[${list.title}] (listId: ${list.id})`)
      for (const it of list.items) {
        lines.push(`  - ${it.id}: [${it.status}] ${it.title}`)
      }
    } else {
      lines.push(`[${list.title}] (listId: ${list.id}) 空`)
    }
  }
  return { text: lines.join('\n') + wsTypeLabel(ws) }
}

export async function executeListTodoLists(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  const lists = ws === 'session' ? mdStore.readTodoLists(wsRoot) : ctx.data.todoLists ?? []
  if (!lists.length) return { text: `当前无待办列表。${wsTypeLabel(ws)}` }
  const lines = lists.map((l) => `- ${l.id}: ${l.title} (${l.items?.length ?? 0} 项)`)
  return { text: lines.join('\n') + wsTypeLabel(ws) }
}

export async function executeReadTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoId = typeof ctx.args.todoId === 'string' ? ctx.args.todoId : ''
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session') {
    const lists = mdStore.readTodoLists(wsRoot)
    for (const list of lists) {
      const item = list.items.find((it) => it.id === todoId)
      if (item) {
        const desc = item.description ? `\n${item.description}` : ''
        return { text: `[${item.status}] ${item.title}${desc} (列表: ${list.title})` }
      }
    }
    return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
  }
  const detail = getScopeRefItem(ctx.scope, 'todo', todoId)
  if (!detail) return { text: `待办项不存在: ${todoId}`, isError: true }
  return { text: detail.content || '(空)' }
}

export async function executeCreateTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const listTitle = typeof ctx.args.listTitle === 'string' ? ctx.args.listTitle.trim() : undefined
  const listId = typeof ctx.args.listId === 'string' ? ctx.args.listId : undefined
  if (!listId && !listTitle) {
    return {
      text: '必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）',
      isError: true
    }
  }
  const folderResult = resolveFolder(ctx.wsCtx, ctx.args.folder, ctx.wsArg)
  if (!folderResult)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const { folder: folderPath, wsType: todoWsType } = folderResult
  const todoTitle = typeof ctx.args.title === 'string' ? ctx.args.title : '(无标题)'
  const todoDesc = typeof ctx.args.description === 'string' ? ctx.args.description : undefined
  const todoStatus = (
    ctx.args.status === 'doing' || ctx.args.status === 'done' ? ctx.args.status : 'todo'
  ) as TodoItemStatus
  const now = Date.now()
  const newItem = {
    id: genUniqueId(),
    title: todoTitle,
    description: todoDesc,
    status: todoStatus,
    createdAt: now,
    updatedAt: now
  }

  if (todoWsType === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    let list: TodoList
    if (listId) {
      const existing = mdStore.readSingleTodoListById(ctx.wsCtx.sessionWorkspaceRoot, listId)
      if (!existing) return { text: `待办列表不存在: ${listId} [临时工作区]`, isError: true }
      list = existing
    } else {
      const sanitizedName = mdStore.sanitizeFileName(listTitle!) + '.md'
      const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
      list = {
        id: genUniqueId(),
        title: listTitle!,
        items: [],
        relativePath,
        createdAt: now,
        updatedAt: now
      }
    }
    list.items.push(newItem)
    list.updatedAt = now
    mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, list)
    ctx.record(newItem.id, 'todo', 'create')
    const hint = listTitle ? `（新建列表「${listTitle}」）` : ''
    return { text: `已创建待办项 ${newItem.id}${hint}${wsTypeLabel(todoWsType)}` }
  }

  if (!ctx.data.todoLists) ctx.data.todoLists = []
  let list: TodoList
  if (listTitle) {
    const sanitizedName = mdStore.sanitizeFileName(listTitle) + '.md'
    const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
    list = {
      id: genUniqueId(),
      title: listTitle,
      items: [],
      relativePath,
      createdAt: now,
      updatedAt: now
    }
    ctx.data.todoLists.push(list)
  } else {
    const found = ctx.data.todoLists.find((l) => l.id === listId)
    if (!found) return { text: `待办列表不存在: ${listId}`, isError: true }
    // 检查列表是否被其他会话 claimed
    const claimError = checkTodoListClaim(ctx, found.id)
    if (claimError) {
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'create',
        resourceType: 'todo',
        resourceId: listId,
        result: 'denied',
        errorMessage: claimError
      })
      return { text: claimError, isError: true }
    }
    list = found
  }
  list.items.push(newItem)
  list.updatedAt = now
  scopeStore.saveScope(ctx.scope)
  ctx.record(newItem.id, 'todo', 'create')
  return {
    text: `已创建待办项 ${newItem.id}` + (listTitle ? `（新建列表「${listTitle}」）` : '')
  }
}

export async function executeUpdateTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoId = typeof ctx.args.todoId === 'string' ? ctx.args.todoId : ''
  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const lists = mdStore.readTodoLists(ctx.wsCtx.sessionWorkspaceRoot)
    for (const list of lists) {
      const item = list.items.find((it) => it.id === todoId)
      if (item) {
        if (ctx.args.status === 'todo' || ctx.args.status === 'doing' || ctx.args.status === 'done')
          item.status = ctx.args.status
        if (typeof ctx.args.title === 'string') item.title = ctx.args.title
        if (ctx.args.description !== undefined)
          (item as { description?: string }).description =
            typeof ctx.args.description === 'string' ? ctx.args.description : undefined
        item.updatedAt = Date.now()
        list.updatedAt = Date.now()
        mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, list)
        ctx.record(todoId, 'todo', 'update')
        return { text: `已更新待办项 ${todoId}${wsTypeLabel(ws)}` }
      }
    }
    return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
  }
  const lists = ctx.data.todoLists ?? []
  const todoList = lists.find((l) => l.items.some((it) => it.id === todoId))
  if (!todoList) return { text: `待办项不存在: ${todoId}`, isError: true }

  // 检查列表是否被其他会话 claimed
  const claimError = checkTodoListClaim(ctx, todoList.id)
  if (claimError) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'update',
      resourceType: 'todo',
      resourceId: todoId,
      result: 'denied',
      errorMessage: claimError
    })
    return { text: claimError, isError: true }
  }

  const idx = todoList.items.findIndex((it) => it.id === todoId)
  if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
  const cur = todoList.items[idx]
  if (ctx.args.status === 'todo' || ctx.args.status === 'doing' || ctx.args.status === 'done')
    cur.status = ctx.args.status
  if (typeof ctx.args.title === 'string') cur.title = ctx.args.title
  if (ctx.args.description !== undefined)
    (cur as { description?: string }).description =
      typeof ctx.args.description === 'string' ? ctx.args.description : undefined
  cur.updatedAt = Date.now()
  todoList.updatedAt = Date.now()
  scopeStore.saveScope(ctx.scope)
  ctx.record(todoId, 'todo', 'update')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'update',
    resourceType: 'todo',
    resourceId: todoId,
    resourceTitle: cur.title,
    detail: ctx.args.status ? `status=${ctx.args.status}` : undefined,
    result: 'success'
  })
  return { text: `已更新待办项 ${todoId}` }
}

export async function executeDeleteTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoId = typeof ctx.args.todoId === 'string' ? ctx.args.todoId : ''
  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const lists = mdStore.readTodoLists(ctx.wsCtx.sessionWorkspaceRoot)
    for (const list of lists) {
      const idx = list.items.findIndex((it) => it.id === todoId)
      if (idx >= 0) {
        list.items.splice(idx, 1)
        list.updatedAt = Date.now()
        mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, list)
        ctx.record(todoId, 'todo', 'delete')
        return { text: `已删除待办项 ${todoId} [临时工作区]` }
      }
    }
    return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
  }
  const lists = ctx.data.todoLists ?? []
  const todoList = lists.find((l) => l.items.some((it) => it.id === todoId))
  if (!todoList) return { text: `待办项不存在: ${todoId}`, isError: true }

  // 检查列表是否被其他会话 claimed
  const claimError = checkTodoListClaim(ctx, todoList.id)
  if (claimError) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'todo',
      resourceId: todoId,
      result: 'denied',
      errorMessage: claimError
    })
    return { text: claimError, isError: true }
  }

  const idx = todoList.items.findIndex((it) => it.id === todoId)
  if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
  const deletedTitle = todoList.items[idx].title
  todoList.items.splice(idx, 1)
  todoList.updatedAt = Date.now()
  scopeStore.saveScope(ctx.scope)
  ctx.record(todoId, 'todo', 'delete')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'delete',
    resourceType: 'todo',
    resourceId: todoId,
    resourceTitle: deletedTitle,
    result: 'success'
  })
  return { text: `已删除待办项 ${todoId}` }
}
