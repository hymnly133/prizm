/**
 * MCP Todo list tools (list lists, get list, update list)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PrizmAdapters } from '../../adapters/interfaces'
import type { TodoItemStatus } from '../../types'
import { parseTodoItemsFromInput } from '../../utils/todoItems'

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

export function registerTodoTools(
  server: McpServer,
  adapters: PrizmAdapters,
  scope: string
): void {
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

  async function handlePrizmUpdateTodoList(args: {
    listId?: string
    title?: string
    items?: unknown[]
    updateItem?: { id: string; status?: TodoItemStatus; title?: string; description?: string }
    updateItems?: Array<{
      id: string
      status?: TodoItemStatus
      title?: string
      description?: string
    }>
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
}
