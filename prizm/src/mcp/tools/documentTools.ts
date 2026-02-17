/**
 * MCP Document / knowledge base tools (list, create, get, update, delete)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PrizmAdapters } from '../../adapters/interfaces'

export function registerDocumentTools(
  server: McpServer,
  adapters: PrizmAdapters,
  scope: string
): void {
  server.registerTool(
    'prizm_list_documents',
    {
      description: '列出 Prizm 知识库文档',
      inputSchema: z.object({
        q: z.string().optional().describe('关键词过滤标题或内容')
      })
    },
    async ({ q }) => {
      const docs = adapters.documents?.getAllDocuments
        ? await adapters.documents.getAllDocuments(scope)
        : []
      const filtered = q
        ? docs.filter(
            (d) =>
              (d.title || '').toLowerCase().includes(q.toLowerCase()) ||
              (d.content || '').toLowerCase().includes(q.toLowerCase())
          )
        : docs
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              filtered.map((d) => ({
                id: d.id,
                title: d.title,
                relativePath: d.relativePath,
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
      description: '在 Prizm 知识库中创建结构化文档（自动添加 frontmatter、标题管理）',
      inputSchema: z.object({
        title: z.string().describe('文档标题'),
        content: z.string().optional().describe('文档正文内容，支持 Markdown'),
        tags: z.array(z.string()).optional().describe('标签列表')
      })
    },
    async ({ title, content, tags }) => {
      if (!adapters.documents?.createDocument) {
        return {
          content: [{ type: 'text' as const, text: 'Documents adapter not available' }],
          isError: true
        }
      }
      const doc = await adapters.documents.createDocument(scope, { title, content, tags })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created document ${doc.id}: ${doc.title} (${doc.relativePath})`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_document',
    {
      description: '根据 ID 获取知识库文档详情',
      inputSchema: z.object({
        id: z.string().describe('文档 ID')
      })
    },
    async ({ id }) => {
      const doc = adapters.documents?.getDocumentById
        ? await adapters.documents.getDocumentById(scope, id)
        : null
      if (!doc) {
        return {
          content: [{ type: 'text' as const, text: `Document not found: ${id}` }],
          isError: true
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: doc.id,
                title: doc.title,
                relativePath: doc.relativePath,
                content: doc.content,
                tags: doc.tags,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_update_document',
    {
      description: '更新 Prizm 知识库文档',
      inputSchema: z.object({
        id: z.string().describe('文档 ID'),
        title: z.string().optional().describe('文档标题'),
        content: z.string().optional().describe('文档正文，支持 Markdown'),
        tags: z.array(z.string()).optional().describe('标签列表')
      })
    },
    async ({ id, title, content, tags }) => {
      if (!adapters.documents?.updateDocument) {
        return {
          content: [{ type: 'text' as const, text: 'Documents adapter not available' }],
          isError: true
        }
      }
      const payload: { title?: string; content?: string; tags?: string[] } = {}
      if (title !== undefined) payload.title = title
      if (content !== undefined) payload.content = content
      if (tags !== undefined) payload.tags = tags
      const doc = await adapters.documents.updateDocument(scope, id, payload)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated document ${doc.id}: ${doc.title}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_document',
    {
      description: '删除 Prizm 知识库文档',
      inputSchema: z.object({
        id: z.string().describe('文档 ID')
      })
    },
    async ({ id }) => {
      if (!adapters.documents?.deleteDocument) {
        return {
          content: [{ type: 'text' as const, text: 'Documents adapter not available' }],
          isError: true
        }
      }
      await adapters.documents.deleteDocument(scope, id)
      return {
        content: [{ type: 'text' as const, text: `Deleted document ${id}` }]
      }
    }
  )
}
