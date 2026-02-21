/**
 * 内置工具：文档 list/get/create/update/delete 与 promote_file 执行逻辑
 * Scope 级 CRUD 通过 DocumentService 统一处理
 * Session 工作区操作（临时文件）仍直接使用 mdStore
 */

import { randomUUID } from 'node:crypto'
import * as mdStore from '../../core/mdStore'
import { listRefItems, getScopeRefItem } from '../scopeItemRegistry'
import { lockManager } from '../../core/resourceLockManager'
import { emit } from '../../core/eventBus'
import * as documentService from '../../services/documentService'
import * as todoService from '../../services/todoService'
import { ResourceLockedException, ResourceNotFoundException } from '../../services/errors'
import {
  resolveWorkspaceType,
  resolveFolder,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import { captureFileSnapshot } from '../../core/checkpointStore'
import { getLatestVersion } from '../../core/documentVersionStore'
import { scopeStore } from '../../core/ScopeStore'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

export async function executeListDocuments(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { root: wsRoot, wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session') {
    const docs = mdStore.readDocuments(wsRoot)
    if (!docs.length) return { text: `当前无文档。${wsTypeLabel('session')}` }
    const lines = docs.map((d) => `- ${d.id}: ${d.title} (${d.content?.length ?? 0} 字)`)
    return { text: lines.join('\n') + wsTypeLabel('session') }
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
    if (!doc) return { text: `文档不存在: ${documentId}${wsTypeLabel('session')}`, isError: true }
    return { text: doc.content || '(无正文)' }
  }
  const detail = getScopeRefItem(ctx.scope, 'document', documentId)
  if (!detail) {
    if (ctx.wsCtx.sessionWorkspaceRoot) {
      const sessionDoc = mdStore.readSingleDocumentById(ctx.wsCtx.sessionWorkspaceRoot, documentId)
      if (sessionDoc) return { text: (sessionDoc.content || '(无正文)') + wsTypeLabel('session') }
    }
    return { text: `文档不存在: ${documentId}`, isError: true }
  }

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
  const folderResult = resolveFolder(ctx.wsCtx, ctx.args.folder, ctx.wsArg, ctx.grantedPaths)
  if (!folderResult)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const { folder: folderPath, wsType } = folderResult

  // Session 工作区：直接 mdStore
  if (wsType === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const sanitizedName = mdStore.sanitizeFileName(title) + '.md'
    const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
    const now = Date.now()
    const doc = {
      id: randomUUID(),
      title,
      content,
      relativePath,
      createdAt: now,
      updatedAt: now
    }
    mdStore.writeSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, doc)
    ctx.record(doc.id, 'document', 'create')
    const folderHint = folderPath ? ` (${folderPath}/)` : ''
    return { text: `已创建文档 ${doc.id}${folderHint}${wsTypeLabel(wsType)}` }
  }

  // Scope 主工作区：通过 DocumentService
  const actor = ctx.sessionId
    ? { type: 'agent' as const, sessionId: ctx.sessionId, source: 'tool:prizm_create_document' }
    : { type: 'system' as const, source: 'tool:prizm_create_document' }

  const doc = await documentService.createDocument({ scope: ctx.scope, actor }, { title, content })

  if (ctx.sessionId) {
    captureFileSnapshot(ctx.sessionId, `[doc:${doc.id}]`, JSON.stringify({ action: 'create' }))
  }

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

  // Session 工作区：直接 mdStore
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const existing = mdStore.readSingleDocumentById(ctx.wsCtx.sessionWorkspaceRoot, documentId)
    if (!existing)
      return { text: `文档不存在: ${documentId}${wsTypeLabel('session')}`, isError: true }
    if (typeof ctx.args.title === 'string') existing.title = ctx.args.title
    if (typeof ctx.args.content === 'string') existing.content = ctx.args.content
    existing.updatedAt = Date.now()
    mdStore.writeSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, existing)
    ctx.record(documentId, 'document', 'update')
    return { text: `已更新文档 ${documentId}${wsTypeLabel('session')}` }
  }

  if (!ctx.sessionId) return { text: '需要活跃的会话才能编辑文档。', isError: true }

  // main 找不到时自动回落到 session 工作区
  const mainExists = getScopeRefItem(ctx.scope, 'document', documentId)
  if (!mainExists && ctx.wsCtx.sessionWorkspaceRoot) {
    const sessionDoc = mdStore.readSingleDocumentById(ctx.wsCtx.sessionWorkspaceRoot, documentId)
    if (sessionDoc) {
      if (typeof ctx.args.title === 'string') sessionDoc.title = ctx.args.title
      if (typeof ctx.args.content === 'string') sessionDoc.content = ctx.args.content
      sessionDoc.updatedAt = Date.now()
      mdStore.writeSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, sessionDoc)
      ctx.record(documentId, 'document', 'update')
      return { text: `已更新文档 ${documentId}${wsTypeLabel('session')}` }
    }
  }

  // Checkpoint 快照：记录修改前的版本号
  if (ctx.sessionId && mainExists) {
    const scopeRoot = scopeStore.getScopeRootPath(ctx.scope)
    const latestVer = getLatestVersion(scopeRoot, documentId)
    captureFileSnapshot(
      ctx.sessionId,
      `[doc:${documentId}]`,
      JSON.stringify({ action: 'update', versionBefore: latestVer?.version ?? 0 })
    )
  }

  // 主工作区：检查编辑锁，无锁时自动签出
  const lock = lockManager.getLock(ctx.scope, 'document', documentId)
  let autoCheckedOut = false

  if (!lock) {
    const lockResult = lockManager.acquireLock(
      ctx.scope,
      'document',
      documentId,
      ctx.sessionId,
      'auto-checkout'
    )
    if (!lockResult.success) {
      return { text: `文档正被其他会话编辑，无法自动签出。`, isError: true }
    }
    autoCheckedOut = true
    emit('resource:lock.changed', {
      action: 'locked',
      scope: ctx.scope,
      resourceType: 'document',
      resourceId: documentId,
      sessionId: ctx.sessionId,
      reason: 'auto-checkout'
    }).catch(() => {})
  } else if (lock.sessionId !== ctx.sessionId) {
    const heldInfo = `文档已被会话 ${lock.sessionId} 签出${
      lock.reason ? ` (原因: ${lock.reason})` : ''
    }`
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'update',
      resourceType: 'document',
      resourceId: documentId,
      result: 'denied',
      errorMessage: heldInfo
    })
    return { text: `无法编辑文档 ${documentId}：${heldInfo}`, isError: true }
  }

  const changeReason = typeof ctx.args.reason === 'string' ? ctx.args.reason : undefined
  const payload: Record<string, string> = {}
  if (typeof ctx.args.title === 'string') payload.title = ctx.args.title
  if (typeof ctx.args.content === 'string') payload.content = ctx.args.content

  try {
    const updated = await documentService.updateDocument(
      {
        scope: ctx.scope,
        actor: { type: 'agent', sessionId: ctx.sessionId, source: 'tool:prizm_update_document' }
      },
      documentId,
      payload,
      { checkLock: true, lockSessionId: ctx.sessionId, changeReason }
    )
    ctx.record(documentId, 'document', 'update')
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'update',
      resourceType: 'document',
      resourceId: documentId,
      resourceTitle: updated.title,
      detail: changeReason ? `reason="${changeReason}"` : undefined,
      result: 'success'
    })
    let msg = `已更新文档 ${documentId}`
    if (autoCheckedOut) {
      msg +=
        '\n\n[自动签出] 系统已自动签出此文档。编辑完成后请调用 prizm_lock({ action: "checkin", documentId: "' +
        documentId +
        '" }) 释放锁。'
    }
    return { text: msg }
  } catch (err) {
    if (err instanceof ResourceLockedException) {
      return { text: `写入中止：${err.message}`, isError: true }
    }
    if (err instanceof ResourceNotFoundException) {
      return { text: err.message, isError: true }
    }
    throw err
  }
}

