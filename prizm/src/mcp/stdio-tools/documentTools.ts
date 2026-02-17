/**
 * MCP stdio tools: Prizm documents CRUD
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export function registerDocumentTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
  server.registerTool(
    'prizm_list_documents',
    {
      description: '列出 Prizm 文档（正式信息文档）',
      inputSchema: z.object({
        q: z.string().optional().describe('关键词过滤标题或内容')
      })
    },
    async ({ q }) => {
      const data = (await fetchPrizm('/documents')) as {
        documents: Array<{
          id: string
          title: string
          content?: string
          createdAt: number
        }>
      }
      const docs = q
        ? data.documents.filter(
            (d) =>
              (d.title || '').toLowerCase().includes(q.toLowerCase()) ||
              (d.content || '').toLowerCase().includes(q.toLowerCase())
          )
        : data.documents
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              docs.map((d) => ({
                id: d.id,
                title: d.title,
                content: (d.content ?? '').slice(0, 200),
                createdAt: d.createdAt
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
    'prizm_create_document',
    {
      description: '在 Prizm 中创建文档',
      inputSchema: z.object({
        title: z.string().describe('文档标题'),
        content: z.string().optional().describe('文档正文内容，支持 Markdown')
      })
    },
    async ({ title, content }) => {
      const data = (await fetchPrizm('/documents', {
        method: 'POST',
        body: JSON.stringify({ title, content })
      })) as { document: { id: string; title: string } }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created document ${data.document.id}: ${data.document.title}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_document',
    {
      description: '根据 ID 获取单条文档详情',
      inputSchema: z.object({ id: z.string().describe('文档 ID') })
    },
    async ({ id }) => {
      try {
        const data = (await fetchPrizm(`/documents/${id}`)) as {
          document: Record<string, unknown>
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(data.document, null, 2)
            }
          ]
        }
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Document not found: ${id}` }],
          isError: true
        }
      }
    }
  )

  server.registerTool(
    'prizm_update_document',
    {
      description: '更新 Prizm 文档',
      inputSchema: z.object({
        id: z.string().describe('文档 ID'),
        title: z.string().optional().describe('文档标题'),
        content: z.string().optional().describe('文档正文，支持 Markdown')
      })
    },
    async ({ id, title, content }) => {
      const payload: Record<string, unknown> = {}
      if (title !== undefined) payload.title = title
      if (content !== undefined) payload.content = content
      const data = (await fetchPrizm(`/documents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      })) as { document: { id: string; title: string } }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated document ${data.document.id}: ${data.document.title}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_document',
    {
      description: '删除 Prizm 文档',
      inputSchema: z.object({ id: z.string().describe('文档 ID') })
    },
    async ({ id }) => {
      await fetchPrizm(`/documents/${id}`, { method: 'DELETE' })
      return {
        content: [{ type: 'text' as const, text: `Deleted document ${id}` }]
      }
    }
  )
}
