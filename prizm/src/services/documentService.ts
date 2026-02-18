/**
 * DocumentService — 统一文档 CRUD 业务逻辑
 * Agent 工具和 API 路由共用，确保一致的副作用（事件、锁检查）
 */

import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'
import { emit } from '../core/eventBus'
import { lockManager } from '../core/resourceLockManager'
import { createLogger } from '../logger'
import { ResourceLockedException, ResourceNotFoundException } from './errors'
import type { Document, CreateDocumentPayload, UpdateDocumentPayload } from '../types'
import type { OperationContext } from './types'

const log = createLogger('DocumentService')

// ─── 查询 ───

export async function listDocuments(scope: string): Promise<Document[]> {
  const data = scopeStore.getScopeData(scope)
  return [...data.documents]
}

export async function getDocument(scope: string, id: string): Promise<Document | null> {
  const data = scopeStore.getScopeData(scope)
  return data.documents.find((d) => d.id === id) ?? null
}

// ─── 写操作 ───

/**
 * 导入一个已有完整字段的文档（如从 session workspace 提升到主工作区）。
 * 保留原有 id、createdAt 等字段，不生成新 id。
 */
export async function importDocument(ctx: OperationContext, doc: Document): Promise<Document> {
  const data = scopeStore.getScopeData(ctx.scope)
  data.documents.push(doc)
  scopeStore.saveScope(ctx.scope)
  log.info('Document imported:', doc.id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('document:saved', {
    scope: ctx.scope,
    documentId: doc.id,
    title: doc.title,
    content: doc.content ?? '',
    actor: ctx.actor
  }).catch(() => {})

  return doc
}

export async function createDocument(
  ctx: OperationContext,
  payload: CreateDocumentPayload
): Promise<Document> {
  const data = scopeStore.getScopeData(ctx.scope)
  const now = Date.now()
  const doc: Document = {
    id: genUniqueId(),
    title: payload.title || '未命名文档',
    content: payload.content ?? '',
    relativePath: '',
    createdAt: now,
    updatedAt: now
  }
  data.documents.push(doc)
  scopeStore.saveScope(ctx.scope)
  log.info('Document created:', doc.id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('document:saved', {
    scope: ctx.scope,
    documentId: doc.id,
    title: doc.title,
    content: doc.content ?? '',
    actor: ctx.actor
  }).catch(() => {})

  return doc
}

export interface UpdateDocumentOptions {
  /** 是否检查资源锁（Agent 更新时需要） */
  checkLock?: boolean
  /** 是否强制覆盖锁（User force override 时使用） */
  force?: boolean
  /** 变更原因 */
  changeReason?: string
  /** 允许锁所有者写入时传入 sessionId 做匹配 */
  lockSessionId?: string
}

export async function updateDocument(
  ctx: OperationContext,
  id: string,
  payload: UpdateDocumentPayload,
  options?: UpdateDocumentOptions
): Promise<Document> {
  const data = scopeStore.getScopeData(ctx.scope)
  const idx = data.documents.findIndex((d) => d.id === id)
  if (idx < 0) throw new ResourceNotFoundException(`文档不存在: ${id}`)

  // 锁检查
  if (options?.checkLock) {
    const lock = lockManager.getLock(ctx.scope, 'document', id)
    if (lock) {
      const ownSession = options.lockSessionId ?? ctx.actor.sessionId
      if (lock.sessionId !== ownSession && !options.force) {
        throw new ResourceLockedException(
          `文档 ${id} 已被会话 ${lock.sessionId} 签出${
            lock.reason ? ` (${lock.reason})` : ''
          }，无法修改。`,
          lock.sessionId
        )
      }
    }
  }

  const existing = data.documents[idx]
  const previousContent = existing.content ?? ''
  if (payload.title !== undefined) existing.title = payload.title
  if (payload.content !== undefined) existing.content = payload.content
  existing.updatedAt = Date.now()
  scopeStore.saveScope(ctx.scope)
  log.info('Document updated:', id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('document:saved', {
    scope: ctx.scope,
    documentId: id,
    title: existing.title,
    content: existing.content ?? '',
    previousContent,
    actor: ctx.actor,
    changeReason: options?.changeReason
  }).catch(() => {})

  return { ...existing }
}

export interface DeleteDocumentOptions {
  /** 是否检查资源锁 */
  checkLock?: boolean
  /** 是否强制覆盖锁 */
  force?: boolean
  /** 允许锁所有者删除时传入 sessionId 做匹配 */
  lockSessionId?: string
}

export async function deleteDocument(
  ctx: OperationContext,
  id: string,
  options?: DeleteDocumentOptions
): Promise<void> {
  const data = scopeStore.getScopeData(ctx.scope)
  const idx = data.documents.findIndex((d) => d.id === id)
  if (idx < 0) throw new ResourceNotFoundException(`文档不存在: ${id}`)

  // 锁检查
  if (options?.checkLock) {
    const lock = lockManager.getLock(ctx.scope, 'document', id)
    if (lock) {
      const ownSession = options.lockSessionId ?? ctx.actor.sessionId
      if (lock.sessionId !== ownSession && !options.force) {
        throw new ResourceLockedException(
          `文档 ${id} 已被会话 ${lock.sessionId} 签出${
            lock.reason ? ` (${lock.reason})` : ''
          }，无法删除。`,
          lock.sessionId
        )
      }
    }
  }

  data.documents.splice(idx, 1)
  scopeStore.saveScope(ctx.scope)
  log.info('Document deleted:', id, 'scope:', ctx.scope, 'actor:', ctx.actor.type)

  emit('document:deleted', {
    scope: ctx.scope,
    documentId: id,
    actor: ctx.actor
  }).catch(() => {})
}