export async function executeDeleteDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!ctx.sessionId) return { text: '需要活跃的会话才能删除文档。', isError: true }

  const { wsType: ws } = resolveWorkspaceType(ctx.wsCtx, ctx.wsArg)
  if (ws === 'session' && ctx.wsCtx.sessionWorkspaceRoot) {
    const ok = mdStore.deleteSingleDocument(ctx.wsCtx.sessionWorkspaceRoot, documentId)
    if (!ok) return { text: `文档不存在: ${documentId}${wsTypeLabel('session')}`, isError: true }
    ctx.record(documentId, 'document', 'delete')
    return { text: `已删除文档 ${documentId}${wsTypeLabel('session')}` }
  }

  // 自动签出：删除前需持有锁，无锁时自动获取，删除后自动释放
  const lock = lockManager.getLock(ctx.scope, 'document', documentId)
  let autoCheckedOut = false

  if (!lock) {
    const lockResult = lockManager.acquireLock(
      ctx.scope,
      'document',
      documentId,
      ctx.sessionId,
      'auto-checkout for delete'
    )
    if (!lockResult.success) {
      return { text: `文档正被其他会话编辑，无法删除。`, isError: true }
    }
    autoCheckedOut = true
  } else if (lock.sessionId !== ctx.sessionId) {
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'document',
      resourceId: documentId,
      result: 'denied',
      errorMessage: `文档已被会话 ${lock.sessionId} 签出`
    })
    return { text: `文档已被会话 ${lock.sessionId} 签出，无法删除。`, isError: true }
  }

  // Checkpoint 快照：记录删除前的版本号和元数据
  if (ctx.sessionId) {
    const docObj = await documentService.getDocument(ctx.scope, documentId)
    const scopeRoot = scopeStore.getScopeRootPath(ctx.scope)
    const latestVer = getLatestVersion(scopeRoot, documentId)
    captureFileSnapshot(
      ctx.sessionId,
      `[doc:${documentId}]`,
      JSON.stringify({
        action: 'delete',
        versionBefore: latestVer?.version ?? 0,
        title: docObj?.title,
        relativePath: docObj?.relativePath
      })
    )
  }

  try {
    await documentService.deleteDocument(
      {
        scope: ctx.scope,
        actor: { type: 'agent', sessionId: ctx.sessionId, source: 'tool:prizm_delete_document' }
      },
      documentId,
      { checkLock: true, lockSessionId: ctx.sessionId }
    )
    ctx.record(documentId, 'document', 'delete')
    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'delete',
      resourceType: 'document',
      resourceId: documentId,
      result: 'success'
    })
    // 删除成功后自动释放锁
    lockManager.releaseLock(ctx.scope, 'document', documentId, ctx.sessionId)
    emit('resource:lock.changed', {
      action: 'unlocked',
      scope: ctx.scope,
      resourceType: 'document',
      resourceId: documentId,
      sessionId: ctx.sessionId
    }).catch(() => {})
    return { text: `已删除文档 ${documentId}（锁已自动释放，无需 checkin）` }
  } catch (err) {
    if (autoCheckedOut) {
      lockManager.releaseLock(ctx.scope, 'document', documentId, ctx.sessionId)
    }
    if (err instanceof ResourceLockedException) {
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'delete',
        resourceType: 'document',
        resourceId: documentId,
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
}

export async function executePromoteFile(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const hasSession = ctx.wsCtx.sessionWorkspaceRoot && ctx.wsCtx.sessionId
  const hasWorkflow = !!ctx.wsCtx.runWorkspaceRoot
  if (!hasSession && !hasWorkflow) {
    return { text: '当前没有活跃的临时工作区或工作流工作区，无法执行提升操作。', isError: true }
  }

  const fileId = typeof ctx.args.fileId === 'string' ? ctx.args.fileId : ''
  if (!fileId) return { text: '必须指定 fileId', isError: true }
  const targetFolder = typeof ctx.args.folder === 'string' ? ctx.args.folder.trim() : ''

  const actor = {
    type: 'agent' as const,
    sessionId: ctx.sessionId,
    source: 'tool:prizm_promote_file'
  }
  const opCtx = { scope: ctx.scope, actor }

  // 依次在 workflow 工作区和 session 工作区中查找
  const searchRoots: Array<{ root: string; label: string }> = []
  if (hasWorkflow) searchRoots.push({ root: ctx.wsCtx.runWorkspaceRoot!, label: '运行工作区' })
  if (hasSession) searchRoots.push({ root: ctx.wsCtx.sessionWorkspaceRoot!, label: '临时工作区' })

  for (const { root, label } of searchRoots) {
    const doc = mdStore.readSingleDocumentById(root, fileId)
    if (doc) {
      if (targetFolder) {
        const sanitized = mdStore.sanitizeFileName(doc.title) + '.md'
        doc.relativePath = `${targetFolder}/${sanitized}`
      } else {
        doc.relativePath = ''
      }
      await documentService.importDocument(opCtx, doc)
      mdStore.deleteSingleDocument(root, fileId)
      ctx.record(doc.id, 'document', 'create')
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'create',
        resourceType: 'document',
        resourceId: doc.id,
        result: 'success'
      })
      return { text: `已将文档「${doc.title}」(${doc.id}) 从${label}提升到主工作区。` }
    }

    const todoList = mdStore.readSingleTodoListById(root, fileId)
    if (todoList) {
      if (targetFolder) {
        const sanitized = mdStore.sanitizeFileName(todoList.title) + '.md'
        todoList.relativePath = `${targetFolder}/${sanitized}`
      } else {
        todoList.relativePath = ''
      }
      await todoService.importTodoList(opCtx, todoList)
      mdStore.deleteSingleTodoList(root, fileId)
      ctx.record(todoList.id, 'todo', 'create')
      ctx.emitAudit({
        toolName: ctx.toolName,
        action: 'create',
        resourceType: 'todo',
        resourceId: todoList.id,
        result: 'success'
      })
      return {
        text: `已将待办列表「${todoList.title}」(${todoList.id}) 从${label}提升到主工作区。`
      }
    }
  }

  return {
    text:
      `未找到 ID 为 ${fileId} 的文档或待办列表。` +
      'prizm_promote_file 仅能提升 workspace="session" 或 workspace="workflow" 创建的文件；' +
      '如果文件已在主工作区（默认 workspace="main"），则无需提升。',
    isError: true
  }
}
