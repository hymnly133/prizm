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
import { MEMORY_USER_ID } from '@prizm/shared'
import { isMemoryEnabled, getAllMemories, searchMemoriesWithOptions } from './EverMemService'

/** 工具参数属性定义（支持 array 类型的 items） */
interface ToolPropertyDef {
  type: string
  description?: string
  enum?: string[]
  items?: { type: string }
}

function tool(
  name: string,
  description: string,
  parameters: {
    properties: Record<string, ToolPropertyDef>
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
    tool(
      'prizm_list_notes',
      '列出当前工作区所有便签的概要（ID、内容摘要、标签、字数）。' +
        '当需要浏览便签全貌或查找特定便签的 ID 时使用。' +
        '如果只需查找特定内容，优先使用 prizm_search。',
      { properties: {}, required: [] }
    ),
    tool('prizm_read_note', '根据便签 ID 读取便签全文。当需要查看某条便签的完整内容时使用。', {
      properties: { noteId: { type: 'string', description: '便签 ID' } },
      required: ['noteId']
    }),
    tool(
      'prizm_create_note',
      '创建一条新便签。创建前应确认用户意图，并检查是否已有相关便签可更新。同一话题不要拆成多条。返回新建便签的 ID。',
      {
        properties: {
          content: { type: 'string', description: '便签内容（纯文本）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '可选标签列表，用于分类'
          }
        },
        required: ['content']
      }
    ),
    tool(
      'prizm_update_note',
      '更新已有便签的内容或标签。修改前建议先 prizm_read_note 确认当前内容。仅传入需要修改的字段。',
      {
        properties: {
          noteId: { type: 'string', description: '目标便签 ID' },
          content: { type: 'string', description: '新内容（不传则不修改）' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '新标签列表（不传则不修改）'
          }
        },
        required: ['noteId']
      }
    ),
    tool('prizm_delete_note', '删除指定便签。删除前需二次确认用户意图。', {
      properties: { noteId: { type: 'string', description: '便签 ID' } },
      required: ['noteId']
    }),
    tool(
      'prizm_list_todos',
      '列出当前工作区的所有待办项，含状态与标题，按列表分组。' +
        '当需要查看待办全貌时使用。查找特定内容优先用 prizm_search。',
      { properties: {}, required: [] }
    ),
    tool(
      'prizm_list_todo_lists',
      '列出所有待办列表的 id 与标题。' +
        '在创建待办项前调用，以决定用已有 listId 还是用 listTitle 新建列表。',
      { properties: {}, required: [] }
    ),
    tool('prizm_read_todo', '根据待办项 ID 读取详情（标题、描述、状态等）。', {
      properties: { todoId: { type: 'string', description: '待办项 ID' } },
      required: ['todoId']
    }),
    tool(
      'prizm_create_todo',
      '创建一条待办项。必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加），二者必填其一。' +
        '不确定有哪些列表时，先调用 prizm_list_todo_lists 查看。',
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
    tool('prizm_update_todo', '更新待办项状态、标题或描述。仅传入需要修改的字段。', {
      properties: {
        todoId: { type: 'string', description: '待办项 ID' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['todoId']
    }),
    tool('prizm_delete_todo', '删除指定待办项。删除前需二次确认用户意图。', {
      properties: { todoId: { type: 'string', description: '待办项 ID' } },
      required: ['todoId']
    }),
    tool(
      'prizm_list_documents',
      '列出当前工作区的所有文档（ID、标题、字数）。' +
        '当需要浏览文档全貌或查找文档 ID 时使用。查找特定内容优先用 prizm_search。',
      { properties: {}, required: [] }
    ),
    tool('prizm_get_document_content', '根据文档 ID 获取完整正文。当需要查看文档详细内容时调用。', {
      properties: { documentId: { type: 'string', description: '文档 ID' } },
      required: ['documentId']
    }),
    tool(
      'prizm_create_document',
      '创建一篇文档。创建前应检查是否已有相关文档可更新。同一话题只建一篇，不要拆分。内容应精炼有价值，避免冗余重复。返回新建文档的 ID。',
      {
        properties: {
          title: { type: 'string', description: '标题' },
          content: { type: 'string', description: '正文' }
        },
        required: ['title']
      }
    ),
    tool(
      'prizm_update_document',
      '更新文档标题或正文。修改前建议先 prizm_get_document_content 确认当前内容。仅传入需要修改的字段。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' },
          title: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['documentId']
      }
    ),
    tool('prizm_delete_document', '删除指定文档。删除前需二次确认用户意图。', {
      properties: { documentId: { type: 'string', description: '文档 ID' } },
      required: ['documentId']
    }),
    tool(
      'prizm_search',
      '在工作区便签、待办、文档中全文搜索关键词。' +
        '当用户询问特定内容但不确定在哪个类型中时使用。' +
        '返回匹配条目列表（类型+ID+标题）。优先用于精确/关键词查询。' +
        '语义模糊查询请改用 prizm_search_memories。',
      {
        properties: { query: { type: 'string', description: '搜索关键词或短语' } },
        required: ['query']
      }
    ),
    tool(
      'prizm_scope_stats',
      '获取当前工作区数据统计（各类型条数、字数）。快速了解工作区数据全貌时使用。',
      { properties: {}, required: [] }
    ),
    tool(
      'prizm_list_memories',
      '列出当前用户的所有长期记忆条目。当需要浏览记忆全貌时使用。查找特定记忆优先用 prizm_search_memories。',
      { properties: {}, required: [] }
    ),
    tool(
      'prizm_search_memories',
      '按语义搜索用户长期记忆（过往对话、偏好、习惯）。' +
        '当用户问"我之前说过什么"、"上次聊了什么"、"我的偏好是什么"时使用。' +
        '与 prizm_search 不同：这是向量语义搜索，适合模糊/意图性查询。',
      {
        properties: { query: { type: 'string', description: '搜索问题或关键短语' } },
        required: ['query']
      }
    )
  ]
}

export interface BuiltinToolResult {
  text: string
  isError?: boolean
}

/**
 * 执行内置工具；sessionId 可选，用于记录修改到 ContextTracker
 * userId 可选，用于记忆检索的真实用户 ID
 */
export async function executeBuiltinTool(
  scope: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string,
  userId?: string
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
        const tags = Array.isArray(args.tags)
          ? (args.tags as string[]).filter((t): t is string => typeof t === 'string')
          : undefined
        const now = Date.now()
        const note = {
          id: genUniqueId(),
          content,
          tags,
          createdAt: now,
          updatedAt: now
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
        if (args.tags !== undefined)
          data.notes[idx].tags = Array.isArray(args.tags)
            ? (args.tags as string[]).filter((t): t is string => typeof t === 'string')
            : undefined
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

      case 'prizm_list_memories': {
        if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
        const memories = await getAllMemories(MEMORY_USER_ID, scope)
        if (!memories.length) return { text: '当前无记忆条目。' }
        const lines = memories
          .slice(0, 50)
          .map(
            (m) =>
              `- [${m.id}] ${(m.memory || '').slice(0, 120)}${
                (m.memory?.length ?? 0) > 120 ? '...' : ''
              }`
          )
        return { text: lines.join('\n') }
      }

      case 'prizm_search_memories': {
        if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
        const searchQuery = typeof args.query === 'string' ? args.query.trim() : ''
        if (!searchQuery) return { text: '请提供搜索关键词。', isError: true }
        const memories = await searchMemoriesWithOptions(searchQuery, MEMORY_USER_ID, scope)
        if (!memories.length) return { text: '未找到相关记忆。' }
        const lines = memories.map((m) => `- ${m.memory}`)
        return { text: lines.join('\n') }
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
  'prizm_scope_stats',
  'prizm_list_memories',
  'prizm_search_memories'
])
