/**
 * Agent 内置工具：便签/待办/文档 CRUD、搜索、统计
 * 工具定义与执行统一在此模块，供 DefaultAgentAdapter.chat 使用
 */

import type { LLMTool } from '../adapters/interfaces'
import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'
import type { TodoItemStatus, TodoList } from '../types'
import { scheduleDocumentSummary } from './documentSummaryService'
import { listRefItems, getScopeRefItem, getScopeStats, searchScopeItems } from './scopeItemRegistry'
import { recordActivity } from './contextTracker'
import type { ScopeActivityItemKind, ScopeActivityAction } from '@prizm/shared'

function tool(
  name: string,
  description: string,
  parameters: {
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
): LLMTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: parameters.properties,
        required: parameters.required ?? []
      }
    }
  }
}

/**
 * 返回所有内置工具定义（不含 Tavily，Tavily 由 adapter 按配置追加）
 */
export function getBuiltinTools(): LLMTool[] {
  return [
    tool('prizm_list_notes', '列出当前工作区的便签，含分组与字数。', {
      properties: {},
      required: []
    }),
    tool('prizm_read_note', '根据便签 ID 读取便签全文。', {
      properties: { noteId: { type: 'string', description: '便签 ID' } },
      required: ['noteId']
    }),
    tool('prizm_create_note', '创建一条便签。', {
      properties: {
        content: { type: 'string', description: '便签内容' },
        groupId: { type: 'string', description: '可选分组 ID' }
      },
      required: ['content']
    }),
    tool('prizm_update_note', '更新便签内容或分组。', {
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
        content: { type: 'string', description: '新内容' },
        groupId: { type: 'string', description: '新分组 ID' }
      },
      required: ['noteId']
    }),
    tool('prizm_delete_note', '删除指定便签。', {
      properties: { noteId: { type: 'string', description: '便签 ID' } },
      required: ['noteId']
    }),
    tool('prizm_list_todos', '列出当前工作区的待办项，含状态与标题。多列表时按 list 分组展示。', {
      properties: {},
      required: []
    }),
    tool(
      'prizm_list_todo_lists',
      '列出所有 TODO 列表的 id 与标题，供 prizm_create_todo 选择 listId 或决定用 listTitle 新建。',
      {
        properties: {},
        required: []
      }
    ),
    tool('prizm_read_todo', '根据待办项 ID 读取详情。', {
      properties: { todoId: { type: 'string', description: '待办项 ID' } },
      required: ['todoId']
    }),
    tool(
      'prizm_create_todo',
      '创建一条待办项。必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加），二者必填其一。',
      {
        properties: {
          title: { type: 'string', description: '标题' },
          description: { type: 'string', description: '可选描述' },
          listId: {
            type: 'string',
            description: '目标列表 id，追加到该列表（与 listTitle 二选一）'
          },
          listTitle: {
            type: 'string',
            description: '新建列表并添加，listTitle 作为新列表标题（与 listId 二选一）'
          },
          status: {
            type: 'string',
            description: 'todo | doing | done',
            enum: ['todo', 'doing', 'done']
          }
        },
        required: ['title']
      }
    ),
    tool('prizm_update_todo', '更新待办项状态、标题或描述。', {
      properties: {
        todoId: { type: 'string', description: '待办项 ID' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['todoId']
    }),
    tool('prizm_delete_todo', '删除指定待办项。', {
      properties: { todoId: { type: 'string', description: '待办项 ID' } },
      required: ['todoId']
    }),
    tool('prizm_list_documents', '列出当前工作区的文档。', { properties: {}, required: [] }),
    tool('prizm_get_document_content', '根据文档 ID 获取完整正文。需要查看文档详细内容时调用。', {
      properties: { documentId: { type: 'string', description: '文档 ID' } },
      required: ['documentId']
    }),
    tool('prizm_create_document', '创建一篇文档。', {
      properties: {
        title: { type: 'string', description: '标题' },
        content: { type: 'string', description: '正文' }
      },
      required: ['title']
    }),
    tool('prizm_update_document', '更新文档标题或正文。', {
      properties: {
        documentId: { type: 'string', description: '文档 ID' },
        title: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['documentId']
    }),
    tool('prizm_delete_document', '删除指定文档。', {
      properties: { documentId: { type: 'string', description: '文档 ID' } },
      required: ['documentId']
    }),
    tool('prizm_search', '在工作区便签、待办、文档中全文搜索。', {
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query']
    }),
    tool('prizm_scope_stats', '获取当前工作区数据统计（条数、字数等）。', {
      properties: {},
      required: []
    })
  ]
}

export interface BuiltinToolResult {
  text: string
  isError?: boolean
}

/**
 * 执行内置工具；sessionId 可选，用于记录修改到 ContextTracker
 */
export async function executeBuiltinTool(
  scope: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<BuiltinToolResult> {
  const data = scopeStore.getScopeData(scope)

  const record = (itemId: string, itemKind: ScopeActivityItemKind, action: ScopeActivityAction) => {
    if (sessionId)
      recordActivity(scope, sessionId, {
        toolName,
        action,
        itemKind,
        itemId,
        timestamp: Date.now()
      })
  }

  try {
    switch (toolName) {
      case 'prizm_list_notes': {
        const items = listRefItems(scope, 'note')
        if (!items.length) return { text: '当前无便签。' }
        const lines = items.map((r) => {
          const g = r.groupOrStatus ? ` [${r.groupOrStatus}]` : ''
          return `- ${r.id}: ${r.title}${g} (${r.charCount} 字)`
        })
        return { text: lines.join('\n') }
      }

      case 'prizm_read_note': {
        const noteId = typeof args.noteId === 'string' ? args.noteId : ''
        const detail = getScopeRefItem(scope, 'note', noteId)
        if (!detail) return { text: `便签不存在: ${noteId}`, isError: true }
        return { text: detail.content || '(空)' }
      }

      case 'prizm_create_note': {
        const content = typeof args.content === 'string' ? args.content : ''
        const groupId = typeof args.groupId === 'string' ? args.groupId : undefined
        const now = Date.now()
        const note = {
          id: genUniqueId(),
          content,
          createdAt: now,
          updatedAt: now,
          groupId
        }
        data.notes.push(note)
        scopeStore.saveScope(scope)
        record(note.id, 'note', 'create')
        return { text: `已创建便签 ${note.id}` }
      }

      case 'prizm_update_note': {
        const noteId = typeof args.noteId === 'string' ? args.noteId : ''
        const idx = data.notes.findIndex((n) => n.id === noteId)
        if (idx < 0) return { text: `便签不存在: ${noteId}`, isError: true }
        if (typeof args.content === 'string') data.notes[idx].content = args.content
        if (args.groupId !== undefined)
          data.notes[idx].groupId = typeof args.groupId === 'string' ? args.groupId : undefined
        data.notes[idx].updatedAt = Date.now()
        scopeStore.saveScope(scope)
        record(noteId, 'note', 'update')
        return { text: `已更新便签 ${noteId}` }
      }

      case 'prizm_delete_note': {
        const noteId = typeof args.noteId === 'string' ? args.noteId : ''
        const i = data.notes.findIndex((n) => n.id === noteId)
        if (i < 0) return { text: `便签不存在: ${noteId}`, isError: true }
        data.notes.splice(i, 1)
        scopeStore.saveScope(scope)
        record(noteId, 'note', 'delete')
        return { text: `已删除便签 ${noteId}` }
      }

      case 'prizm_list_todos': {
        const lists = data.todoLists ?? []
        if (!lists.length) return { text: '当前无待办列表。' }
        const lines: string[] = []
        for (const list of lists) {
          if (list.items?.length) {
            lines.push(`[${list.title}] (listId: ${list.id})`)
            for (const it of list.items) {
              lines.push(`  - ${it.id}: [${it.status}] ${it.title}`)
            }
          } else {
            lines.push(`[${list.title}] (listId: ${list.id}) 空`)
          }
        }
        return { text: lines.length ? lines.join('\n') : '当前无待办项。' }
      }

      case 'prizm_list_todo_lists': {
        const lists = data.todoLists ?? []
        if (!lists.length) return { text: '当前无待办列表。' }
        const lines = lists.map((l) => `- ${l.id}: ${l.title} (${l.items?.length ?? 0} 项)`)
        return { text: lines.join('\n') }
      }

      case 'prizm_read_todo': {
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const detail = getScopeRefItem(scope, 'todo', todoId)
        if (!detail) return { text: `待办项不存在: ${todoId}`, isError: true }
        return { text: detail.content || '(空)' }
      }

      case 'prizm_create_todo': {
        if (!data.todoLists) data.todoLists = []
        const listTitle = typeof args.listTitle === 'string' ? args.listTitle.trim() : undefined
        const listId = typeof args.listId === 'string' ? args.listId : undefined
        if (!listId && !listTitle) {
          return {
            text: '必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）',
            isError: true
          }
        }
        let list: TodoList
        if (listTitle) {
          const now = Date.now()
          list = {
            id: genUniqueId(),
            title: listTitle,
            items: [],
            createdAt: now,
            updatedAt: now
          }
          data.todoLists.push(list)
        } else {
          const found = data.todoLists.find((l) => l.id === listId)
          if (!found) return { text: `待办列表不存在: ${listId}`, isError: true }
          list = found
        }
        const title = typeof args.title === 'string' ? args.title : '(无标题)'
        const description = typeof args.description === 'string' ? args.description : undefined
        const status = (
          args.status === 'doing' || args.status === 'done' ? args.status : 'todo'
        ) as TodoItemStatus
        const now = Date.now()
        const item = {
          id: genUniqueId(),
          title,
          description,
          status,
          createdAt: now,
          updatedAt: now
        }
        list.items.push(item)
        list.updatedAt = now
        scopeStore.saveScope(scope)
        record(item.id, 'todo', 'create')
        return {
          text: `已创建待办项 ${item.id}` + (listTitle ? `（新建列表「${listTitle}」）` : '')
        }
      }

      case 'prizm_update_todo': {
        const lists = data.todoLists ?? []
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const list = lists.find((l) => l.items.some((it) => it.id === todoId))
        if (!list) return { text: `待办项不存在: ${todoId}`, isError: true }
        const idx = list.items.findIndex((it) => it.id === todoId)
        if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
        const cur = list.items[idx]
        if (args.status === 'todo' || args.status === 'doing' || args.status === 'done')
          cur.status = args.status
        if (typeof args.title === 'string') cur.title = args.title
        if (args.description !== undefined)
          (cur as { description?: string }).description =
            typeof args.description === 'string' ? args.description : undefined
        cur.updatedAt = Date.now()
        list.updatedAt = Date.now()
        scopeStore.saveScope(scope)
        record(todoId, 'todo', 'update')
        return { text: `已更新待办项 ${todoId}` }
      }

      case 'prizm_delete_todo': {
        const lists = data.todoLists ?? []
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const list = lists.find((l) => l.items.some((it) => it.id === todoId))
        if (!list) return { text: `待办项不存在: ${todoId}`, isError: true }
        const idx = list.items.findIndex((it) => it.id === todoId)
        if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
        list.items.splice(idx, 1)
        list.updatedAt = Date.now()
        scopeStore.saveScope(scope)
        record(todoId, 'todo', 'delete')
        return { text: `已删除待办项 ${todoId}` }
      }

      case 'prizm_list_documents': {
        const items = listRefItems(scope, 'document')
        if (!items.length) return { text: '当前无文档。' }
        const lines = items.map((r) => `- ${r.id}: ${r.title} (${r.charCount} 字)`)
        return { text: lines.join('\n') }
      }

      case 'prizm_get_document_content': {
        const documentId = typeof args.documentId === 'string' ? args.documentId : ''
        const detail = getScopeRefItem(scope, 'document', documentId)
        if (!detail) return { text: `文档不存在: ${documentId}`, isError: true }
        return { text: detail.content || '(无正文)' }
      }

      case 'prizm_create_document': {
        const title = typeof args.title === 'string' ? args.title : '未命名文档'
        const content = typeof args.content === 'string' ? args.content : ''
        const now = Date.now()
        const doc = {
          id: genUniqueId(),
          title,
          content,
          createdAt: now,
          updatedAt: now
        }
        data.documents.push(doc)
        scopeStore.saveScope(scope)
        scheduleDocumentSummary(scope, doc.id)
        record(doc.id, 'document', 'create')
        return { text: `已创建文档 ${doc.id}` }
      }

      case 'prizm_update_document': {
        const documentId = typeof args.documentId === 'string' ? args.documentId : ''
        const idx = data.documents.findIndex((d) => d.id === documentId)
        if (idx < 0) return { text: `文档不存在: ${documentId}`, isError: true }
        if (typeof args.title === 'string') data.documents[idx].title = args.title
        if (typeof args.content === 'string') data.documents[idx].content = args.content
        data.documents[idx].updatedAt = Date.now()
        scopeStore.saveScope(scope)
        scheduleDocumentSummary(scope, documentId)
        record(documentId, 'document', 'update')
        return { text: `已更新文档 ${documentId}` }
      }

      case 'prizm_delete_document': {
        const documentId = typeof args.documentId === 'string' ? args.documentId : ''
        const idx = data.documents.findIndex((d) => d.id === documentId)
        if (idx < 0) return { text: `文档不存在: ${documentId}`, isError: true }
        data.documents.splice(idx, 1)
        scopeStore.saveScope(scope)
        record(documentId, 'document', 'delete')
        return { text: `已删除文档 ${documentId}` }
      }

      case 'prizm_search': {
        const query = typeof args.query === 'string' ? args.query : ''
        const items = searchScopeItems(scope, query)
        if (!items.length) return { text: '未找到匹配项。' }
        const lines = items.map((r) => `- [${r.kind}] ${r.id}: ${r.title}`)
        return { text: lines.join('\n') }
      }

      case 'prizm_scope_stats': {
        const stats = getScopeStats(scope)
        const t = stats.byKind
        const text = `便签 ${t.notes.count} 条 / ${t.notes.chars} 字；待办 ${t.todoList.count} 项 / ${t.todoList.chars} 字；文档 ${t.document.count} 篇 / ${t.document.chars} 字；会话 ${t.sessions.count} 个。总计 ${stats.totalItems} 项，${stats.totalChars} 字。`
        return { text }
      }

      default:
        return { text: `未知内置工具: ${toolName}`, isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `Error: ${msg}`, isError: true }
  }
}

/** 内置工具名称集合，用于判断是否为内置工具 */
export const BUILTIN_TOOL_NAMES = new Set([
  'prizm_list_notes',
  'prizm_read_note',
  'prizm_create_note',
  'prizm_update_note',
  'prizm_delete_note',
  'prizm_list_todos',
  'prizm_list_todo_lists',
  'prizm_read_todo',
  'prizm_create_todo',
  'prizm_update_todo',
  'prizm_delete_todo',
  'prizm_list_documents',
  'prizm_get_document_content',
  'prizm_create_document',
  'prizm_update_document',
  'prizm_delete_document',
  'prizm_search',
  'prizm_scope_stats'
])
