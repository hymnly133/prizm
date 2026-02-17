/**
 * MCP Notification tool (send notice to connected clients)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WebSocketServer } from '../../websocket/WebSocketServer'
import { EVENT_TYPES } from '../../websocket/types'

export function registerNotifyTools(
  server: McpServer,
  getWsServer?: () => WebSocketServer | undefined
): void {
  server.registerTool(
    'prizm_notice',
    {
      description: '主动发送通知到已连接的客户端（Electron 等），Agent 完成操作后可通知用户',
      inputSchema: z.object({
        title: z.string().describe('通知标题'),
        body: z.string().optional().describe('通知正文')
      })
    },
    async ({ title, body }) => {
      const ws = getWsServer?.()
      if (ws) {
        ws.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, undefined)
      }
      return {
        content: [{ type: 'text' as const, text: `Notification sent: ${title}` }]
      }
    }
  )
}
