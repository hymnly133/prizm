/**
 * Prizm Auth 路由
 */

import type { Router, Request, Response } from 'express'
import type { ClientRegistry } from '../auth/ClientRegistry'
import { scopeStore } from '../core/ScopeStore'
import { scopeRegistry } from '../core/ScopeRegistry'
import { ensureStringParam } from '../scopeUtils'
import { getScopeInfos } from '../scopes'
import { DEFAULT_SCOPE, ONLINE_SCOPE, BUILTIN_SCOPES } from '@prizm/shared'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'

const log = createLogger('Auth')

export function createAuthRoutes(router: Router, clientRegistry: ClientRegistry): void {
  // GET /auth/scopes - 列出所有 scope 及说明（含 path、label、builtin）
  router.get('/scopes', (_req: Request, res: Response) => {
    try {
      const list = scopeRegistry.list()
      const scopes = scopeStore.getAllScopes()
      const infos = getScopeInfos(scopes)
      const byId = Object.fromEntries(list.map((e) => [e.id, e]))
      res.json({
        scopes,
        descriptions: Object.fromEntries(
          infos.map((i) => [i.id, { label: i.label, description: i.description }])
        ),
        scopeDetails: Object.fromEntries(
          scopes.map((id) => [
            id,
            {
              path: byId[id]?.path ?? null,
              label: byId[id]?.label ?? infos.find((x) => x.id === id)?.label ?? id,
              builtin:
                byId[id]?.builtin ?? BUILTIN_SCOPES.includes(id as (typeof BUILTIN_SCOPES)[number])
            }
          ])
        )
      })
    } catch (error) {
      log.error('list scopes error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /auth/scopes - 注册新 scope（从文件夹）
  router.post('/scopes', (req: Request, res: Response) => {
    try {
      const { id, path: folderPath, label } = req.body
      if (!id || typeof id !== 'string' || !folderPath || typeof folderPath !== 'string') {
        return res.status(400).json({ error: 'id and path are required' })
      }
      const trimmedId = id.trim()
      if (!trimmedId) return res.status(400).json({ error: 'id cannot be empty' })
      if (trimmedId === DEFAULT_SCOPE || trimmedId === ONLINE_SCOPE) {
        return res.status(400).json({ error: 'Cannot override builtin scopes' })
      }
      scopeStore.registerScope(
        trimmedId,
        folderPath.trim(),
        typeof label === 'string' ? label.trim() : undefined
      )
      res
        .status(201)
        .json({ scope: { id: trimmedId, path: folderPath, label: label || trimmedId } })
    } catch (error) {
      log.error('register scope error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /auth/scopes/:id - 更新 scope 标签
  router.patch('/scopes/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const { label } = req.body
      if (BUILTIN_SCOPES.includes(id as (typeof BUILTIN_SCOPES)[number])) {
        return res.status(400).json({ error: 'Cannot modify builtin scope' })
      }
      const rootPath = scopeRegistry.getScopeRootPath(id)
      if (!rootPath) return res.status(404).json({ error: 'Scope not found' })
      if (typeof label === 'string' && label.trim()) {
        scopeStore.registerScope(id, rootPath, label.trim())
      }
      const list = scopeRegistry.list()
      const entry = list.find((e) => e.id === id)
      res.json({ scope: { id, path: entry?.path, label: entry?.label ?? id } })
    } catch (error) {
      log.error('update scope error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /auth/scopes/:id - 注销 scope（不删除文件夹）
  router.delete('/scopes/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (BUILTIN_SCOPES.includes(id as (typeof BUILTIN_SCOPES)[number])) {
        return res.status(400).json({ error: 'Cannot delete builtin scope' })
      }
      const ok = scopeStore.unregisterScope(id)
      if (!ok) return res.status(404).json({ error: 'Scope not found or is builtin' })
      res.status(204).send()
    } catch (error) {
      log.error('delete scope error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
  // GET /auth/clients - 列出客户端（Dashboard 专用）
  router.get('/clients', (_req: Request, res: Response) => {
    try {
      const clients = clientRegistry.list()
      res.json({ clients })
    } catch (error) {
      log.error('list clients error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /auth/clients/:clientId/regenerate-key - 重新生成 API Key
  router.post('/clients/:clientId/regenerate-key', (req: Request, res: Response) => {
    try {
      const clientId = ensureStringParam(req.params.clientId)
      const apiKey = clientRegistry.regenerateApiKey(clientId)
      if (!apiKey) {
        return res.status(404).json({ error: 'Client not found' })
      }
      res.status(200).json({ apiKey })
    } catch (error) {
      log.error('regenerate key error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /auth/clients/:clientId - 吊销客户端
  router.delete('/clients/:clientId', (req: Request, res: Response) => {
    try {
      const clientId = ensureStringParam(req.params.clientId)
      const ok = clientRegistry.revoke(clientId)
      if (!ok) {
        return res.status(404).json({ error: 'Client not found' })
      }
      res.status(204).send()
    } catch (error) {
      log.error('revoke client error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /auth/register - 注册客户端
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { name, requestedScopes } = req.body
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required and must be a string' })
      }

      const rawScopes = Array.isArray(requestedScopes)
        ? requestedScopes.filter((s: unknown) => typeof s === 'string')
        : ['default']
      const scopes = rawScopes.length > 0 ? rawScopes : ['default']

      const result = clientRegistry.register(name.trim(), scopes)
      res.status(201).json(result)
    } catch (error) {
      log.error('register error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
