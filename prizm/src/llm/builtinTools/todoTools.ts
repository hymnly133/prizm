/**
 * 内置工具：待办列表 & 条目 CRUD
 *
 * Action 分两级：
 *   列表级 — list / create_list / delete_list
 *   条目级 — add_items / update_item / delete_item
 *
 * Scope 级通过 TodoService，Session 工作区直接使用 mdStore
 */

import * as mdStore from '../../core/mdStore'
import * as todoService from '../../services/todoService'
import { ResourceLockedException, ResourceNotFoundException } from '../../services/errors'
import { captureFileSnapshot } from '../../core/checkpointStore'
import {
  resolveWorkspaceType,
  resolveFolder,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import type { WorkspaceType } from '../workspaceResolver'
import type { TodoList } from '@prizm/shared'
import type { TodoItemStatus } from '../../types'
import type { AuditAction } from '../../core/agentAuditLog'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/* ── 公共辅助 ── */

function captureTodoListSnapshot(
  sessionId: string | undefined,
  listId: string,
  list: TodoList | null
): void {
  if (!sessionId) return
  const key = `[todo:${listId}]`
  if (list) {
    captureFileSnapshot(sessionId, key, JSON.stringify({ action: 'modify', listSnapshot: list }))
  } else {
    captureFileSnapshot(sessionId, key, JSON.stringify({ action: 'create_list' }))
  }
}

function parseItemTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim())
}

function parseStatus(raw: unknown): TodoItemStatus {
  if (raw === 'doing' || raw === 'done') return raw
  return 'todo'
}

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

function lockOpts(ctx: BuiltinToolContext) {
  return { checkLock: true, lockSessionId: ctx.sessionId }
}

/* ── 列表级：list ── */

export async function executeList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const listId = typeof ctx.args.listId === 'string' ? ctx.args.listId : undefined
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  const lists = ws === 'session' ? mdStore.readTodoLists(wsRoot) : ctx.data.todoLists ?? []
  const suffix = wsTypeLabel(ws)

  if (!lists.length) return { text: `当前无待办列表。${suffix}` }

  if (listId) {
    const target = lists.find((l) => l.id === listId)
    if (!target) return { text: `列表不存在: ${listId}${suffix}`, isError: true }
    return { text: formatListDetail(target) + suffix }
  }

  const lines = lists.map((l) => {
    const count = l.items?.length ?? 0
    const doing = l.items?.filter((i) => i.status === 'doing').length ?? 0
    const done = l.items?.filter((i) => i.status === 'done').length ?? 0
    let stats = `${count} 项`
    if (count > 0) stats += `（进行中 ${doing}，已完成 ${done}）`
    return `- ${l.title} (listId: ${l.id}) ${stats}`
  })
  return { text: lines.join('\n') + suffix }
}

function formatListDetail(list: TodoList): string {
  const lines = [`[${list.title}] (listId: ${list.id})`]
  if (!list.items?.length) {
    lines.push('  (空列表)')
  } else {
    for (const it of list.items) {
      const desc = it.description ? ` — ${it.description}` : ''
      lines.push(`  - [${it.status}] ${it.title} (itemId: ${it.id})${desc}`)
    }
  }
  return lines.join('\n')
}

/* ── 列表级：create_list ── */

export async function executeCreateList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const listTitle = typeof ctx.args.listTitle === 'string' ? ctx.args.listTitle.trim() : ''
  if (!listTitle) {
    return { text: '必须指定 listTitle', isError: true }
  }

  const itemTitles = parseItemTitles(ctx.args.itemTitles)
  const status = parseStatus(ctx.args.status)

  const folderResult = resolveFolder(ctx.wsCtx, ctx.args.folder, ctx.wsArg, ctx.grantedPaths)
  if (!folderResult)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const { folder: folderPath, wsType: todoWsType } = folderResult
  const now = Date.now()

  // Session 工作区
  if (todoWsType === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const sanitizedName = mdStore.sanitizeFileName(listTitle) + '.md'
    const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
    const list = {
      id: require('node:crypto').randomUUID() as string,
      title: listTitle,
      items: [] as {
        id: string
        title: string
        description?: string
        status: TodoItemStatus
        createdAt: number
        updatedAt: number
      }[],
      relativePath,
      createdAt: now,
      updatedAt: now
    }

    for (const t of itemTitles) {
      const item = {
        id: require('node:crypto').randomUUID() as string,
        title: t,
        status,
        createdAt: now,
        updatedAt: now
      }
      list.items.push(item)
      ctx.record(item.id, 'todo', 'create')
    }

    mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, list)
    return { text: fmtCreateList(list.id, listTitle, list.items.length, todoWsType) }
  }

  // Scope 主工作区
  const opCtx = buildOpCtx(ctx)
  try {
    const sanitizedName = mdStore.sanitizeFileName(listTitle) + '.md'
    const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
    const newList = await todoService.createTodoList(opCtx, { title: listTitle, relativePath })
    captureTodoListSnapshot(ctx.sessionId, newList.id, null)

    for (const t of itemTitles) {
      const { item } = await todoService.createTodoItem(
        opCtx,
        newList.id,
        { title: t, status },
        lockOpts(ctx)
      )
      ctx.record(item.id, 'todo', 'create')
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'create',
        resourceType: 'todo',
        resourceId: item.id,
        result: 'success'
      })
    }

    return { text: fmtCreateList(newList.id, listTitle, itemTitles.length) }
  } catch (err) {
    return handleTodoError(ctx, err, 'create')
  }
}

