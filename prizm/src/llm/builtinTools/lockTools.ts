/**
 * 内置工具：资源锁定与领取工具
 * 文档签出/签入、待办列表领取/释放、资源状态查询
 */

import { scopeStore } from '../../core/ScopeStore'
import { lockManager } from '../../core/resourceLockManager'
import type { LockableResourceType } from '../../core/resourceLockManager'
import { getScopeRefItem } from '../scopeItemRegistry'
import { builtinToolEvents } from '../builtinToolEvents'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/**
 * prizm_checkout_document - 签出文档（获取编辑锁），返回当前内容
 */
export async function executeCheckoutDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!documentId) return { text: '请指定 documentId。', isError: true }
  if (!ctx.sessionId) return { text: '需要活跃的会话才能签出文档。', isError: true }

  const reason = typeof ctx.args.reason === 'string' ? ctx.args.reason : undefined

  // 验证文档存在
  const detail = getScopeRefItem(ctx.scope, 'document', documentId)
  if (!detail) return { text: `文档不存在: ${documentId}`, isError: true }

  // 获取锁
  const result = lockManager.acquireLock(ctx.scope, 'document', documentId, ctx.sessionId, reason)

  if (!result.success) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'checkout',
      resourceType: 'document',
      resourceId: documentId,
      result: 'denied',
      errorMessage: `已被 session ${result.heldBy?.sessionId} 签出`
    })
    const heldInfo = result.heldBy
      ? `已被会话 ${result.heldBy.sessionId} 签出（${new Date(
          result.heldBy.acquiredAt
        ).toISOString()}起）${result.heldBy.reason ? `，原因: ${result.heldBy.reason}` : ''}`
      : '获取锁失败'
    return {
      text: `文档签出失败: ${heldInfo}。可使用 prizm_resource_status 查看详情，或等待对方签入后重试。`,
      isError: true
    }
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'checkout',
    resourceType: 'document',
    resourceId: documentId,
    resourceTitle: detail.title,
    detail: `fenceToken=${result.lock!.fenceToken}${reason ? ` reason="${reason}"` : ''}`,
    result: 'success'
  })
  ctx.record(documentId, 'document', 'read')

  builtinToolEvents.emitLockEvent({
    eventType: 'resource:locked',
    scope: ctx.scope,
    resourceType: 'document',
    resourceId: documentId,
    sessionId: ctx.sessionId,
    reason
  })

  const content = detail.content || '(无正文)'
  return {
    text: `已签出文档「${detail.title}」(${documentId})，fenceToken=${
      result.lock!.fenceToken
    }。\n\n${content}`
  }
}

/**
 * prizm_checkin_document - 签入文档（释放锁）
 */
export async function executeCheckinDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!documentId) return { text: '请指定 documentId。', isError: true }
  if (!ctx.sessionId) return { text: '需要活跃的会话。', isError: true }

  const released = lockManager.releaseLock(ctx.scope, 'document', documentId, ctx.sessionId)

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'checkin',
    resourceType: 'document',
    resourceId: documentId,
    result: released ? 'success' : 'error',
    errorMessage: released ? undefined : '未持有该文档的锁'
  })

  if (!released) return { text: `签入失败: 当前会话未持有文档 ${documentId} 的锁。`, isError: true }

  builtinToolEvents.emitLockEvent({
    eventType: 'resource:unlocked',
    scope: ctx.scope,
    resourceType: 'document',
    resourceId: documentId,
    sessionId: ctx.sessionId
  })

  return { text: `已签入文档 ${documentId}，编辑锁已释放。` }
}

/**
 * prizm_claim_todo_list - 领取待办列表为会话在线待办
 */
export async function executeClaimTodoList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoListId = typeof ctx.args.todoListId === 'string' ? ctx.args.todoListId : ''
  if (!todoListId) return { text: '请指定 todoListId。', isError: true }
  if (!ctx.sessionId) return { text: '需要活跃的会话。', isError: true }

  // 验证列表存在
  const lists = ctx.data.todoLists ?? []
  const list = lists.find((l) => l.id === todoListId)
  if (!list) return { text: `待办列表不存在: ${todoListId}`, isError: true }

  const result = lockManager.acquireLock(
    ctx.scope,
    'todo_list',
    todoListId,
    ctx.sessionId,
    '领取在线待办'
  )

  if (!result.success) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'claim',
      resourceType: 'todo_list',
      resourceId: todoListId,
      result: 'denied',
      errorMessage: `已被 session ${result.heldBy?.sessionId} 领取`
    })
    return {
      text: `领取失败: 待办列表「${list.title}」已被会话 ${result.heldBy?.sessionId} 领取（${
        result.heldBy ? new Date(result.heldBy.acquiredAt).toISOString() : ''
      }起）。可使用 prizm_resource_status 查看详情，或等待对方释放后重试。`,
      isError: true
    }
  }

  // 设置初始元数据（空活跃项）
  lockManager.updateLockMetadata(ctx.scope, 'todo_list', todoListId, ctx.sessionId, {
    activeTodoIds: []
  })

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'claim',
    resourceType: 'todo_list',
    resourceId: todoListId,
    resourceTitle: list.title,
    result: 'success'
  })

  builtinToolEvents.emitLockEvent({
    eventType: 'resource:locked',
    scope: ctx.scope,
    resourceType: 'todo_list',
    resourceId: todoListId,
    sessionId: ctx.sessionId,
    reason: '领取在线待办'
  })

  const itemsSummary =
    list.items.length > 0
      ? list.items.map((it) => `  - [${it.status}] ${it.id}: ${it.title}`).join('\n')
      : '  (空列表)'

  return {
    text: `已领取待办列表「${list.title}」(${todoListId})，共 ${list.items.length} 项：\n${itemsSummary}`
  }
}

