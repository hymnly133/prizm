/**
 * Prizm Auth Middleware - 鉴权中间件
 */

import type { Request, Response, NextFunction } from 'express'
import type { ClientRegistry } from './ClientRegistry'
import { DEFAULT_SCOPE } from '../core/ScopeStore'

export interface PrizmAuthContext {
  clientId?: string
  allowedScopes: string[]
}

// 扩展 Express Request 类型，添加 WebSocket 服务器访问
declare global {
  namespace Express {
    interface Request {
      prizmClient?: PrizmAuthContext
      prizmScope?: string
      // prizmServer 将由服务器在中间件中设置
      prizmServer?: import('../websocket/WebSocketServer').WebSocketServer
    }
  }
}

const EXEMPT_PATHS = ['/', '/health', '/dashboard', '/auth']

function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
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

function extractScope(req: Request, allowedScopes: string[]): string {
  const headerScope = req.headers['x-prizm-scope']
  const queryScope = req.query.scope
  const scope = (
    typeof headerScope === 'string'
      ? headerScope
      : typeof queryScope === 'string'
        ? queryScope
        : null
  )?.trim()
  const resolved = scope || DEFAULT_SCOPE
  if (allowedScopes.includes(resolved) || allowedScopes.includes('*')) {
    return resolved
  }
  return DEFAULT_SCOPE
}

export interface CreateAuthMiddlewareOptions {
  clientRegistry: ClientRegistry
  authEnabled?: boolean
}

export function createAuthMiddleware(options: CreateAuthMiddlewareOptions) {
  const { clientRegistry, authEnabled = true } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authEnabled) {
      req.prizmScope = extractScope(req, ['*'])
      next()
      return
    }

    if (isExemptPath(req.path)) {
      req.prizmScope = extractScope(req, ['*'])
      next()
      return
    }

    const isPanelRequest = req.headers['x-prizm-panel'] === 'true'
    if (isPanelRequest) {
      req.prizmScope = extractScope(req, ['*'])
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
    req.prizmScope = extractScope(req, result.allowedScopes)
    next()
  }
}
