/**
 * TodoItem 解析工具 - 供 routes、MCP、stdio-bridge 复用
 */
import type { TodoItem, TodoItemStatus } from '../types'

const VALID_STATUS = ['todo', 'doing', 'done'] as const

export function parseTodoItemsFromInput(
  raw: unknown[]
): Array<Pick<TodoItem, 'id' | 'title' | 'description' | 'status'>> {
  return raw
    .filter((it): it is Record<string, unknown> => it != null && typeof it === 'object')
    .filter((it) => typeof (it as { title?: unknown }).title === 'string')
    .map((it) => {
      const r = it as { id?: string; title: string; description?: string; status?: string }
      return {
        id: typeof r.id === 'string' ? r.id : '',
        title: r.title,
        ...(typeof r.description === 'string' && { description: r.description }),
        status: (VALID_STATUS.includes(r.status as TodoItemStatus)
          ? r.status
          : 'todo') as TodoItemStatus
      }
    })
}
