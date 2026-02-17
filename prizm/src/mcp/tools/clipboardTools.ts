/**
 * MCP Clipboard tools (get history, add, get by id, delete)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PrizmAdapters } from '../../adapters/interfaces'

export function registerClipboardTools(
  server: McpServer,
  adapters: PrizmAdapters,
  scope: string
): void {
  server.registerTool(
    'prizm_get_clipboard',
    {
      description: '获取 Prizm 剪贴板历史',
      inputSchema: z.object({
        limit: z.number().optional().default(10)
      })
    },
    async ({ limit }) => {
      const items = adapters.clipboard?.getHistory
        ? await adapters.clipboard.getHistory(scope, { limit })
        : []
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              items.map((c) => ({
                id: c.id,
                type: c.type,
                content: c.content.slice(0, 200),
                createdAt: c.createdAt
              })),
              null,
              2
            )
          }
        ]
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
      if (!adapters.clipboard?.addItem) {
        return {
          content: [{ type: 'text' as const, text: 'Clipboard adapter not available' }],
          isError: true
        }
      }
      const item = await adapters.clipboard.addItem(scope, {
        type,
        content,
        createdAt: Date.now()
      })
      return {
        content: [{ type: 'text' as const, text: `Added clipboard item ${item.id}` }]
      }
    }
  )

  server.registerTool(
    'prizm_get_clipboard_item',
    {
      description: '根据 ID 获取单条剪贴板历史记录',
      inputSchema: z.object({
        id: z.string().describe('剪贴板记录 ID')
      })
    },
    async ({ id }) => {
      const items = adapters.clipboard?.getHistory
        ? await adapters.clipboard.getHistory(scope, { limit: 500 })
        : []
      const item = items.find((c) => c.id === id)
      if (!item) {
        return {
          content: [{ type: 'text' as const, text: `Clipboard item not found: ${id}` }],
          isError: true
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { id: item.id, type: item.type, content: item.content, createdAt: item.createdAt },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_clipboard_item',
    {
      description: '删除 Prizm 剪贴板历史中的一条记录',
      inputSchema: z.object({
        id: z.string().describe('剪贴板记录 ID')
      })
    },
    async ({ id }) => {
      if (!adapters.clipboard?.deleteItem) {
        return {
          content: [{ type: 'text' as const, text: 'Clipboard adapter not available' }],
          isError: true
        }
      }
      await adapters.clipboard.deleteItem(scope, id)
      return {
        content: [{ type: 'text' as const, text: `Deleted clipboard item ${id}` }]
      }
    }
  )
}
