/**
 * Prizm MCP (Model Context Protocol) 服务器
 * 暴露本机统一上下文（便签、任务、剪贴板、文档）给 Agent 使用
 *
 * 连接方式：
 * - Cursor: 通过 stdio-bridge（见 MCP-CONFIG.md）或 HTTP/SSE
 * - LobeChat / Claude Desktop: HTTP/SSE 直连 http://127.0.0.1:4127/mcp
 *
 * Scope：通过 URL 查询参数 ?scope=xxx 指定，未传则用 PRIZM_MCP_SCOPE 或 online
 */

import { randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { PrizmAdapters } from '../adapters/interfaces'
import type { WebSocketServer } from '../websocket/WebSocketServer'
import { EVENT_TYPES } from '../websocket/types'
import { ONLINE_SCOPE } from '../core/ScopeStore'
import { getConfig } from '../config'
import { parseTodoItemsFromInput } from '../utils/todoItems'
import { isMemoryEnabled, getAllMemories, searchMemoriesWithOptions } from '../llm/EverMemService'

function createMcpServerWithTools(
  adapters: PrizmAdapters,
  scope: string,
  getWsServer?: () => WebSocketServer | undefined
): McpServer {
  const server = new McpServer({ name: 'prizm', version: '0.1.0' }, { capabilities: {} })

  server.registerTool(
    'prizm_list_notes',
    {
      description: '列出 Prizm 便签',
      inputSchema: z.object({
        q: z.string().optional().describe('关键词过滤')
      })
    },
    async ({ q }) => {
      const notes = adapters.notes?.getAllNotes ? await adapters.notes.getAllNotes(scope) : []
      const filtered = q
        ? notes.filter((n) => n.content.toLowerCase().includes(q.toLowerCase()))
        : notes
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              filtered.map((n) => ({
                id: n.id,
                content: n.content.slice(0, 200),
                createdAt: n.createdAt
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
    'prizm_create_note',
    {
      description: '在 Prizm 中创建便签',
      inputSchema: z.object({
        content: z.string().describe('便签内容'),
        tags: z.array(z.string()).optional().describe('标签列表')
      })
    },
    async ({ content, tags }) => {
      if (!adapters.notes?.createNote) {
        return {
          content: [{ type: 'text' as const, text: 'Notes adapter not available' }],
          isError: true
        }
      }
      const note = await adapters.notes.createNote(scope, { content, tags })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created note ${note.id}: ${note.content.slice(0, 100)}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_note',
    {
      description: '根据 ID 获取单条便签详情',
      inputSchema: z.object({
        id: z.string().describe('便签 ID')
      })
    },
    async ({ id }) => {
      const note = adapters.notes?.getNoteById ? await adapters.notes.getNoteById(scope, id) : null
      if (!note) {
        return {
          content: [{ type: 'text' as const, text: `Note not found: ${id}` }],
          isError: true
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: note.id,
                content: note.content,
                imageUrls: note.imageUrls,
                tags: note.tags,
                createdAt: note.createdAt,
                updatedAt: note.updatedAt
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
      if (!adapters.notes?.updateNote) {
        return {
          content: [{ type: 'text' as const, text: 'Notes adapter not available' }],
          isError: true
        }
      }
      const payload: { content?: string; tags?: string[] } = {}
      if (content !== undefined) payload.content = content
      if (tags !== undefined) payload.tags = tags
      const note = await adapters.notes.updateNote(scope, id, payload)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated note ${note.id}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_delete_note',
    {
      description: '删除 Prizm 便签',
      inputSchema: z.object({
        id: z.string().describe('便签 ID')
      })
    },
    async ({ id }) => {
      if (!adapters.notes?.deleteNote) {
        return {
          content: [{ type: 'text' as const, text: 'Notes adapter not available' }],
          isError: true
        }
      }
      await adapters.notes.deleteNote(scope, id)
      return {
        content: [{ type: 'text' as const, text: `Deleted note ${id}` }]
      }
    }
  )

  server.registerTool(
    'prizm_search_notes',
    {
      description: '搜索 Prizm 便签内容',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词')
      })
    },
    async ({ query }) => {
      const notes = adapters.notes?.getAllNotes ? await adapters.notes.getAllNotes(scope) : []
      const kw = query.toLowerCase()
      const matched = notes.filter((n) => n.content.toLowerCase().includes(kw))
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              matched.map((n) => ({
                id: n.id,
                content: n.content,
                createdAt: n.createdAt
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
    'prizm_list_todo_lists',
    {
      description:
        '列出 Prizm 所有 TODO 列表。返回数组，每项含 id、title、items。用于选择 listId。',
      inputSchema: z.object({})
    },
    async () => {
      const lists = adapters.todoList?.getTodoLists
        ? await adapters.todoList.getTodoLists(scope)
        : []
      const output = lists.map((l) => ({
        id: l.id,
        title: l.title,
        items: (l.items ?? []).map((it) =>
          it.description
            ? { id: it.id, status: it.status, title: it.title, description: it.description }
            : { id: it.id, status: it.status, title: it.title }
        )
      }))
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_list_todo_list',
    {
      description:
        '获取指定 TODO 列表详情。listId 必填，来自 prizm_list_todo_lists。返回 { id, title, items }。',
      inputSchema: z.object({
        listId: z.string().describe('列表 id，必填。先用 prizm_list_todo_lists 获取')
      })
    },
    async ({ listId }) => {
      if (!listId || !listId.trim()) {
        return {
          content: [
            { type: 'text' as const, text: 'listId 必填，请先用 prizm_list_todo_lists 获取列表 id' }
          ],
          isError: true
        }
      }
      const list = adapters.todoList?.getTodoList
        ? await adapters.todoList.getTodoList(scope, listId)
        : null
      if (!list) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ id: null, title: null, items: [] }, null, 2)
            }
          ]
        }
      }
      const output = {
        id: list.id,
        title: list.title,
        items: (list.items ?? []).map((it) =>
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

  const prizmUpdateTodoListSchema = z.object({
    listId: z.string().describe('目标列表 id，必填。先用 prizm_list_todo_lists 获取'),
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
      .describe('全量替换（与 updateItem/updateItems 互斥）'),
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
      .describe('单条更新'),
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
      .describe('批量更新')
  })

  async function handlePrizmUpdateTodoList(args: {
    listId?: string
    title?: string
    items?: unknown[]
    updateItem?: { id: string; status?: string; title?: string; description?: string }
    updateItems?: Array<{ id: string; status?: string; title?: string; description?: string }>
  }) {
    const { listId, title, items, updateItem, updateItems } = args
    const adapter = adapters.todoList
    if (
      !adapter?.getTodoLists ||
      !adapter?.getTodoList ||
      !adapter?.createTodoList ||
      !adapter?.updateTodoListTitle ||
      !adapter?.replaceTodoItems ||
      !adapter?.updateTodoItem
    ) {
      return {
        content: [{ type: 'text' as const, text: 'TodoList adapter not available' }],
        isError: true
      }
    }
    const hasPayload =
      title !== undefined ||
      items !== undefined ||
      updateItem !== undefined ||
      (updateItems !== undefined && updateItems.length > 0)
    if (!hasPayload) {
      return {
        content: [
          { type: 'text' as const, text: 'title, items, updateItem or updateItems required' }
        ],
        isError: true
      }
    }
    if (!listId || !listId.trim()) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'listId 必填，请先用 prizm_list_todo_lists 获取列表 id'
          }
        ],
        isError: true
      }
    }
    let todoList = await adapter.getTodoList(scope, listId)
    if (!todoList) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `TodoList not found: ${listId}，请用 prizm_list_todo_lists 确认列表 id`
          }
        ],
        isError: true
      }
    }
    if (title !== undefined) todoList = await adapter.updateTodoListTitle(scope, listId, title)
    if (items !== undefined) {
      todoList = await adapter.replaceTodoItems(scope, listId, parseTodoItemsFromInput(items))
    } else {
      if (updateItem !== undefined) {
        const updated = await adapter.updateTodoItem(scope, updateItem.id, {
          status: updateItem.status,
          title: updateItem.title,
          description: updateItem.description
        })
        if (updated) todoList = updated
      }
      if (updateItems !== undefined && updateItems.length > 0) {
        for (const u of updateItems) {
          const updated = await adapter.updateTodoItem(scope, u.id, {
            status: u.status,
            title: u.title,
            description: u.description
          })
          if (updated) todoList = updated
        }
      }
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Updated todo list: ${todoList.title} (${todoList.items.length} items)`
        }
      ]
    }
  }

  server.registerTool(
    'prizm_update_todo_list',
    {
      description:
        '更新 Todo 列表。listId 必填。title 改标题；updateItem/updateItems 改单条/批量；items 全量替换。',
      inputSchema: prizmUpdateTodoListSchema
    },
    handlePrizmUpdateTodoList
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
      if (!adapters.documents?.createDocument) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Documents adapter not available'
            }
          ],
          isError: true
        }
      }
      const doc = await adapters.documents.createDocument(scope, {
        title,
        content
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created document ${doc.id}: ${doc.title}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_get_document',
    {
      description: '根据 ID 获取单条文档详情',
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
                content: doc.content,
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
      description: '更新 Prizm 文档',
      inputSchema: z.object({
        id: z.string().describe('文档 ID'),
        title: z.string().optional().describe('文档标题'),
        content: z.string().optional().describe('文档正文，支持 Markdown')
      })
    },
    async ({ id, title, content }) => {
      if (!adapters.documents?.updateDocument) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Documents adapter not available'
            }
          ],
          isError: true
        }
      }
      const payload: { title?: string; content?: string } = {}
      if (title !== undefined) payload.title = title
      if (content !== undefined) payload.content = content
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
      description: '删除 Prizm 文档',
      inputSchema: z.object({
        id: z.string().describe('文档 ID')
      })
    },
    async ({ id }) => {
      if (!adapters.documents?.deleteDocument) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Documents adapter not available'
            }
          ],
          isError: true
        }
      }
      await adapters.documents.deleteDocument(scope, id)
      return {
        content: [{ type: 'text' as const, text: `Deleted document ${id}` }]
      }
    }
  )

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
          content: [
            {
              type: 'text' as const,
              text: 'Clipboard adapter not available'
            }
          ],
          isError: true
        }
      }
      const item = await adapters.clipboard.addItem(scope, {
        type,
        content,
        createdAt: Date.now()
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Added clipboard item ${item.id}`
          }
        ]
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
            text: JSON.stringify(
              {
                id: item.id,
                type: item.type,
                content: item.content,
                createdAt: item.createdAt
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
          content: [
            {
              type: 'text' as const,
              text: 'Clipboard adapter not available'
            }
          ],
          isError: true
        }
      }
      await adapters.clipboard.deleteItem(scope, id)
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
      const ws = getWsServer?.()
      if (ws) {
        ws.broadcast(EVENT_TYPES.NOTIFICATION, { title, body }, undefined)
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Notification sent: ${title}`
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_list_memories',
    {
      description: '列出当前 scope 下与对话相关的长期记忆条目',
      inputSchema: z.object({})
    },
    async () => {
      if (!isMemoryEnabled()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ enabled: false, memories: [] }, null, 2)
            }
          ],
          isError: false
        }
      }
      const memories = await getAllMemories('default', scope)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: true,
                memories: memories.map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  created_at: m.created_at,
                  updated_at: m.updated_at
                }))
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
    'prizm_search_memories',
    {
      description: '按语义/关键词搜索用户记忆，用于回忆过往对话或偏好',
      inputSchema: z.object({
        query: z.string().describe('搜索问题或关键词')
      })
    },
    async ({ query }) => {
      if (!isMemoryEnabled()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ enabled: false, memories: [] }, null, 2)
            }
          ],
          isError: false
        }
      }
      const q = (query ?? '').trim()
      if (!q) {
        return {
          content: [{ type: 'text' as const, text: 'query is required' }],
          isError: true
        }
      }
      const memories = await searchMemoriesWithOptions(q, 'default', scope)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: true,
                memories: memories.map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  created_at: m.created_at,
                  ...(typeof (m as { score?: number }).score === 'number'
                    ? { score: (m as { score?: number }).score }
                    : {})
                }))
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  return server
}

const transports = new Map<string, StreamableHTTPServerTransport>()

/**
 * 挂载 MCP 路由到 Express 应用
 * 路径: POST /mcp, GET /mcp (SSE)
 * 鉴权：沿用全局 auth 中间件，客户端需传 Authorization: Bearer <api_key>
 */
export function mountMcpRoutes(
  app: Express,
  adapters: PrizmAdapters,
  getWsServer?: () => WebSocketServer | undefined
): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res, req.body)
      return
    }

    if (!sessionId && req.body && isInitializeRequest(req.body)) {
      const transportRef: { t?: StreamableHTTPServerTransport } = {}
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string): void => {
          if (transportRef.t) transports.set(sid, transportRef.t)
        }
      })
      transportRef.t = transport

      const scope =
        (typeof req.query.scope === 'string' ? req.query.scope.trim() : null) ||
        getConfig().mcpScope ||
        ONLINE_SCOPE
      const mcpServer = createMcpServerWithTools(adapters, scope, getWsServer)
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, req.body)
      return
    }

    res.status(400).json({ error: 'Invalid MCP request' })
  }

  app.post('/mcp', (req: Request, res: Response) => void handler(req, res))
  // GET 用于 SSE 被动流：客户端需带 Mcp-Session-Id（初始化后由 POST 响应返回）
  app.get('/mcp', (req: Request, res: Response) => void handler(req, res))
}