function fmtCreateList(
  listId: string,
  title: string,
  itemCount: number,
  wsType?: WorkspaceType
): string {
  const suffix = wsType ? wsTypeLabel(wsType) : ''
  if (itemCount === 0) return `已创建空列表「${title}」（listId: ${listId}）${suffix}`
  return `已创建列表「${title}」，含 ${itemCount} 项待办（listId: ${listId}）${suffix}`
}

/* ── 列表级：delete_list ── */

export async function executeDeleteList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const listId = typeof ctx.args.listId === 'string' ? ctx.args.listId : ''
  if (!listId) return { text: '必须指定 listId', isError: true }

  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)

  // Session 工作区
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const lists = mdStore.readTodoLists(ctx.wsCtx.sessionWorkspaceRoot)
    const idx = lists.findIndex((l) => l.id === listId)
    if (idx < 0) return { text: `列表不存在: ${listId}${wsTypeLabel(ws)}`, isError: true }
    const title = lists[idx].title
    lists.splice(idx, 1)
    mdStore.writeTodoLists(ctx.wsCtx.sessionWorkspaceRoot, lists)
    return { text: `已删除列表「${title}」${wsTypeLabel(ws)}` }
  }

  // Scope 主工作区
  const opCtx = buildOpCtx(ctx)
  try {
    const existing = await todoService.getTodoList(ctx.scope, listId)
    if (existing) {
      captureTodoListSnapshot(ctx.sessionId, listId, structuredClone(existing))
    }
    await todoService.deleteTodoList(opCtx, listId, lockOpts(ctx))
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'todo',
      resourceId: listId,
      result: 'success'
    })
    return { text: `已删除列表「${existing?.title ?? listId}」` }
  } catch (err) {
    return handleTodoError(ctx, err, 'delete', listId)
  }
}

/* ── 条目级：add_items ── */

export async function executeAddItems(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const listId = typeof ctx.args.listId === 'string' ? ctx.args.listId : ''
  if (!listId) return { text: '必须指定 listId', isError: true }

  const itemTitles = parseItemTitles(ctx.args.itemTitles)
  if (itemTitles.length === 0) return { text: '必须指定 itemTitles（至少一项）', isError: true }

  const status = parseStatus(ctx.args.status)
  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  const now = Date.now()

  // Session 工作区
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const existing = mdStore.readSingleTodoListById(ctx.wsCtx.sessionWorkspaceRoot, listId)
    if (!existing) return { text: `列表不存在: ${listId}${wsTypeLabel(ws)}`, isError: true }

    const createdIds: string[] = []
    for (const t of itemTitles) {
      const item = {
        id: require('node:crypto').randomUUID() as string,
        title: t,
        status,
        createdAt: now,
        updatedAt: now
      }
      existing.items.push(item)
      createdIds.push(item.id)
      ctx.record(item.id, 'todo', 'create')
    }
    existing.updatedAt = now
    mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, existing)
    return { text: fmtAddItems(listId, createdIds, ws) }
  }

  // Scope 主工作区
  const opCtx = buildOpCtx(ctx)
  try {
    const existingList = await todoService.getTodoList(ctx.scope, listId)
    if (existingList) {
      captureTodoListSnapshot(ctx.sessionId, listId, structuredClone(existingList))
    }

    const createdIds: string[] = []
    for (const t of itemTitles) {
      const { item } = await todoService.createTodoItem(
        opCtx,
        listId,
        { title: t, status },
        lockOpts(ctx)
      )
      createdIds.push(item.id)
      ctx.record(item.id, 'todo', 'create')
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'create',
        resourceType: 'todo',
        resourceId: item.id,
        result: 'success'
      })
    }
    return { text: fmtAddItems(listId, createdIds) }
  } catch (err) {
    return handleTodoError(ctx, err, 'create', listId)
  }
}

