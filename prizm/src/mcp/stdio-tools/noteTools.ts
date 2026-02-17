/**
 * MCP stdio tools: Prizm notes (sticky notes) CRUD
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export function registerNoteTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
  server.registerTool(
    'prizm_list_notes',
    {
      description: '列出 Prizm 便签',
      inputSchema: z.object({ q: z.string().optional() })
    },
    async ({ q }) => {
      const data = (await fetchPrizm(`/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`)) as {
        notes: Array<{ id: string; content: string; createdAt: number }>
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.notes, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_create_note',
    {
      description: '在 Prizm 中创建便签',
      inputSchema: z.object({
        content: z.string(),
        tags: z.array(z.string()).optional().describe('标签列表')
      })
    },
    async ({ content, tags }) => {
      const payload: Record<string, unknown> = { content }
      if (tags?.length) payload.tags = tags
      const data = (await fetchPrizm('/notes', {
        method: 'POST',
        body: JSON.stringify(payload)
      })) as { note: { id: string } }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created note ${data.note.id}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_note',
    {
      description: '根据 ID 获取单条便签详情',
      inputSchema: z.object({ id: z.string().describe('便签 ID') })
    },
    async ({ id }) => {
      try {
        const data = (await fetchPrizm(`/notes/${id}`)) as {
          note: Record<string, unknown>
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(data.note, null, 2)
            }
          ]
        }
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Note not found: ${id}` }],
          isError: true
        }
      }
    }
  )

  server.registerTool(
    'prizm_update_note',
    {
      description: '更新 Prizm 便签内容',
      inputSchema: z.object({
        id: z.string().describe('便签 ID'),
        content: z.string().optional().describe('便签内容'),
        tags: z.array(z.string()).optional().describe('标签列表')
      })
    },
    async ({ id, content, tags }) => {
      const payload: Record<string, unknown> = {}
      if (content !== undefined) payload.content = content
      if (tags !== undefined) payload.tags = tags
      const data = (await fetchPrizm(`/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      })) as { note: { id: string } }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated note ${data.note.id}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_note',
    {
      description: '删除 Prizm 便签',
      inputSchema: z.object({ id: z.string().describe('便签 ID') })
    },
    async ({ id }) => {
      await fetchPrizm(`/notes/${id}`, { method: 'DELETE' })
      return {
        content: [{ type: 'text' as const, text: `Deleted note ${id}` }]
      }
    }
  )
}
