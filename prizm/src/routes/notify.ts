/**
 * Notification 路由
 */

import type { Router, Request, Response } from 'express'
import type { INotificationAdapter } from '../adapters/interfaces'
import { EVENT_TYPES } from '../websocket/types'

export function createNotifyRoutes(router: Router, adapter?: INotificationAdapter): void {
  if (!adapter) {
    console.warn('[Prizm] Notification adapter not provided, routes will return 503')
  }

  // POST /notify - 发送通知
  router.post('/notify', async (req: Request, res: Response) => {
    try {
      if (!adapter) {
        return res.status(503).json({ error: 'Notification adapter not available' })
      }

      const { title, body, targetClientId, targetScope } = req.body

      if (!title) {
        return res.status(400).json({ error: 'title is required' })
      }

      const scope = req.prizmScope ?? 'default'
      const wsServer = (req as any).prizmServer

      // 通过 WebSocket 广播通知
      if (wsServer) {
        if (targetClientId) {
          // 发送到指定客户端
          wsServer.broadcastToClient(targetClientId, EVENT_TYPES.NOTIFICATION, { title, body }, targetScope ?? scope)
          console.log(`[Prizm Notify] Sent notification to client ${targetClientId}`)
        } else {
          // 广播到所有订阅者
          const delivered = wsServer.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, targetScope ?? scope)
          console.log(`[Prizm Notify] Broadcasted notification to ${delivered} subscribers`)
        }
      } else {
        console.warn('[Prizm Notify] WebSocket server not available')
      }

      // 保持向后兼容，仍调用 adapter
      adapter.notify(title, body)

      res.json({
        success: true,
        delivered: !!wsServer,
        message: 'Notification sent via WebSocket if subscribers exist'
      })
    } catch (error) {
      console.error('[Prizm Notify] notify error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // GET /notify/subscribers - 获取订阅者列表
  router.get('/notify/subscribers', (req: Request, res: Response) => {
    try {
      const wsServer = (req as any).prizmServer

      if (!wsServer) {
        return res.status(503).json({ error: 'WebSocket server not available' })
      }

      const allClients = wsServer.getConnectedClients()
      const notificationSubscribers = allClients.filter((client: { clientId: string; registeredEvents: string[] }) =>
        client.registeredEvents.includes(EVENT_TYPES.NOTIFICATION)
      )

      res.json({
        totalSubscribers: notificationSubscribers.length,
        subscribers: notificationSubscribers.map((client: { clientId: string; currentScope: string }) => ({
          clientId: client.clientId,
          currentScope: client.currentScope
        }))
      })
    } catch (error) {
      console.error('[Prizm Notify] subscribers error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // POST /notify/broadcast - 手动触发广播（用于测试）
  router.post('/notify/broadcast', (req: Request, res: Response) => {
    try {
      const { title, body, targetScope } = req.body

      if (!title) {
        return res.status(400).json({ error: 'title is required' })
      }

      const scope = req.prizmScope ?? 'default'
      const wsServer = (req as any).prizmServer

      if (!wsServer) {
        return res.status(503).json({ error: 'WebSocket server not available' })
      }

      const delivered = wsServer.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, targetScope ?? scope)

      res.json({
        success: true,
        delivered,
        scope: targetScope ?? scope
      })
    } catch (error) {
      console.error('[Prizm Notify] broadcast error:', error)
      res.status(500).json({ error: String(error) })
    }
  })
}
