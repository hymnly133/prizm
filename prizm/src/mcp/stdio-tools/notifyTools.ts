/**
 * MCP stdio tools: Prizm notification (send notice to connected clients)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export function registerNotifyTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
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
      await fetchPrizm('/notify', {
        method: 'POST',
        body: JSON.stringify({ title, body })
      })
      return {
        content: [{ type: 'text' as const, text: `Notification sent: ${title}` }]
      }
    }
  )
}