/**
 * prizm_set_active_todo - 设置正在实现的待办项
 */
export async function executeSetActiveTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoId = typeof ctx.args.todoId === 'string' ? ctx.args.todoId : ''
  if (!todoId) return { text: '请指定 todoId。', isError: true }
  if (!ctx.sessionId) return { text: '需要活跃的会话。', isError: true }

  // 找到 todo 所属的列表
  const lists = ctx.data.todoLists ?? []
  let targetListId = ''
  let targetItem: { id: string; title: string; status: string } | undefined
  for (const list of lists) {
    const item = list.items.find((it) => it.id === todoId)
    if (item) {
      targetListId = list.id
      targetItem = item
      break
    }
  }
  if (!targetItem) return { text: `待办项不存在: ${todoId}`, isError: true }

  // 检查是否已领取该列表
  const lock = lockManager.getLock(ctx.scope, 'todo_list', targetListId)
  if (!lock || lock.sessionId !== ctx.sessionId) {
    return { text: `需要先领取待办列表 ${targetListId} 才能设置活跃项。`, isError: true }
  }

  // 更新活跃项
  let meta: Record<string, unknown> = {}
  if (lock.metadata) {
    try {
      meta = JSON.parse(lock.metadata)
    } catch {
      /* ignore */
    }
  }
  const activeTodoIds = Array.isArray(meta.activeTodoIds) ? (meta.activeTodoIds as string[]) : []
  if (!activeTodoIds.includes(todoId)) {
    activeTodoIds.push(todoId)
  }

  lockManager.updateLockMetadata(ctx.scope, 'todo_list', targetListId, ctx.sessionId, {
    ...meta,
    activeTodoIds
  })

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'update',
    resourceType: 'todo',
    resourceId: todoId,
    resourceTitle: targetItem.title,
    detail: `setActive in list=${targetListId} activeCount=${activeTodoIds.length}`,
    result: 'success'
  })

  return { text: `已设置待办项「${targetItem.title}」(${todoId}) 为活跃状态，表示正在实现。` }
}

/**
 * prizm_release_todo_list - 释放待办列表领取
 */
export async function executeReleaseTodoList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const todoListId = typeof ctx.args.todoListId === 'string' ? ctx.args.todoListId : ''
  if (!todoListId) return { text: '请指定 todoListId。', isError: true }
  if (!ctx.sessionId) return { text: '需要活跃的会话。', isError: true }

  const released = lockManager.releaseLock(ctx.scope, 'todo_list', todoListId, ctx.sessionId)

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'release',
    resourceType: 'todo_list',
    resourceId: todoListId,
    result: released ? 'success' : 'error',
    errorMessage: released ? undefined : '未持有该待办列表的领取'
  })

  if (!released)
    return { text: `释放失败: 当前会话未持有待办列表 ${todoListId} 的领取。`, isError: true }

  builtinToolEvents.emitLockEvent({
    eventType: 'resource:unlocked',
    scope: ctx.scope,
    resourceType: 'todo_list',
    resourceId: todoListId,
    sessionId: ctx.sessionId
  })

  return { text: `已释放待办列表 ${todoListId} 的领取。` }
}

/**
 * prizm_resource_status - 查询资源状态（锁、读者、活跃 agent）
 */
export async function executeResourceStatus(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const resourceType = typeof ctx.args.resourceType === 'string' ? ctx.args.resourceType : ''
  const resourceId = typeof ctx.args.resourceId === 'string' ? ctx.args.resourceId : ''
  if (!resourceType || !resourceId) {
    return { text: '请指定 resourceType 和 resourceId。', isError: true }
  }

  if (resourceType !== 'document' && resourceType !== 'todo_list') {
    return { text: `不支持的资源类型: ${resourceType}。支持: document, todo_list`, isError: true }
  }

  const status = lockManager.getResourceStatus(
    ctx.scope,
    resourceType as LockableResourceType,
    resourceId
  )

  const lines: string[] = [`资源状态: ${resourceType}/${resourceId}`]

  if (status.lock) {
    lines.push(`锁定状态: 已签出`)
    lines.push(`  持有者: session ${status.lock.sessionId}`)
    lines.push(`  签出时间: ${new Date(status.lock.acquiredAt).toISOString()}`)
    lines.push(`  Fence Token: ${status.lock.fenceToken}`)
    if (status.lock.reason) lines.push(`  原因: ${status.lock.reason}`)
    if (status.lock.metadata) {
      try {
        const meta = JSON.parse(status.lock.metadata)
        if (Array.isArray(meta.activeTodoIds) && meta.activeTodoIds.length > 0) {
          lines.push(`  活跃待办项: ${meta.activeTodoIds.join(', ')}`)
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    lines.push('锁定状态: 未锁定')
  }

  if (status.recentReads.length > 0) {
    lines.push(`最近读取 (${status.recentReads.length} 条):`)
    for (const r of status.recentReads.slice(0, 10)) {
      lines.push(
        `  - session ${r.sessionId} 在 ${new Date(r.readAt).toISOString()} 读取 v${r.readVersion}`
      )
    }
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'read',
    resourceType: resourceType as 'document' | 'todo',
    resourceId,
    detail: `locked=${!!status.lock} reads=${status.recentReads.length}`,
    result: 'success'
  })

  return { text: lines.join('\n') }
}
