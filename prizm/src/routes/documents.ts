/**
 * 文档路由 - 正式信息文档 CRUD
 */

import type { Router, Request, Response } from 'express'
import type { IDocumentsAdapter } from '../adapters/interfaces'
import type { CreateDocumentPayload, UpdateDocumentPayload } from '../types'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  ensureStringParam,
  getScopeForCreate,
  requireScopeForList,
  getScopeForReadById,
  findAcrossScopes
} from '../scopeUtils'
import type { SearchIndexService } from '../search/searchIndexService'
import { getVersionHistory, computeDiff, saveVersion } from '../core/documentVersionStore'
import { scopeStore } from '../core/ScopeStore'

const log = createLogger('Documents')

export function createDocumentsRoutes(
  router: Router,
  adapter?: IDocumentsAdapter,
  searchIndex?: SearchIndexService | null
): void {
  if (!adapter) {
    log.warn('Documents adapter not provided, routes will return 503')
  }

  // GET /documents - 获取所有文档，scope 必填 ?scope=xxx
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getAllDocuments) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const docs = await adapter.getAllDocuments(scope)
      res.json({ documents: docs })
    } catch (error) {
      log.error('get all documents error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /documents/:id - 获取单个文档，scope 可选 ?scope=xxx，未提供则跨 scope 查找
  router.get('/documents/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getDocumentById) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let doc
      if (scopeHint) {
        doc = await adapter.getDocumentById(scopeHint, id)
      } else {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        doc = found?.item ?? null
      }

      if (!doc) {
        return res.status(404).json({ error: 'Document not found' })
      }

      res.json({ document: doc })
    } catch (error) {
      log.error('get document by id error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /documents - 创建文档，scope 可选 body.scope，默认 default
  router.post('/documents', async (req: Request, res: Response) => {
    try {
      if (!adapter?.createDocument) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const { title, content } = req.body ?? {}
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' })
      }

      const scope = getScopeForCreate(req)
      const payload: CreateDocumentPayload = { title, content }
      const doc = await adapter.createDocument(scope, payload)
      if (searchIndex) await searchIndex.addDocument(scope, doc)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES.DOCUMENT_CREATED,
          {
            id: doc.id,
            scope,
            title: doc.title,
            sourceClientId: req.prizmClient?.clientId
          },
          scope
        )
      }

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
      if (!adapter?.updateDocument) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const payload: UpdateDocumentPayload = req.body ?? {}
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) {
          return res.status(404).json({ error: 'Document not found' })
        }
        scope = found.scope
      }
      const doc = await adapter.updateDocument(scope, id, payload)
      if (searchIndex) await searchIndex.updateDocument(scope, id, doc)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES.DOCUMENT_UPDATED,
          {
            id: doc.id,
            scope,
            title: doc.title,
            sourceClientId: req.prizmClient?.clientId
          },
          scope
        )
      }

      res.json({ document: doc })
    } catch (error) {
      log.error('update document error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /documents/:id - 删除文档，scope 可选 query，未提供则跨 scope 查找
  router.delete('/documents/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteDocument) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) {
          return res.status(404).json({ error: 'Document not found' })
        }
        scope = found.scope
      }
      await adapter.deleteDocument(scope, id)
      if (searchIndex) await searchIndex.removeDocument(scope, id)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES.DOCUMENT_DELETED,
          { id, scope, sourceClientId: req.prizmClient?.clientId },
          scope
        )
      }

      res.status(204).send()
    } catch (error) {
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
      } else if (adapter?.getDocumentById) {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      } else {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)

      const versions = history.versions.map((v) => ({
        version: v.version,
        timestamp: v.timestamp,
        title: v.title,
        contentHash: v.contentHash
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
      } else if (adapter?.getDocumentById) {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      } else {
        return res.status(503).json({ error: 'Documents adapter not available' })
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
      } else if (adapter?.getDocumentById) {
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      } else {
        return res.status(503).json({ error: 'Documents adapter not available' })
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
      if (!adapter?.updateDocument || !adapter?.getDocumentById) {
        return res.status(503).json({ error: 'Documents adapter not available' })
      }

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
        const found = await findAcrossScopes(req, (s) => adapter!.getDocumentById!(s, id))
        if (!found) return res.status(404).json({ error: 'Document not found' })
        scope = found.scope
      }

      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const history = getVersionHistory(scopeRoot, id)
      const targetVersion = history.versions.find((v) => v.version === versionNum)

      if (!targetVersion) {
        return res.status(404).json({ error: `Version ${versionNum} not found` })
      }

      const doc = await adapter.updateDocument(scope, id, {
        title: targetVersion.title,
        content: targetVersion.content
      })

      saveVersion(scopeRoot, id, targetVersion.title, targetVersion.content)

      if (searchIndex) await searchIndex.updateDocument(scope, id, doc)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES.DOCUMENT_UPDATED,
          {
            id: doc.id,
            scope,
            title: doc.title,
            sourceClientId: req.prizmClient?.clientId
          },
          scope
        )
      }

      res.json({ document: doc, restoredVersion: versionNum })
    } catch (error) {
      log.error('restore document version error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
