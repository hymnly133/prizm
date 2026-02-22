/**
 * Prizm Auth Middleware - 鉴权中间件
 */

import type { Request, Response, NextFunction } from 'express'
import type { ClientRegistry } from './ClientRegistry'

export interface PrizmAuthContext {
  clientId?: string
  allowedScopes: string[]
}

// 扩展 Express Request 类型，添加 WebSocket 服务器访问
declare global {
  namespace Express {
    interface Request {
      prizmClient?: PrizmAuthContext
      /** @deprecated scope 已改为请求参数，不再使用全局 prizmScope */
      prizmScope?: string
      // prizmServer 将由服务器在中间件中设置
      prizmServer?: import('../websocket/WebSocketServer').WebSocketServer
    }
  }
}

const EXEMPT_PATHS = ['/', '/health', '/dashboard']

/** Paths that are exempt regardless of method */
function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Auth routes that remain exempt (no API key required).
 * Only POST /auth/register and GET /auth/scopes (read-only) are exempt;
 * GET /auth/clients, DELETE /auth/clients/:id, POST .../regenerate-key require auth.
 */
function isAuthExemptPath(method: string, pathname: string): boolean {
  if (pathname === '/auth/register' && method === 'POST') return true
  if (pathname === '/auth/scopes' && method === 'GET') return true
  return false
}

function extractApiKey(req: Request): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null
  }
  const headerKey = req.headers['x-prizm-api-key']
  if (typeof headerKey === 'string') {
    return headerKey.trim() || null
  }
  const queryKey = req.query.apiKey
  if (typeof queryKey === 'string') {
    return queryKey.trim() || null
  }
  return null
}

export interface CreateAuthMiddlewareOptions {
  clientRegistry: ClientRegistry
  authEnabled?: boolean
}

export function createAuthMiddleware(options: CreateAuthMiddlewareOptions) {
  const { clientRegistry, authEnabled = true } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authEnabled) {
      next()
      return
    }

    if (isExemptPath(req.path) || isAuthExemptPath(req.method, req.path)) {
      next()
      return
    }

    const isPanelRequest = req.headers['x-prizm-panel'] === 'true'
    if (isPanelRequest) {
      next()
      return
    }

    const apiKey = extractApiKey(req)
    if (!apiKey) {
      res.status(401).json({
        error: 'Missing API key. Use Authorization: Bearer <key>, X-Prizm-Api-Key, or ?apiKey='
      })
      return
    }

    const result = clientRegistry.validate(apiKey)
    if (!result) {
      res.status(401).json({ error: 'Invalid API key' })
      return
    }

    req.prizmClient = {
      clientId: result.clientId,
      allowedScopes: result.allowedScopes
    }
    next()
  }
}
