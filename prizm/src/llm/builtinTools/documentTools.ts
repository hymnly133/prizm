/**
 * 内置工具：文档 list/get/create/update/delete 与 promote_file 执行逻辑
 */

import { scopeStore } from '../../core/ScopeStore'
import * as mdStore from '../../core/mdStore'
import { genUniqueId } from '../../id'
import { listRefItems, getScopeRefItem } from '../scopeItemRegistry'
import { scheduleDocumentMemory } from '../documentMemoryService'
import { lockManager } from '../../core/resourceLockManager'
import {
  resolveWorkspaceType,
  resolveFolder,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

export async function executeListDocuments(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session') {
    const docs = mdStore.readDocuments(wsRoot)
    if (!docs.length) return { text: '当前无文档。 [临时工作区]' }
    const lines = docs.map((d) => `- ${d.id}: ${d.title} (${d.content?.length ?? 0} 字)`)
    return { text: lines.join('\n') + ' [临时工作区]' }
  }
  const items = listRefItems(ctx.scope, 'document')
  if (!items.length) return { text: '当前无文档。' }
  const lines = items.map((r) => `- ${r.id}: ${r.title} (${r.charCount} 字)`)
  return { text: lines.join('\n') }
}

export async function executeGetDocumentContent(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session') {
    const doc = mdStore.readSingleDocumentById(wsRoot, documentId)
    if (!doc) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
    return { text: doc.content || '(无正文)' }
  }
  const detail = getScopeRefItem(ctx.scope, 'document', documentId)
  if (!detail) return { text: `文档不存在: ${documentId}`, isError: true }

  // 记录读取历史
  if (ctx.sessionId) {
    lockManager.recordRead(
      ctx.scope,
      ctx.sessionId,
      'document',
      documentId,
      detail.updatedAt ?? Date.now()
    )
  }
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'read',
    resourceType: 'document',
    resourceId: documentId,
    resourceTitle: detail.title,
    result: 'success'
  })

  return { text: detail.content || '(无正文)' }
}

export async function executeCreateDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const title = typeof ctx.args.title === 'string' ? ctx.args.title : '未命名文档'
  const content = typeof ctx.args.content === 'string' ? ctx.args.content : ''
  const folderResult = resolveFolder(ctx.wsCtx, ctx.args.folder, ctx.wsArg)
  if (!folderResult)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const { folder: folderPath, wsType } = folderResult
  const sanitizedName = mdStore.sanitizeFileName(title) + '.md'
  const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
  const now = Date.now()
  const doc = {
    id: genUniqueId(),
    title,
    content,
    relativePath,
    createdAt: now,
    updatedAt: now
  }
  if (wsType === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    mdStore.writeSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, doc)
    ctx.record(doc.id, 'document', 'create')
    const folderHint = folderPath ? ` (${folderPath}/)` : ''
    return { text: `已创建文档 ${doc.id}${folderHint}${wsTypeLabel(wsType)}` }
  }
  ctx.data.documents.push(doc)
  scopeStore.saveScope(ctx.scope)
  const changedBy = ctx.sessionId
    ? { type: 'agent' as const, sessionId: ctx.sessionId, apiSource: 'tool:prizm_create_document' }
    : undefined
  scheduleDocumentMemory(ctx.scope, doc.id, { changedBy })
  ctx.record(doc.id, 'document', 'create')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'create',
    resourceType: 'document',
    resourceId: doc.id,
    resourceTitle: title,
    result: 'success'
  })
  const folderHint = folderPath ? ` (${folderPath}/)` : ''
  return { text: `已创建文档 ${doc.id}${folderHint}` }
}

export async function executeUpdateDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const existing = mdStore.readSingleDocumentById(ctx.wsCtx.sessionWorkspaceRoot, documentId)
    if (!existing) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
    if (typeof ctx.args.title === 'string') existing.title = ctx.args.title
    if (typeof ctx.args.content === 'string') existing.content = ctx.args.content
    existing.updatedAt = Date.now()
    mdStore.writeSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, existing)
    ctx.record(documentId, 'document', 'update')
    return { text: `已更新文档 ${documentId} [临时工作区]` }
  }

  if (!ctx.sessionId) return { text: '需要活跃的会话才能编辑文档。', isError: true }

  // 主工作区：检查是否持有编辑锁
  const lock = lockManager.getLock(ctx.scope, 'document', documentId)
  if (!lock || lock.sessionId !== ctx.sessionId) {
    const heldInfo = lock
      ? `文档已被会话 ${lock.sessionId} 签出${lock.reason ? ` (原因: ${lock.reason})` : ''}`
      : '文档未签出'
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'update',
      resourceType: 'document',
      resourceId: documentId,
      result: 'denied',
      errorMessage: heldInfo
    })
    return {
      text: `无法编辑文档 ${documentId}：${heldInfo}。请先调用 prizm_checkout_document 签出文档。`,
      isError: true
    }
  }

  const idx = ctx.data.documents.findIndex((d) => d.id === documentId)
  if (idx < 0) return { text: `文档不存在: ${documentId}`, isError: true }
  if (typeof ctx.args.title === 'string') ctx.data.documents[idx].title = ctx.args.title
  if (typeof ctx.args.content === 'string') ctx.data.documents[idx].content = ctx.args.content
  ctx.data.documents[idx].updatedAt = Date.now()

  // 写前二次验证：确保锁未在操作过程中过期被抢占
  const lockRecheck = lockManager.getLock(ctx.scope, 'document', documentId)
  if (!lockRecheck || lockRecheck.sessionId !== ctx.sessionId) {
    return {
      text: `写入中止：编辑锁在操作过程中已过期或被释放，请重新签出文档 ${documentId}。`,
      isError: true
    }
  }

  scopeStore.saveScope(ctx.scope)

  // 传入 changedBy 信息
  const changedBy = {
    type: 'agent' as const,
    sessionId: ctx.sessionId,
    apiSource: 'tool:prizm_update_document'
  }
  const changeReason = typeof ctx.args.reason === 'string' ? ctx.args.reason : undefined
  scheduleDocumentMemory(ctx.scope, documentId, { changedBy, changeReason })
  ctx.record(documentId, 'document', 'update')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    resourceTitle: ctx.data.documents[idx].title,
    detail: changeReason ? `reason="${changeReason}"` : undefined,
    result: 'success'
  })
  return { text: `已更新文档 ${documentId}` }
}

