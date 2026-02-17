/**
 * MCP stdio tools: Prizm TODO lists
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { parseTodoItemsFromInput } from '../../utils/todoItems'
import type { PrizmFetcher } from './fetcher.js'

export function registerTodoTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
  server.registerTool(
    'prizm_list_todo_lists',
    {
      description:
        '列出 Prizm 所有 TODO 列表。返回数组，每项含 id、title、items。用于选择 listId 或新建列表。',
      inputSchema: z.object({})
    },
    async () => {
      const data = (await fetchPrizm('/todo/lists')) as {
        todoLists: Array<{
          id: string
          title: string
          items: Array<{ id: string; status: string; title: string; description?: string }>
        }>
      }
      const lists = data.todoLists ?? []
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              lists.map((l) => ({
                id: l.id,
                title: l.title,
                items: (l.items ?? []).map((it) =>
                  it.description
                    ? { id: it.id, status: it.status, title: it.title, description: it.description }
                    : { id: it.id, status: it.status, title: it.title }
                )
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
            {
              type: 'text' as const,
              text: 'listId 必填，请先用 prizm_list_todo_lists 获取列表 id'
            }
          ],
          isError: true
        }
      }
      let list: {
        id: string
        title: string
        items: Array<{ id: string; status: string; title: string; description?: string }>
      } | null
      const data = (await fetchPrizm(`/todo/lists/${encodeURIComponent(listId)}`)) as {
        todoList: {
          id: string
          title: string
          items: Array<{ id: string; status: string; title: string; description?: string }>
        } | null
      }
      list = data.todoList
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

  server.registerTool(
    'prizm_update_todo_list',
    {
      description:
        '更新 Prizm TODO 列表。listId 必填（来自 prizm_list_todo_lists 或 prizm_list_todo_list）。推荐：仅改某条状态时用 updateItem；改多条用 updateItems；全量替换用 items。',
      inputSchema: z.object({
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
    async ({ listId, title, items, updateItem, updateItems }) => {
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
      let data: { todoList: { title: string; items: unknown[] } }
      if (items !== undefined) {
        data = (await fetchPrizm(`/todo/lists/${encodeURIComponent(listId)}/items`, {
          method: 'PUT',
          body: JSON.stringify({ items: parseTodoItemsFromInput(items) })
        })) as { todoList: { title: string; items: unknown[] } }
        if (title !== undefined) {
          data = (await fetchPrizm(`/todo/lists/${encodeURIComponent(listId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ title })
          })) as typeof data
        }
      } else {
        data = (await fetchPrizm(`/todo/lists/${encodeURIComponent(listId)}`)) as {
          todoList: { title: string; items: unknown[] }
        }
        if (title !== undefined) {
          data = (await fetchPrizm(`/todo/lists/${encodeURIComponent(listId)}`, {
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
}
