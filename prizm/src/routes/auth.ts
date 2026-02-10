/**
 * Prizm Auth 路由
 */

import type { Router, Request, Response } from 'express'
import type { ClientRegistry } from '../auth/ClientRegistry'
import { scopeStore } from '../core/ScopeStore'

export function createAuthRoutes(router: Router, clientRegistry: ClientRegistry): void {
  // GET /auth/scopes - 列出所有 scope（Dashboard 专用）
  router.get('/scopes', (_req: Request, res: Response) => {
    try {
      const scopes = scopeStore.getAllScopes()
      res.json({ scopes })
    } catch (error) {
      console.error('[Prizm Auth] list scopes error:', error)
      res.status(500).json({ error: String(error) })
    }
  })
  // GET /auth/clients - 列出客户端（Dashboard 专用）
  router.get('/clients', (_req: Request, res: Response) => {
    try {
      const clients = clientRegistry.list()
      res.json({ clients })
    } catch (error) {
      console.error('[Prizm Auth] list clients error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // DELETE /auth/clients/:clientId - 吊销客户端
  router.delete('/clients/:clientId', (req: Request, res: Response) => {
    try {
      const { clientId } = req.params
      const ok = clientRegistry.revoke(clientId)
      if (!ok) {
        return res.status(404).json({ error: 'Client not found' })
      }
      res.status(204).send()
    } catch (error) {
      console.error('[Prizm Auth] revoke client error:', error)
      res.status(500).json({ error: String(error) })
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
      console.error('[Prizm Auth] register error:', error)
      res.status(500).json({ error: String(error) })
    }
  })
}