function fmtAddItems(listId: string, itemIds: string[], wsType?: WorkspaceType): string {
  const suffix = wsType ? wsTypeLabel(wsType) : ''
  if (itemIds.length === 1) {
    return `已添加 1 项待办到列表 ${listId}（itemId: ${itemIds[0]}）${suffix}`
  }
  return `已添加 ${itemIds.length} 项待办到列表 ${listId}${suffix}`
}

/* ── 条目级：update_item ── */

export async function executeUpdateItem(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const itemId = typeof ctx.args.itemId === 'string' ? ctx.args.itemId : ''
  if (!itemId) return { text: '必须指定 itemId', isError: true }

  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)

  // Session 工作区
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const lists = mdStore.readTodoLists(ctx.wsCtx.sessionWorkspaceRoot)
    for (const list of lists) {
      const item = list.items.find((it) => it.id === itemId)
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
        ctx.record(itemId, 'todo', 'update')
        return { text: `已更新条目 ${itemId}${wsTypeLabel(ws)}` }
      }
    }
    return { text: `条目不存在: ${itemId}${wsTypeLabel(ws)}`, isError: true }
  }

  // Scope 主工作区
  const opCtx = buildOpCtx(ctx)
  try {
    const found = await todoService.findTodoItem(ctx.scope, itemId)
    if (found) {
      captureTodoListSnapshot(ctx.sessionId, found.list.id, structuredClone(found.list))
    }

    const payload: todoService.UpdateTodoItemPayload = {}
    if (ctx.args.status === 'todo' || ctx.args.status === 'doing' || ctx.args.status === 'done')
      payload.status = ctx.args.status
    if (typeof ctx.args.title === 'string') payload.title = ctx.args.title
    if (ctx.args.description !== undefined)
      payload.description = typeof ctx.args.description === 'string' ? ctx.args.description : null

    const { item } = await todoService.updateTodoItem(opCtx, itemId, payload, lockOpts(ctx))

    ctx.record(itemId, 'todo', 'update')
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'update',
      resourceType: 'todo',
      resourceId: itemId,
      resourceTitle: item.title,
      detail: ctx.args.status ? `status=${ctx.args.status}` : undefined,
      result: 'success'
    })
    return { text: `已更新条目 ${itemId}` }
  } catch (err) {
    return handleTodoError(ctx, err, 'update', itemId)
  }
}

/* ── 条目级：delete_item ── */

export async function executeDeleteItem(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const itemId = typeof ctx.args.itemId === 'string' ? ctx.args.itemId : ''
  if (!itemId) return { text: '必须指定 itemId', isError: true }

  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)

  // Session 工作区
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const lists = mdStore.readTodoLists(ctx.wsCtx.sessionWorkspaceRoot)
    for (const list of lists) {
      const idx = list.items.findIndex((it) => it.id === itemId)
      if (idx >= 0) {
        list.items.splice(idx, 1)
        list.updatedAt = Date.now()
        mdStore.writeSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, list)
        ctx.record(itemId, 'todo', 'delete')
        return { text: `已删除条目 ${itemId}${wsTypeLabel(ws)}` }
      }
    }
    return { text: `条目不存在: ${itemId}${wsTypeLabel(ws)}`, isError: true }
  }

  // Scope 主工作区
  const opCtx = buildOpCtx(ctx)
  try {
    const found = await todoService.findTodoItem(ctx.scope, itemId)
    if (found) {
      captureTodoListSnapshot(ctx.sessionId, found.list.id, structuredClone(found.list))
    }

    const { deletedTitle } = await todoService.deleteTodoItem(opCtx, itemId, lockOpts(ctx))

    ctx.record(itemId, 'todo', 'delete')
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'todo',
      resourceId: itemId,
      resourceTitle: deletedTitle,
      result: 'success'
    })
    return { text: `已删除条目 ${itemId}` }
  } catch (err) {
    return handleTodoError(ctx, err, 'delete', itemId)
  }
}

/* ── 统一错误处理 ── */

function handleTodoError(
  ctx: BuiltinToolContext,
  err: unknown,
  action: AuditAction,
  resourceId?: string
): never | BuiltinToolResult {
  if (err instanceof ResourceLockedException) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action,
      resourceType: 'todo',
      resourceId: resourceId ?? '',
      result: 'denied',
      errorMessage: err.message
    })
    return { text: err.message, isError: true }
  }
  if (err instanceof ResourceNotFoundException) {
    return { text: err.message, isError: true }
  }
  throw err
}
