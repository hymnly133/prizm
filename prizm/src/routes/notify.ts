/**
 * Notification 路由
 */

import type { Router, Request, Response } from 'express'
import type { INotificationAdapter } from '../adapters/interfaces'
import { EVENT_TYPES } from '../websocket/types'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'

const log = createLogger('Notify')

export function createNotifyRoutes(router: Router, adapter?: INotificationAdapter): void {
  if (!adapter) {
    log.warn('Notification adapter not provided, routes will return 503')
  }

  // POST /notify - 发送通知
  router.post('/notify', async (req: Request, res: Response) => {
    try {
      if (!adapter) {
        return res.status(503).json({ error: 'Notification adapter not available' })
      }

      const { title, body, targetClientId } = req.body

      if (!title) {
        return res.status(400).json({ error: 'title is required' })
      }

      const wsServer = req.prizmServer

      // 通过 WebSocket 广播通知（通知不按 scope 过滤，全局送达）
      if (wsServer) {
        if (targetClientId) {
          // 发送到指定客户端
          wsServer.broadcastToClient(
            targetClientId,
            EVENT_TYPES.NOTIFICATION,
            { title, body },
            undefined
          )
          log.info('Sent notification to client', targetClientId)
        } else {
          // 广播到所有订阅者
          const delivered = wsServer.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, undefined)
          log.info('Broadcasted notification to', delivered, 'subscribers')
        }
      } else {
        log.warn('WebSocket server not available')
      }

      // 保持向后兼容，仍调用 adapter
      adapter.notify(title, body)

      res.json({
        success: true,
        delivered: !!wsServer,
        message: 'Notification sent via WebSocket if subscribers exist'
      })
    } catch (error) {
      log.error('notify error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /notify/subscribers - 获取订阅者列表
  router.get('/notify/subscribers', (req: Request, res: Response) => {
    try {
      const wsServer = req.prizmServer

      if (!wsServer) {
        return res.status(503).json({ error: 'WebSocket server not available' })
      }

      const allClients = wsServer.getConnectedClients()
      const notificationSubscribers = allClients.filter(
        (client: { clientId: string; registeredEvents: string[] }) =>
          client.registeredEvents.includes(EVENT_TYPES.NOTIFICATION)
      )

      res.json({
        totalSubscribers: notificationSubscribers.length,
        subscribers: notificationSubscribers.map(
          (client: { clientId: string; currentScope: string }) => ({
            clientId: client.clientId,
            currentScope: client.currentScope
          })
        )
      })
    } catch (error) {
      log.error('subscribers error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /notify/broadcast - 手动触发广播（用于测试）
  router.post('/notify/broadcast', (req: Request, res: Response) => {
    try {
      const { title, body } = req.body

      if (!title) {
        return res.status(400).json({ error: 'title is required' })
      }

      const wsServer = req.prizmServer

      if (!wsServer) {
        return res.status(503).json({ error: 'WebSocket server not available' })
      }

      const delivered = wsServer.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, undefined)

      res.json({
        success: true,
        delivered
      })
    } catch (error) {
      log.error('broadcast error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