export async function executeDeleteDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!ctx.sessionId) return { text: '需要活跃的会话才能删除文档。', isError: true }

  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const ok = mdStore.deleteSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, documentId)
    if (!ok) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
    ctx.record(documentId, 'document', 'delete')
    return { text: `已删除文档 ${documentId} [临时工作区]` }
  }

  // 检查是否被其他 session 锁定
  const lock = lockManager.getLock(ctx.scope, 'document', documentId)
  if (lock && lock.sessionId !== ctx.sessionId) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'document',
      resourceId: documentId,
      result: 'denied',
      errorMessage: `文档被 session ${lock.sessionId} 签出，无法删除`
    })
    return {
      text: `文档 ${documentId} 已被会话 ${lock.sessionId} 签出${
        lock.reason ? ` (原因: ${lock.reason})` : ''
      }，无法删除。请等待该会话签入或联系用户强制释放。`,
      isError: true
    }
  }

  const idx = ctx.data.documents.findIndex((d) => d.id === documentId)
  if (idx < 0) return { text: `文档不存在: ${documentId}`, isError: true }
  const deletedTitle = ctx.data.documents[idx].title
  ctx.data.documents.splice(idx, 1)
  scopeStore.saveScope(ctx.scope)
  ctx.record(documentId, 'document', 'delete')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'delete',
    resourceType: 'document',
    resourceId: documentId,
    resourceTitle: deletedTitle,
    result: 'success'
  })
  return { text: `已删除文档 ${documentId}` }
}

export async function executePromoteFile(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  if (!ctx.wsCtx.sessionWorkspaceRoot || !ctx.wsCtx.sessionId)
    return { text: '当前没有活跃的临时工作区，无法执行提升操作。', isError: true }
  const fileId = typeof ctx.args.fileId === 'string' ? ctx.args.fileId : ''
  if (!fileId) return { text: '必须指定 fileId', isError: true }
  const targetFolder = typeof ctx.args.folder === 'string' ? ctx.args.folder.trim() : ''
  const data = ctx.data

  const doc = mdStore.readSingleDocumentById(ctx.wsCtx.sessionWorkspaceRoot, fileId)
  if (doc) {
    if (targetFolder) {
      const sanitized = mdStore.sanitizeFileName(doc.title) + '.md'
      doc.relativePath = `${targetFolder}/${sanitized}`
    } else {
      doc.relativePath = ''
    }
    data.documents.push(doc)
    scopeStore.saveScope(ctx.scope)
    mdStore.deleteSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, fileId)
    scheduleDocumentMemory(ctx.scope, doc.id)
    ctx.record(doc.id, 'document', 'create')
    return { text: `已将文档「${doc.title}」(${doc.id}) 从临时工作区提升到主工作区。` }
  }

  const todoList = mdStore.readSingleTodoListById(ctx.wsCtx.sessionWorkspaceRoot, fileId)
  if (todoList) {
    if (targetFolder) {
      const sanitized = mdStore.sanitizeFileName(todoList.title) + '.md'
      todoList.relativePath = `${targetFolder}/${sanitized}`
    } else {
      todoList.relativePath = ''
    }
    if (!data.todoLists) data.todoLists = []
    data.todoLists.push(todoList)
    scopeStore.saveScope(ctx.scope)
    mdStore.deleteSingleTodoList(ctx.wsCtx.sessionWorkspaceRoot, fileId)
    ctx.record(todoList.id, 'todo', 'create')
    return {
      text: `已将待办列表「${todoList.title}」(${todoList.id}) 从临时工作区提升到主工作区。`
    }
  }

  return { text: `在临时工作区中未找到 ID 为 ${fileId} 的文档或待办列表。`, isError: true }
}
