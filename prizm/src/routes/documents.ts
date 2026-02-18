/**
 * 文档路由 - 正式信息文档 CRUD
 * 写操作通过 DocumentService 统一处理，副作用由 EventBus Handler 提供
 */

import type { Router, Request, Response } from 'express'
import type { IDocumentsAdapter } from '../adapters/interfaces'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  ensureStringParam,
  getScopeForCreate,
  requireScopeForList,
  getScopeForReadById,
  findAcrossScopes
} from '../scopeUtils'
import { getVersionHistory, computeDiff, saveVersion } from '../core/documentVersionStore'
import { scopeStore } from '../core/ScopeStore'
import { lockManager } from '../core/resourceLockManager'
import { emit } from '../core/eventBus'
import * as documentService from '../services/documentService'
import { ResourceLockedException, ResourceNotFoundException } from '../services/errors'

const log = createLogger('Documents')

/**
 * 检查文档是否被 agent 锁定。
 * 返回 true 表示请求应被阻断（已发送 423 响应），false 表示可继续。
 */
function checkDocumentLock(
  req: Request,
  res: Response,
  scope: string,
  documentId: string
): boolean {
  const lock = lockManager.getLock(scope, 'document', documentId)
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
        resourceType: 'document',
        resourceId: documentId,
        detail: `User forced override via API`,
        result: 'success'
      },
      actor: { type: 'user', clientId: req.prizmClient?.clientId, source: 'api:force_override' }
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

/** 构建 User OperationContext */
function userContext(req: Request, scope: string, source: string) {
  return {
    scope,
    actor: {
      type: 'user' as const,
      clientId: req.prizmClient?.clientId,
      source
    }
  }
}

