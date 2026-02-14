#!/usr/bin/env node
/**
 * Prizm MCP stdio 桥接
 * 供 Cursor 等通过 stdio 连接的客户端使用
 *
 * 用法: node dist/mcp/stdio-bridge.js
 * 或: PRIZM_URL=http://127.0.0.1:4127 PRIZM_API_KEY=xxx node dist/mcp/stdio-bridge.js
 *
 * Cursor 配置 (mcp.json):
 * {
 *   "mcpServers": {
 *     "prizm": {
 *       "command": "node",
 *       "args": ["/path/to/prizm/dist/mcp/stdio-bridge.js"],
 *       "env": {
 *         "PRIZM_URL": "http://127.0.0.1:4127",
 *         "PRIZM_API_KEY": "your-api-key",
 *         "PRIZM_SCOPE": "online"
 *       }
 *     }
 *   }
 * }
 *
 * 环境变量说明：
 * - PRIZM_URL: 服务端地址，默认 http://127.0.0.1:4127
 * - PRIZM_API_KEY: API Key，用于鉴权
 * - PRIZM_SCOPE: 操作 scope，默认 online。可选：default（默认工作区）、online（实时上下文）
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { parseTodoItemsFromInput } from '../utils/todoItems'

const PRIZM_URL = process.env.PRIZM_URL || 'http://127.0.0.1:4127'
const PRIZM_API_KEY = process.env.PRIZM_API_KEY || ''
const PRIZM_SCOPE = process.env.PRIZM_SCOPE || 'online'

async function fetchPrizm(path: string, options: RequestInit = {}): Promise<unknown> {
  const base = PRIZM_URL.replace(/\/+$/, '')
  let url = `${base}${path}`
  const method = (options.method ?? 'GET').toUpperCase()
  let body = options.body
  if (PRIZM_SCOPE) {
    if (method === 'GET' || method === 'DELETE') {
      url += (path.includes('?') ? '&' : '?') + `scope=${encodeURIComponent(PRIZM_SCOPE)}`
    } else if (body && typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        parsed.scope = PRIZM_SCOPE
        body = JSON.stringify(parsed)
      } catch {
        body = JSON.stringify({ scope: PRIZM_SCOPE })
      }
    } else {
      body = JSON.stringify({ scope: PRIZM_SCOPE })
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(PRIZM_API_KEY && { Authorization: `Bearer ${PRIZM_API_KEY}` }),
    ...((options.headers as Record<string, string>) || {})
  }
  const res = await fetch(url, { ...options, body, headers })
  if (!res.ok) {
    throw new Error(`Prizm API error: ${res.status} ${await res.text()}`)
  }
  if (res.status === 204) return undefined
  return res.json()
}

function createStdioServer(): McpServer {
  const server = new McpServer({ name: 'prizm', version: '0.1.0' }, { capabilities: {} })

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
      inputSchema: z.object({ content: z.string() })
    },
    async ({ content }) => {
      const data = (await fetchPrizm('/notes', {
        method: 'POST',
        body: JSON.stringify({ content })
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
      } catch (e) {
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
        groupId: z.string().optional().describe('分组 ID')
      })
    },
    async ({ id, content, groupId }) => {
      const payload: Record<string, unknown> = {}
      if (content !== undefined) payload.content = content
      if (groupId !== undefined) payload.groupId = groupId
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

  server.registerTool(
    'prizm_list_todo_list',
    {
      description:
        '列出 Prizm TODO 列表。返回 { title, items }，每个 item 含 id、status(todo|doing|done)、title、description(可选)。更新某条状态时需用此工具获取 item.id，再调用 prizm_update_todo_list 的 updateItem。',
      inputSchema: z.object({})
    },
    async () => {
      const data = (await fetchPrizm('/todo')) as {
        todoList: {
          title: string
          items: Array<{ id: string; status: string; title: string; description?: string }>
        } | null
      }
      const list = data.todoList
      if (!list) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ title: null, items: [] }, null, 2)
            }
          ]
        }
      }
      const output = {
        title: list.title,
        items: list.items.map((it) =>
          it.description
            ? { id: it.id, status: it.status, title: it.title, description: it.description }
            : { id: it.id, status: it.status, title: it.title }
        )
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_update_todo_list',
    {
      description:
        '更新 Prizm TODO 列表。推荐：仅改某条状态时用 updateItem(id 来自 prizm_list_todo_list)；改多条用 updateItems；全量替换用 items。title 可单独改列表标题。',
      inputSchema: z.object({
        title: z.string().optional().describe('列表标题'),
        items: z
          .array(
            z.object({
              id: z.string().optional().describe('可选，缺则自动生成'),
              title: z.string().describe('任务标题'),
              description: z.string().optional(),
              status: z
                .enum(['todo', 'doing', 'done'])
                .optional()
                .describe('todo=待办 doing=进行中 done=已完成')
            })
          )
          .optional()
          .describe('全量替换：传入则完整替换整个列表，慎用'),
        updateItem: z
          .object({
            id: z.string().describe('来自 prizm_list_todo_list 返回的 item.id'),
            status: z
              .enum(['todo', 'doing', 'done'])
              .optional()
              .describe('todo=待办 doing=进行中 done=已完成'),
            title: z.string().optional(),
            description: z.string().optional()
          })
          .optional()
          .describe('单条更新：仅改状态/标题时推荐用此，无需拉全量'),
        updateItems: z
          .array(
            z.object({
              id: z.string().describe('来自 prizm_list_todo_list 返回的 item.id'),
              status: z
                .enum(['todo', 'doing', 'done'])
                .optional()
                .describe('todo=待办 doing=进行中 done=已完成'),
              title: z.string().optional(),
              description: z.string().optional()
            })
          )
          .optional()
          .describe('批量更新：一次改多条 item 的状态或内容')
      })
    },
    async ({ title, items, updateItem, updateItems }) => {
      const hasPayload =
        title !== undefined ||
        items !== undefined ||
        updateItem !== undefined ||
        (updateItems !== undefined && updateItems.length > 0)
      if (!hasPayload) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'title, items, updateItem or updateItems required'
            }
          ],
          isError: true
        }
      }
      let data: { todoList: { title: string; items: unknown[] } }
      if (items !== undefined) {
        data = (await fetchPrizm('/todo/items', {
          method: 'PUT',
          body: JSON.stringify({ items: parseTodoItemsFromInput(items) })
        })) as { todoList: { title: string; items: unknown[] } }
        if (title !== undefined) {
          data = (await fetchPrizm('/todo', {
            method: 'PATCH',
            body: JSON.stringify({ title })
          })) as typeof data
        }
      } else {
        data = (await fetchPrizm('/todo', {
          method: 'POST',
          body: JSON.stringify({})
        })) as typeof data
        if (title !== undefined) {
          data = (await fetchPrizm('/todo', {
            method: 'PATCH',
            body: JSON.stringify({ title })
          })) as typeof data
        }
        if (updateItem !== undefined) {
          data = (await fetchPrizm(`/todo/items/${encodeURIComponent(updateItem.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: updateItem.status,
              title: updateItem.title,
              description: updateItem.description
            })
          })) as typeof data
        }
        if (updateItems !== undefined && updateItems.length > 0) {
          for (const u of updateItems) {
            data = (await fetchPrizm(`/todo/items/${encodeURIComponent(u.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                status: u.status,
                title: u.title,
                description: u.description
              })
            })) as typeof data
          }
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated todo list: ${data.todoList.title} (${data.todoList.items.length} items)`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_search',
    {
      description:
        '统一关键词搜索：在便签、文档、剪贴板、待办中按关键词匹配。输入关键词（支持空格/逗号分隔，自动分词），返回按相关性排序的结果。面向自然语言与大模型，高宽容度子串匹配。',
      inputSchema: z.object({
        keywords: z
          .union([z.string(), z.array(z.string())])
          .describe('关键词，支持字符串（自动分词）或关键词数组'),
        types: z
          .array(z.enum(['note', 'document', 'clipboard', 'todoList']))
          .optional()
          .describe('限定搜索类型，不传则搜索全部'),
        limit: z.number().optional().describe('最大返回数，默认 50'),
        mode: z
          .enum(['any', 'all'])
          .optional()
          .describe('any=任一关键词命中，all=需全部命中，默认 any')
      })
    },
    async ({ keywords, types, limit, mode }) => {
      const url = `${PRIZM_URL.replace(/\/+$/, '')}/search${
        PRIZM_SCOPE ? `?scope=${encodeURIComponent(PRIZM_SCOPE)}` : ''
      }`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(PRIZM_API_KEY && { Authorization: `Bearer ${PRIZM_API_KEY}` })
        },
        body: JSON.stringify({
          keywords,
          scope: PRIZM_SCOPE,
          types,
          limit: limit ?? 50,
          mode: mode ?? 'any'
        })
      })
      if (!res.ok) throw new Error(`Prizm search error: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as {
        results: Array<{
          kind: string
          id: string
          score: number
          matchedKeywords: string[]
          preview: string
          raw: unknown
        }>
      }
      const summary = data.results.map((r) => ({
        kind: r.kind,
        id: r.id,
        score: r.score,
        matched: r.matchedKeywords,
        preview: r.preview
      }))
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ total: data.results.length, results: summary }, null, 2)
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_search_notes',
    {
      description: '按关键词搜索 Prizm 便签内容（仅便签，建议优先使用 prizm_search 统一搜索）',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词')
      })
    },
    async ({ query }) => {
      const data = (await fetchPrizm(`/notes?q=${encodeURIComponent(query)}`)) as {
        notes: Array<{ id: string; content: string; createdAt: number }>
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.notes, null, 2)
          }
        ]
      }
    }
  )

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
      } catch (e) {
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

  return server
}

async function main(): Promise<void> {
  const server = createStdioServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio 模式下 stdout 用于 MCP 协议，日志必须输出到 stderr
  console.error('[Prizm MCP stdio] Running. Connect via stdio.')
}

main().catch((err) => {
  console.error('[Prizm MCP stdio] Fatal:', err)
  process.exit(1)
})
