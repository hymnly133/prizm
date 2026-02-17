/**
 * MCP stdio tools: Prizm clipboard history
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export function registerClipboardTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
  server.registerTool(
    'prizm_get_clipboard',
    {
      description: '获取 Prizm 剪贴板历史',
      inputSchema: z.object({ limit: z.number().optional().default(10) })
    },
    async ({ limit }) => {
      const data = (await fetchPrizm(`/clipboard/history?limit=${limit}`)) as {
        items: unknown[]
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.items, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_add_clipboard_item',
    {
      description: '向 Prizm 剪贴板历史新增一条记录',
      inputSchema: z.object({
        type: z.enum(['text', 'image']).optional().default('text'),
        content: z.string().describe('剪贴板内容')
      })
    },
    async ({ type, content }) => {
      const data = (await fetchPrizm('/clipboard', {
        method: 'POST',
        body: JSON.stringify({ type, content })
      })) as { item: { id: string } }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Added clipboard item ${data.item.id}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_clipboard_item',
    {
      description: '根据 ID 获取单条剪贴板历史记录',
      inputSchema: z.object({ id: z.string().describe('剪贴板记录 ID') })
    },
    async ({ id }) => {
      const data = (await fetchPrizm(`/clipboard/history?limit=500`)) as {
        items: Array<{
          id: string
          type: string
          content: string
          createdAt: number
        }>
      }
      const item = data.items.find((c) => c.id === id)
      if (!item) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Clipboard item not found: ${id}`
            }
          ],
          isError: true
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(item, null, 2)
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_clipboard_item',
    {
      description: '删除 Prizm 剪贴板历史中的一条记录',
      inputSchema: z.object({ id: z.string().describe('剪贴板记录 ID') })
    },
    async ({ id }) => {
      await fetchPrizm(`/clipboard/${id}`, { method: 'DELETE' })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Deleted clipboard item ${id}`
          }
        ]
      }
    }
  )
}