export function createDocumentsRoutes(
  router: Router,
  adapter?: IDocumentsAdapter,
  _searchIndex?: unknown
): void {
  if (!adapter) {
    log.warn('Documents adapter not provided, routes will return 503')
  }

  // GET /documents - 获取所有文档，scope 必填 ?scope=xxx
  // 返回 EnrichedDocument[]，自带 lockInfo
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const docs = await documentService.listDocuments(scope)
      const scopeLocks = lockManager.listScopeLocks(scope)
      const lockByDocId = new Map(
        scopeLocks.filter((l) => l.resourceType === 'document').map((l) => [l.resourceId, l])
      )
      const enriched = docs.map((doc) => ({
        ...doc,
        lockInfo: lockByDocId.get(doc.id) ?? null
      }))
      res.json({ documents: enriched })
    } catch (error) {
      log.error('get all documents error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /documents/:id - 获取单个文档，scope 可选 ?scope=xxx，未提供则跨 scope 查找
  // 返回 EnrichedDocument，附带 lockInfo + versionCount
  router.get('/documents/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let doc
      let resolvedScope: string | undefined = scopeHint ?? undefined
      if (scopeHint) {
        doc = await documentService.getDocument(scopeHint, id)
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        doc = found?.item ?? null
        resolvedScope = found?.scope
      }

      if (!doc || !resolvedScope) {
        return res.status(404).json({ error: 'Document not found' })
      }

      const lock = lockManager.getLock(resolvedScope, 'document', doc.id)
      const scopeRoot = scopeStore.getScopeRootPath(resolvedScope)
      const history = getVersionHistory(scopeRoot, doc.id)
      res.json({
        document: {
          ...doc,
          lockInfo: lock ?? null,
          versionCount: history.versions.length
        }
      })
    } catch (error) {
      log.error('get document by id error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /documents - 创建文档
  router.post('/documents', async (req: Request, res: Response) => {
    try {
      const { title, content } = req.body ?? {}
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' })
      }

      const scope = getScopeForCreate(req)
      const ctx = userContext(req, scope, 'api:documents')
      const doc = await documentService.createDocument(ctx, { title, content })

      res.status(201).json({ document: doc })
    } catch (error) {
      log.error('create document error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /documents/:id - 更新文档
  router.patch('/documents/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const payload = req.body ?? {}
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) {
          return res.status(404).json({ error: 'Document not found' })
        }
        scope = found.scope
      }

      // 锁检查：被 agent checkout 的文档，API 不可直接修改（除非 force）
      if (checkDocumentLock(req, res, scope, id)) return

      const ctx = userContext(req, scope, 'api:documents')
      const doc = await documentService.updateDocument(ctx, id, payload)

      res.json({ document: doc })
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return res.status(404).json({ error: error.message })
      }
      log.error('update document error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /documents/:id - 删除文档
  router.delete('/documents/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) {
          return res.status(404).json({ error: 'Document not found' })
        }
        scope = found.scope
      }

      // 锁检查
      if (checkDocumentLock(req, res, scope, id)) return

      const ctx = userContext(req, scope, 'api:documents')
      await documentService.deleteDocument(ctx, id)

      res.status(204).send()
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return res.status(404).json({ error: error.message })
      }
      log.error('delete document error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // ============ 版本历史 API ============

  // GET /documents/:id/versions - 获取版本历史列表（不含完整内容）
  router.get('/documents/:id/versions', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)

      const versions = history.versions.map((v) => ({
        version: v.version,
        timestamp: v.timestamp,
        title: v.title,
        contentHash: v.contentHash,
        changedBy: v.changedBy,
        changeReason: v.changeReason
      }))

      res.json({ documentId: id, versions })
    } catch (error) {
      log.error('get document versions error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /documents/:id/versions/:version - 获取特定版本（含完整内容）
  router.get('/documents/:id/versions/:version', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const versionNum = parseInt(ensureStringParam(req.params.version), 10)
      if (isNaN(versionNum) || versionNum < 1) {
        return res.status(400).json({ error: 'Invalid version number' })
      }

      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)
      const version = history.versions.find((v) => v.version === versionNum)

      if (!version) {
        return res.status(404).json({ error: `Version ${versionNum} not found` })
      }

      res.json({ version })
    } catch (error) {
      log.error('get document version error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /documents/:id/diff?from=V1&to=V2 - 获取两个版本之间的 diff
  router.get('/documents/:id/diff', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const fromVersion = parseInt(String(req.query.from), 10)
      const toVersion = parseInt(String(req.query.to), 10)

      if (isNaN(fromVersion) || isNaN(toVersion) || fromVersion < 1 || toVersion < 1) {
        return res.status(400).json({ error: 'Invalid from/to version numbers' })
      }

      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)
      const fromVer = history.versions.find((v) => v.version === fromVersion)
      const toVer = history.versions.find((v) => v.version === toVersion)

      if (!fromVer) return res.status(404).json({ error: `Version ${fromVersion} not found` })
      if (!toVer) return res.status(404).json({ error: `Version ${toVersion} not found` })

      const diff = computeDiff(fromVer.content, toVer.content)
      res.json({
        documentId: id,
        from: fromVersion,
        to: toVersion,
        diff
      })
    } catch (error) {
      log.error('get document diff error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /documents/:id/restore/:version - 恢复到指定版本
  router.post('/documents/:id/restore/:version', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const versionNum = parseInt(ensureStringParam(req.params.version), 10)
      if (isNaN(versionNum) || versionNum < 1) {
        return res.status(400).json({ error: 'Invalid version number' })
      }

      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => documentService.getDocument(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      }

      // 锁检查
      if (checkDocumentLock(req, res, scope, id)) return

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)
      const targetVersion = history.versions.find((v) => v.version === versionNum)

      if (!targetVersion) {
        return res.status(404).json({ error: `Version ${versionNum} not found` })
      }

      const ctx = userContext(req, scope, 'api:restore')
      const doc = await documentService.updateDocument(
        ctx,
        id,
        {
          title: targetVersion.title,
          content: targetVersion.content
        },
        { changeReason: `Restored to version ${versionNum}` }
      )

      // restore 操作需要手动保存一个版本快照，因为 DocumentService 不直接调 saveVersion
      saveVersion(scopeRoot, id, targetVersion.title, targetVersion.content, {
        changedBy: { type: 'user', source: 'api:restore' },
        changeReason: `Restored to version ${versionNum}`
      })

      res.json({ document: doc, restoredVersion: versionNum })
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return res.status(404).json({ error: error.message })
      }
      log.error('restore document version error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
