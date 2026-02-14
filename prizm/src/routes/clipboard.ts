/**
 * 剪贴板历史路由
 */

import type { Router, Request, Response } from 'express'
import type { IClipboardAdapter } from '../adapters/interfaces'
import type { ClipboardItem, ClipboardItemType } from '../types'
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

const log = createLogger('Clipboard')

export function createClipboardRoutes(router: Router, adapter?: IClipboardAdapter): void {
  if (!adapter) {
    log.warn('Clipboard adapter not provided, routes will return 503')
  }

  // GET /clipboard/history - 获取剪贴板历史，scope 必填 ?scope=xxx
  router.get('/clipboard/history', async (req: Request, res: Response) => {
    try {
      if (!adapter?.getHistory) {
        return res.status(503).json({ error: 'Clipboard adapter not available' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const { limit } = req.query
      let limitNum: number | undefined

      if (typeof limit === 'string') {
        const num = Number(limit)
        if (!Number.isNaN(num) && num > 0) {
          limitNum = num
        }
      }

      const items = await adapter.getHistory(scope, { limit: limitNum })
      res.json({ items })
    } catch (error) {
      log.error('get history error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /clipboard - 记录一条剪贴板历史
  router.post('/clipboard', async (req: Request, res: Response) => {
    try {
      if (!adapter?.addItem) {
        return res.status(503).json({ error: 'Clipboard adapter not available' })
      }

      const { type, content, sourceApp, createdAt } = req.body ?? {}
      if (!type || typeof type !== 'string') {
        return res.status(400).json({ error: 'type is required' })
      }
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required' })
      }

      const scope = getScopeForCreate(req)
      const validTypes: ClipboardItemType[] = ['text', 'image', 'file', 'other']
      const resolvedType = validTypes.includes(type as ClipboardItemType)
        ? (type as ClipboardItemType)
        : 'text'
      const payload: Omit<ClipboardItem, 'id'> = {
        type: resolvedType,
        content,
        sourceApp,
        createdAt: typeof createdAt === 'number' ? createdAt : Date.now()
      }
      const item = await adapter.addItem(scope, payload)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES.CLIPBOARD_ITEM_ADDED,
          { id: item.id, scope, content: item.content },
          scope
        )
      }

      res.status(201).json({ item })
    } catch (error) {
      log.error('add item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /clipboard/:id - 删除剪贴板历史记录，scope 可选 query，未提供则跨 scope 查找
  router.delete('/clipboard/:id', async (req: Request, res: Response) => {
    try {
      if (!adapter?.deleteItem) {
        return res.status(503).json({ error: 'Clipboard adapter not available' })
      }

      const id = ensureStringParam(req.params.id)
      const scopeHint = getScopeForReadById(req)
      let scope: string
      if (scopeHint) {
        scope = scopeHint
      } else {
        const found = await findAcrossScopes(req, async (s) => {
          const items = await adapter!.getHistory!(s, { limit: 10000 })
          return items.find((x) => x.id === id) ?? null
        })
        if (!found) {
          return res.status(404).json({ error: 'Clipboard item not found' })
        }
        scope = found.scope
      }
      await adapter.deleteItem(scope, id)

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(EVENT_TYPES.CLIPBOARD_ITEM_DELETED, { id, scope }, scope)
      }
      res.status(204).send()
    } catch (error) {
      log.error('delete item error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
