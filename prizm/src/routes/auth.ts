/**
 * Prizm Auth 路由
 */

import type { Router, Request, Response } from 'express'
import type { ClientRegistry } from '../auth/ClientRegistry'
import { scopeStore } from '../core/ScopeStore'
import { ensureStringParam } from '../scopeUtils'
import { getScopeInfos } from '../scopes'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'

const log = createLogger('Auth')

export function createAuthRoutes(router: Router, clientRegistry: ClientRegistry): void {
  // GET /auth/scopes - 列出所有 scope 及说明（Dashboard、客户端、MCP 配置用）
  router.get('/scopes', (_req: Request, res: Response) => {
    try {
      const scopes = scopeStore.getAllScopes()
      const infos = getScopeInfos(scopes)
      res.json({
        scopes,
        descriptions: Object.fromEntries(
          infos.map((i) => [i.id, { label: i.label, description: i.description }])
        )
      })
    } catch (error) {
      log.error('list scopes error:', error)
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
