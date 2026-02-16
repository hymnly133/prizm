/**
 * Agent 内置工具：文件系统、待办/文档 CRUD、搜索、统计
 * 工具定义与执行统一在此模块，供 DefaultAgentAdapter.chat 使用
 */

import type { LLMTool } from '../adapters/interfaces'
import { scopeStore } from '../core/ScopeStore'
import * as mdStore from '../core/mdStore'
import { genUniqueId } from '../id'
import type { TodoItemStatus, TodoList } from '../types'
import { scheduleDocumentSummary } from './documentSummaryService'
import { listRefItems, getScopeRefItem, getScopeStats } from './scopeItemRegistry'
import type { SearchIndexService } from '../search/searchIndexService'
import { recordActivity } from './contextTracker'
import type { ScopeActivityItemKind, ScopeActivityAction } from '@prizm/shared'
import { MEMORY_USER_ID } from '@prizm/shared'
import { isMemoryEnabled, getAllMemories, searchMemoriesWithOptions } from './EverMemService'
import {
  createWorkspaceContext,
  resolvePath,
  resolveFolder,
  resolveWorkspaceType,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from './workspaceResolver'
import { getTerminalManager, stripAnsi } from '../terminal/TerminalSessionManager'
import { builtinToolEvents } from './builtinToolEvents'

/** SearchIndexService 实例注入 - 由 server.ts 初始化时调用 */
let _searchIndex: SearchIndexService | null = null

export function setSearchIndexForTools(searchIndex: SearchIndexService): void {
  _searchIndex = searchIndex
}

export function getSearchIndexForTools(): SearchIndexService | null {
  return _searchIndex
}

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

/** workspace 参数：选择操作主工作区还是会话临时工作区（仅在使用相对路径时生效） */
const WORKSPACE_PARAM: ToolPropertyDef = {
  type: 'string',
  description:
    '目标工作区（仅相对路径时生效）："main"（默认）= 主工作区，"session" = 当前会话临时工作区。' +
    '草稿、临时计算结果等应写入 "session"；正式文件写入 "main"。' +
    '使用绝对路径时可忽略此参数，系统会自动识别所属工作区。',
  enum: ['main', 'session']
}

/**
 * 返回所有内置工具定义（不含 Tavily，Tavily 由 adapter 按配置追加）
 */
export function getBuiltinTools(): LLMTool[] {
  return [
    tool(
      'prizm_file_list',
      '列出工作区指定目录下的文件和子目录。path 为空时列出根目录。' +
        '支持相对路径和绝对路径。设置 workspace="session" 可列出会话临时工作区。',
      {
        properties: {
          path: {
            type: 'string',
            description: '目录路径（相对路径或绝对路径），默认为空表示根目录'
          },
          workspace: WORKSPACE_PARAM
        },
        required: []
      }
    ),
    tool(
      'prizm_file_read',
      '根据路径读取文件内容。支持相对路径和绝对路径（绝对路径自动识别所属工作区）。',
      {
        properties: {
          path: { type: 'string', description: '文件路径（相对路径或绝对路径）' },
          workspace: WORKSPACE_PARAM
        },
        required: ['path']
      }
    ),
    tool(
      'prizm_file_write',
      '将内容写入指定路径的文件。若文件不存在则创建，存在则覆盖。支持相对路径和绝对路径。' +
        '草稿、临时内容应设置 workspace="session" 或使用临时工作区绝对路径。',
      {
        properties: {
          path: { type: 'string', description: '文件路径（相对路径或绝对路径）' },
          content: { type: 'string', description: '要写入的内容' },
          workspace: WORKSPACE_PARAM
        },
        required: ['path', 'content']
      }
    ),
    tool(
      'prizm_file_move',
      '移动或重命名文件/目录。支持相对路径和绝对路径。源和目标必须在同一工作区内。',
      {
        properties: {
          from: { type: 'string', description: '源路径（相对或绝对）' },
          to: { type: 'string', description: '目标路径（相对或绝对）' },
          workspace: WORKSPACE_PARAM
        },
        required: ['from', 'to']
      }
    ),
    tool(
      'prizm_file_delete',
      '删除指定路径的文件或目录。删除前需二次确认用户意图。支持相对路径和绝对路径。',
      {
        properties: {
          path: { type: 'string', description: '文件或目录路径（相对或绝对）' },
          workspace: WORKSPACE_PARAM
        },
        required: ['path']
      }
    ),
    tool(
      'prizm_list_todos',
      '列出待办项，含状态与标题，按列表分组。workspace="session" 列出临时工作区的待办。',
      { properties: { workspace: WORKSPACE_PARAM }, required: [] }
    ),
    tool(
      'prizm_list_todo_lists',
      '列出所有待办列表的 id 与标题。在创建待办项前调用。workspace="session" 列出临时工作区。',
      { properties: { workspace: WORKSPACE_PARAM }, required: [] }
    ),
    tool('prizm_read_todo', '根据待办项 ID 读取详情。workspace="session" 读取临时工作区。', {
      properties: {
        todoId: { type: 'string', description: '待办项 ID' },
        workspace: WORKSPACE_PARAM
      },
      required: ['todoId']
    }),
    tool(
      'prizm_create_todo',
      '创建一条待办项。必须指定 listId 或 listTitle。workspace="session" 创建到临时工作区（不入全局列表）。',
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
          folder: {
            type: 'string',
            description: '新建列表的存放目录，如 "projects"。不指定则放在工作区根目录。'
          },
          status: {
            type: 'string',
            description: 'todo | doing | done',
            enum: ['todo', 'doing', 'done']
          },
          workspace: WORKSPACE_PARAM
        },
        required: ['title']
      }
    ),
    tool('prizm_update_todo', '更新待办项状态、标题或描述。workspace="session" 更新临时工作区。', {
      properties: {
        todoId: { type: 'string', description: '待办项 ID' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        title: { type: 'string' },
        description: { type: 'string' },
        workspace: WORKSPACE_PARAM
      },
      required: ['todoId']
    }),
    tool('prizm_delete_todo', '删除指定待办项。workspace="session" 删除临时工作区。', {
      properties: {
        todoId: { type: 'string', description: '待办项 ID' },
        workspace: WORKSPACE_PARAM
      },
      required: ['todoId']
    }),
    tool(
      'prizm_list_documents',
      '列出文档（ID、标题、字数）。workspace="session" 列出临时工作区的文档。',
      { properties: { workspace: WORKSPACE_PARAM }, required: [] }
    ),
    tool(
      'prizm_get_document_content',
      '根据文档 ID 获取完整正文。workspace="session" 读取临时工作区。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' },
          workspace: WORKSPACE_PARAM
        },
        required: ['documentId']
      }
    ),
    tool(
      'prizm_create_document',
      '创建文档。workspace="session" 创建到临时工作区（不入全局列表，session 删除时清除）。' +
        '可通过 folder 指定嵌套目录。',
      {
        properties: {
          title: { type: 'string', description: '标题（同时作为文件名）' },
          content: { type: 'string', description: '正文' },
          folder: {
            type: 'string',
            description: '存放目录，如 "research"。不指定则放在工作区根目录。'
          },
          workspace: WORKSPACE_PARAM
        },
        required: ['title']
      }
    ),
    tool(
      'prizm_update_document',
      '更新文档标题或正文。workspace="session" 更新临时工作区。仅传入需要修改的字段。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' },
          title: { type: 'string' },
          content: { type: 'string' },
          workspace: WORKSPACE_PARAM
        },
        required: ['documentId']
      }
    ),
    tool('prizm_delete_document', '删除指定文档。workspace="session" 删除临时工作区。', {
      properties: {
        documentId: { type: 'string', description: '文档 ID' },
        workspace: WORKSPACE_PARAM
      },
      required: ['documentId']
    }),
    tool(
      'prizm_search',
      '在工作区便签、待办、文档中搜索关键词（分词索引 + 全文扫描混合搜索，保证不漏）。' +
        '当用户询问特定内容但不确定在哪个类型中时使用。' +
        '返回匹配条目列表（类型+ID+标题+内容预览+相关度评分）。' +
        '支持中文分词，多个关键词用空格分隔。' +
        '语义模糊查询请改用 prizm_search_memories。',
      {
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或短语（多词用空格分隔，如"竞品 分析"）'
          },
          types: {
            type: 'array',
            description:
              '限定搜索类型，可选 "document"、"todoList"、"clipboard"、"note"。不指定则搜索全部。',
            items: { type: 'string' }
          },
          tags: {
            type: 'array',
            description: '按标签过滤（OR 逻辑：含任一指定 tag 即匹配）。不指定则不过滤。',
            items: { type: 'string' }
          }
        },
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
    ),
    tool(
      'prizm_promote_file',
      '将临时工作区的 Prizm 文档或待办列表提升到主工作区（永久保留、全局可见、可搜索）。' +
        '适用于在会话中创建的草稿文件，确认后需要保留时使用。',
      {
        properties: {
          fileId: { type: 'string', description: '文档或待办列表的 ID' },
          folder: {
            type: 'string',
            description: '目标目录（可选，默认根目录）'
          }
        },
        required: ['fileId']
      }
    ),
    // ---- 终端工具 ----
    tool(
      'prizm_terminal_execute',
      '在工作区执行命令并返回输出。命令在 shell 中执行，完成或超时后自动返回结果。' +
        '适用于一次性命令如 ls、git status、npm install 等。用户可在终端面板中查看实时输出。',
      {
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          cwd: {
            type: 'string',
            description: '工作目录（相对工作区根目录的路径），默认为工作区根目录'
          },
          workspace: {
            type: 'string',
            description: '工作目录所在工作区："main"（默认，全局目录）或 "session"（会话临时目录）'
          },
          timeout: {
            type: 'number',
            description: '超时秒数，默认 30，最大 300'
          }
        },
        required: ['command']
      }
    ),
    tool(
      'prizm_terminal_spawn',
      '创建持久终端会话。用于需要交互或长时间运行的场景（如 dev server、watch 模式）。' +
        '用户可在终端面板中查看和交互。返回终端 ID，后续可通过 prizm_terminal_send_keys 交互。',
      {
        properties: {
          cwd: {
            type: 'string',
            description: '工作目录（相对工作区根目录的路径），默认为工作区根目录'
          },
          workspace: {
            type: 'string',
            description: '工作目录所在工作区："main"（默认，全局目录）或 "session"（会话临时目录）'
          },
          title: { type: 'string', description: '终端标题，便于用户识别' }
        },
        required: []
      }
    ),
    tool(
      'prizm_terminal_send_keys',
      '向持久终端发送输入。通过 pressEnter 控制是否按回车：' +
        'pressEnter=true（默认）自动追加回车执行命令，无需在 input 中包含换行符；' +
        'pressEnter=false 仅键入文本不执行。' +
        '支持分步调用：先 type（pressEnter=false）再单独 Enter（input=""，pressEnter=true）。' +
        'input 中的 \\n 会原样发送给终端（不等同于回车执行）。',
      {
        properties: {
          terminalId: { type: 'string', description: '目标终端 ID' },
          input: {
            type: 'string',
            description:
              '要发送的文本内容。执行命令时只写命令本身（如 "ls -la"），不要手动加 \\n 或 \\r——回车由 pressEnter 控制。' +
              '可以为空字符串 ""，配合 pressEnter=true 实现单独按回车。'
          },
          pressEnter: {
            type: 'boolean',
            description:
              '是否在 input 之后自动按下回车键（发送 \\r）。' +
              'true（默认）= 发送 input 后按回车，用于执行命令；' +
              'false = 仅键入 input 文本，不按回车，用于交互式输入、密码、Tab 补全、分步输入等场景。'
          },
          waitMs: {
            type: 'number',
            description: '等待输出的时间（毫秒），默认 2000'
          }
        },
        required: ['terminalId', 'input']
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
 * grantedPaths 可选，用户授权的外部文件路径列表
 */
export async function executeBuiltinTool(
  scope: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string,
  userId?: string,
  grantedPaths?: string[]
): Promise<BuiltinToolResult> {
  const data = scopeStore.getScopeData(scope)
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const wsCtx = createWorkspaceContext(scopeRoot, sessionId)

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

  const wsArg = typeof args.workspace === 'string' ? args.workspace : undefined

  try {
    switch (toolName) {
      case 'prizm_file_list': {
        const pathArg = typeof args.path === 'string' ? args.path : ''
        const resolved = resolvePath(wsCtx, pathArg, wsArg, grantedPaths)
        if (!resolved)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const entries = mdStore.listDirectory(resolved.fileRoot, resolved.relativePath)
        if (!entries.length) return { text: `目录为空或不存在。${wsTypeLabel(resolved.wsType)}` }
        const lines = entries.map((e) => {
          const type = e.isDir ? '[目录]' : '[文件]'
          const extra = e.prizmType ? ` (${e.prizmType})` : ''
          return `- ${type} ${e.relativePath}${extra}`
        })
        return { text: lines.join('\n') + wsTypeLabel(resolved.wsType) }
      }

      case 'prizm_file_read': {
        const pathArg = typeof args.path === 'string' ? args.path : ''
        const resolved = resolvePath(wsCtx, pathArg, wsArg, grantedPaths)
        if (!resolved)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const result = mdStore.readFileByPath(resolved.fileRoot, resolved.relativePath)
        if (!result)
          return {
            text: `文件不存在或无法读取: ${pathArg}${wsTypeLabel(resolved.wsType)}`,
            isError: true
          }
        record(resolved.relativePath, 'file', 'read')
        return { text: result.content ?? '(空或二进制文件)' }
      }

      case 'prizm_file_write': {
        const pathArg = typeof args.path === 'string' ? args.path : ''
        const content = typeof args.content === 'string' ? args.content : ''
        const resolved = resolvePath(wsCtx, pathArg, wsArg, grantedPaths)
        if (!resolved)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const ok = mdStore.writeFileByPath(resolved.fileRoot, resolved.relativePath, content)
        if (!ok)
          return { text: `写入失败: ${pathArg}${wsTypeLabel(resolved.wsType)}`, isError: true }
        record(resolved.relativePath, 'file', 'create')
        builtinToolEvents.emitFileEvent({
          eventType: 'file:created',
          scope,
          relativePath: resolved.relativePath
        })
        return { text: `已写入 ${pathArg}${wsTypeLabel(resolved.wsType)}` }
      }

      case 'prizm_file_move': {
        const from = typeof args.from === 'string' ? args.from : ''
        const to = typeof args.to === 'string' ? args.to : ''
        const resolvedFrom = resolvePath(wsCtx, from, wsArg, grantedPaths)
        const resolvedTo = resolvePath(wsCtx, to, wsArg, grantedPaths)
        if (!resolvedFrom || !resolvedTo)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        // move 操作要求源和目标在同一工作区内
        if (resolvedFrom.fileRoot !== resolvedTo.fileRoot)
          return {
            text: '移动失败：源路径和目标路径必须在同一工作区内。跨工作区请先 read 再 write + delete。',
            isError: true
          }
        const ok = mdStore.moveFile(
          resolvedFrom.fileRoot,
          resolvedFrom.relativePath,
          resolvedTo.relativePath
        )
        if (!ok)
          return {
            text: `移动失败: ${from} -> ${to}${wsTypeLabel(resolvedFrom.wsType)}`,
            isError: true
          }
        builtinToolEvents.emitFileEvent({
          eventType: 'file:moved',
          scope,
          relativePath: resolvedTo.relativePath,
          fromPath: resolvedFrom.relativePath
        })
        return { text: `已移动 ${from} -> ${to}${wsTypeLabel(resolvedFrom.wsType)}` }
      }

      case 'prizm_file_delete': {
        const pathArg = typeof args.path === 'string' ? args.path : ''
        const resolved = resolvePath(wsCtx, pathArg, wsArg, grantedPaths)
        if (!resolved)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const ok = mdStore.deleteByPath(resolved.fileRoot, resolved.relativePath)
        if (!ok)
          return { text: `删除失败: ${pathArg}${wsTypeLabel(resolved.wsType)}`, isError: true }
        record(resolved.relativePath, 'file', 'delete')
        builtinToolEvents.emitFileEvent({
          eventType: 'file:deleted',
          scope,
          relativePath: resolved.relativePath
        })
        return { text: `已删除 ${pathArg}${wsTypeLabel(resolved.wsType)}` }
      }

      case 'prizm_list_todos': {
        const { root: wsRoot, wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        const lists = ws === 'session' ? mdStore.readTodoLists(wsRoot) : data.todoLists ?? []
        if (!lists.length) return { text: `当前无待办列表。${wsTypeLabel(ws)}` }
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
        return { text: lines.join('\n') + wsTypeLabel(ws) }
      }

      case 'prizm_list_todo_lists': {
        const { root: wsRoot, wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        const lists = ws === 'session' ? mdStore.readTodoLists(wsRoot) : data.todoLists ?? []
        if (!lists.length) return { text: `当前无待办列表。${wsTypeLabel(ws)}` }
        const lines = lists.map((l) => `- ${l.id}: ${l.title} (${l.items?.length ?? 0} 项)`)
        return { text: lines.join('\n') + wsTypeLabel(ws) }
      }

      case 'prizm_read_todo': {
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const { root: wsRoot, wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session') {
          const lists = mdStore.readTodoLists(wsRoot)
          for (const list of lists) {
            const item = list.items.find((it) => it.id === todoId)
            if (item) {
              const desc = item.description ? `\n${item.description}` : ''
              return { text: `[${item.status}] ${item.title}${desc} (列表: ${list.title})` }
            }
          }
          return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
        }
        const detail = getScopeRefItem(scope, 'todo', todoId)
        if (!detail) return { text: `待办项不存在: ${todoId}`, isError: true }
        return { text: detail.content || '(空)' }
      }

      case 'prizm_create_todo': {
        const listTitle = typeof args.listTitle === 'string' ? args.listTitle.trim() : undefined
        const listId = typeof args.listId === 'string' ? args.listId : undefined
        if (!listId && !listTitle) {
          return {
            text: '必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加）',
            isError: true
          }
        }
        const folderResult = resolveFolder(wsCtx, args.folder, wsArg)
        if (!folderResult)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const { folder: folderPath, wsType: todoWsType } = folderResult
        const todoTitle = typeof args.title === 'string' ? args.title : '(无标题)'
        const todoDesc = typeof args.description === 'string' ? args.description : undefined
        const todoStatus = (
          args.status === 'doing' || args.status === 'done' ? args.status : 'todo'
        ) as TodoItemStatus
        const now = Date.now()
        const newItem = {
          id: genUniqueId(),
          title: todoTitle,
          description: todoDesc,
          status: todoStatus,
          createdAt: now,
          updatedAt: now
        }

        if (todoWsType === 'session' && wsCtx.sessionWorkspaceRoot) {
          let list: TodoList
          if (listId) {
            const existing = mdStore.readSingleTodoListById(wsCtx.sessionWorkspaceRoot, listId)
            if (!existing) return { text: `待办列表不存在: ${listId} [临时工作区]`, isError: true }
            list = existing
          } else {
            const sanitizedName = mdStore.sanitizeFileName(listTitle!) + '.md'
            const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
            list = {
              id: genUniqueId(),
              title: listTitle!,
              items: [],
              relativePath,
              createdAt: now,
              updatedAt: now
            }
          }
          list.items.push(newItem)
          list.updatedAt = now
          mdStore.writeSingleTodoList(wsCtx.sessionWorkspaceRoot, list)
          record(newItem.id, 'todo', 'create')
          const hint = listTitle ? `（新建列表「${listTitle}」）` : ''
          return { text: `已创建待办项 ${newItem.id}${hint}${wsTypeLabel(todoWsType)}` }
        }

        if (!data.todoLists) data.todoLists = []
        let list: TodoList
        if (listTitle) {
          const sanitizedName = mdStore.sanitizeFileName(listTitle) + '.md'
          const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
          list = {
            id: genUniqueId(),
            title: listTitle,
            items: [],
            relativePath,
            createdAt: now,
            updatedAt: now
          }
          data.todoLists.push(list)
        } else {
          const found = data.todoLists.find((l) => l.id === listId)
          if (!found) return { text: `待办列表不存在: ${listId}`, isError: true }
          list = found
        }
        list.items.push(newItem)
        list.updatedAt = now
        scopeStore.saveScope(scope)
        record(newItem.id, 'todo', 'create')
        return {
          text: `已创建待办项 ${newItem.id}` + (listTitle ? `（新建列表「${listTitle}」）` : '')
        }
      }

      case 'prizm_update_todo': {
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const { wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session' && wsCtx.sessionWorkspaceRoot) {
          const lists = mdStore.readTodoLists(wsCtx.sessionWorkspaceRoot)
          for (const list of lists) {
            const item = list.items.find((it) => it.id === todoId)
            if (item) {
              if (args.status === 'todo' || args.status === 'doing' || args.status === 'done')
                item.status = args.status
              if (typeof args.title === 'string') item.title = args.title
              if (args.description !== undefined)
                (item as { description?: string }).description =
                  typeof args.description === 'string' ? args.description : undefined
              item.updatedAt = Date.now()
              list.updatedAt = Date.now()
              mdStore.writeSingleTodoList(wsCtx.sessionWorkspaceRoot, list)
              record(todoId, 'todo', 'update')
              return { text: `已更新待办项 ${todoId}${wsTypeLabel(ws)}` }
            }
          }
          return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
        }
        const lists = data.todoLists ?? []
        const todoList = lists.find((l) => l.items.some((it) => it.id === todoId))
        if (!todoList) return { text: `待办项不存在: ${todoId}`, isError: true }
        const idx = todoList.items.findIndex((it) => it.id === todoId)
        if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
        const cur = todoList.items[idx]
        if (args.status === 'todo' || args.status === 'doing' || args.status === 'done')
          cur.status = args.status
        if (typeof args.title === 'string') cur.title = args.title
        if (args.description !== undefined)
          (cur as { description?: string }).description =
            typeof args.description === 'string' ? args.description : undefined
        cur.updatedAt = Date.now()
        todoList.updatedAt = Date.now()
        scopeStore.saveScope(scope)
        record(todoId, 'todo', 'update')
        return { text: `已更新待办项 ${todoId}` }
      }

      case 'prizm_delete_todo': {
        const todoId = typeof args.todoId === 'string' ? args.todoId : ''
        const { wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session' && wsCtx.sessionWorkspaceRoot) {
          const lists = mdStore.readTodoLists(wsCtx.sessionWorkspaceRoot)
          for (const list of lists) {
            const idx = list.items.findIndex((it) => it.id === todoId)
            if (idx >= 0) {
              list.items.splice(idx, 1)
              list.updatedAt = Date.now()
              mdStore.writeSingleTodoList(wsCtx.sessionWorkspaceRoot, list)
              record(todoId, 'todo', 'delete')
              return { text: `已删除待办项 ${todoId} [临时工作区]` }
            }
          }
          return { text: `待办项不存在: ${todoId} [临时工作区]`, isError: true }
        }
        const lists = data.todoLists ?? []
        const todoList = lists.find((l) => l.items.some((it) => it.id === todoId))
        if (!todoList) return { text: `待办项不存在: ${todoId}`, isError: true }
        const idx = todoList.items.findIndex((it) => it.id === todoId)
        if (idx < 0) return { text: `待办项不存在: ${todoId}`, isError: true }
        todoList.items.splice(idx, 1)
        todoList.updatedAt = Date.now()
        scopeStore.saveScope(scope)
        record(todoId, 'todo', 'delete')
        return { text: `已删除待办项 ${todoId}` }
      }

      case 'prizm_list_documents': {
        const { root: wsRoot, wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session') {
          const docs = mdStore.readDocuments(wsRoot)
          if (!docs.length) return { text: '当前无文档。 [临时工作区]' }
          const lines = docs.map((d) => `- ${d.id}: ${d.title} (${d.content?.length ?? 0} 字)`)
          return { text: lines.join('\n') + ' [临时工作区]' }
        }
        const items = listRefItems(scope, 'document')
        if (!items.length) return { text: '当前无文档。' }
        const lines = items.map((r) => `- ${r.id}: ${r.title} (${r.charCount} 字)`)
        return { text: lines.join('\n') }
      }

      case 'prizm_get_document_content': {
        const documentId = typeof args.documentId === 'string' ? args.documentId : ''
        const { root: wsRoot, wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session') {
          const doc = mdStore.readSingleDocumentById(wsRoot, documentId)
          if (!doc) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
          return { text: doc.content || '(无正文)' }
        }
        const detail = getScopeRefItem(scope, 'document', documentId)
        if (!detail) return { text: `文档不存在: ${documentId}`, isError: true }
        return { text: detail.content || '(无正文)' }
      }

      case 'prizm_create_document': {
        const title = typeof args.title === 'string' ? args.title : '未命名文档'
        const content = typeof args.content === 'string' ? args.content : ''
        const folderResult = resolveFolder(wsCtx, args.folder, wsArg)
        if (!folderResult)
          return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
        const { folder: folderPath, wsType } = folderResult
        const sanitizedName = mdStore.sanitizeFileName(title) + '.md'
        const relativePath = folderPath ? `${folderPath}/${sanitizedName}` : ''
        const now = Date.now()
        const doc = {
          id: genUniqueId(),
          title,
          content,
          relativePath,
          createdAt: now,
          updatedAt: now
        }
        if (wsType === 'session' && wsCtx.sessionWorkspaceRoot) {
          mdStore.writeSingleDocument(wsCtx.sessionWorkspaceRoot, doc)
          record(doc.id, 'document', 'create')
          const folderHint = folderPath ? ` (${folderPath}/)` : ''
          return { text: `已创建文档 ${doc.id}${folderHint}${wsTypeLabel(wsType)}` }
        }
        data.documents.push(doc)
        scopeStore.saveScope(scope)
        scheduleDocumentSummary(scope, doc.id)
        record(doc.id, 'document', 'create')
        const folderHint = folderPath ? ` (${folderPath}/)` : ''
        return { text: `已创建文档 ${doc.id}${folderHint}` }
      }

      case 'prizm_update_document': {
        const documentId = typeof args.documentId === 'string' ? args.documentId : ''
        const { wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session' && wsCtx.sessionWorkspaceRoot) {
          const existing = mdStore.readSingleDocumentById(wsCtx.sessionWorkspaceRoot, documentId)
          if (!existing) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
          if (typeof args.title === 'string') existing.title = args.title
          if (typeof args.content === 'string') existing.content = args.content
          existing.updatedAt = Date.now()
          mdStore.writeSingleDocument(wsCtx.sessionWorkspaceRoot, existing)
          record(documentId, 'document', 'update')
          return { text: `已更新文档 ${documentId} [临时工作区]` }
        }
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
        const { wsType: ws } = resolveWorkspaceType(wsCtx, wsArg)
        if (ws === 'session' && wsCtx.sessionWorkspaceRoot) {
          const ok = mdStore.deleteSingleDocument(wsCtx.sessionWorkspaceRoot, documentId)
          if (!ok) return { text: `文档不存在: ${documentId} [临时工作区]`, isError: true }
          record(documentId, 'document', 'delete')
          return { text: `已删除文档 ${documentId} [临时工作区]` }
        }
        const idx = data.documents.findIndex((d) => d.id === documentId)
        if (idx < 0) return { text: `文档不存在: ${documentId}`, isError: true }
        data.documents.splice(idx, 1)
        scopeStore.saveScope(scope)
        record(documentId, 'document', 'delete')
        return { text: `已删除文档 ${documentId}` }
      }

      case 'prizm_promote_file': {
        if (!wsCtx.sessionWorkspaceRoot || !wsCtx.sessionId)
          return { text: '当前没有活跃的临时工作区，无法执行提升操作。', isError: true }
        const fileId = typeof args.fileId === 'string' ? args.fileId : ''
        if (!fileId) return { text: '必须指定 fileId', isError: true }
        const targetFolder = typeof args.folder === 'string' ? args.folder.trim() : ''

        // 先尝试 document
        const doc = mdStore.readSingleDocumentById(wsCtx.sessionWorkspaceRoot, fileId)
        if (doc) {
          if (targetFolder) {
            const sanitized = mdStore.sanitizeFileName(doc.title) + '.md'
            doc.relativePath = `${targetFolder}/${sanitized}`
          } else {
            doc.relativePath = ''
          }
          data.documents.push(doc)
          scopeStore.saveScope(scope)
          mdStore.deleteSingleDocument(wsCtx.sessionWorkspaceRoot, fileId)
          scheduleDocumentSummary(scope, doc.id)
          record(doc.id, 'document', 'create')
          return { text: `已将文档「${doc.title}」(${doc.id}) 从临时工作区提升到主工作区。` }
        }

        // 再尝试 todo_list
        const todoList = mdStore.readSingleTodoListById(wsCtx.sessionWorkspaceRoot, fileId)
        if (todoList) {
          if (targetFolder) {
            const sanitized = mdStore.sanitizeFileName(todoList.title) + '.md'
            todoList.relativePath = `${targetFolder}/${sanitized}`
          } else {
            todoList.relativePath = ''
          }
          if (!data.todoLists) data.todoLists = []
          data.todoLists.push(todoList)
          scopeStore.saveScope(scope)
          mdStore.deleteSingleTodoList(wsCtx.sessionWorkspaceRoot, fileId)
          record(todoList.id, 'todo', 'create')
          return {
            text: `已将待办列表「${todoList.title}」(${todoList.id}) 从临时工作区提升到主工作区。`
          }
        }

        return { text: `在临时工作区中未找到 ID 为 ${fileId} 的文档或待办列表。`, isError: true }
      }

      case 'prizm_search': {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return { text: '请提供搜索关键词。', isError: true }
        if (!_searchIndex) {
          return { text: '搜索服务未初始化。', isError: true }
        }
        const types = Array.isArray(args.types) ? args.types : undefined
        const tags = Array.isArray(args.tags) ? args.tags : undefined
        const results = await _searchIndex.search(scope, query, {
          complete: true,
          limit: 20,
          types,
          tags
        })
        if (!results.length) return { text: '未找到匹配项。' }
        const lines = results.map((r) => {
          const srcTag = r.source === 'fulltext' ? ' [全文]' : ''
          const preview = r.preview && r.preview !== '(空)' ? `\n  预览: ${r.preview}` : ''
          return `- [${r.kind}] ${r.id}: ${
            (r.raw as { title?: string })?.title ?? r.id
          }${srcTag}${preview}`
        })
        return { text: `找到 ${results.length} 条结果：\n${lines.join('\n')}` }
      }

      case 'prizm_scope_stats': {
        const stats = getScopeStats(scope)
        const t = stats.byKind
        const text = `文档 ${t.document.count} 篇 / ${t.document.chars} 字；待办 ${t.todoList.count} 项 / ${t.todoList.chars} 字；会话 ${t.sessions.count} 个。总计 ${stats.totalItems} 项，${stats.totalChars} 字。`
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

      // ---- 终端工具 ----
      case 'prizm_terminal_execute': {
        const command = typeof args.command === 'string' ? args.command : ''
        if (!command.trim()) return { text: '请提供要执行的命令。', isError: true }
        const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined
        const wsArg = typeof args.workspace === 'string' ? args.workspace : undefined
        const timeoutSec = typeof args.timeout === 'number' ? Math.min(args.timeout, 300) : 30
        const termMgr = getTerminalManager()
        const wsCtx = createWorkspaceContext(scopeRoot, sessionId)
        const { root: wsRoot, wsType } = resolveWorkspaceType(wsCtx, wsArg)
        const resolvedCwd = cwdArg ? require('path').resolve(wsRoot, cwdArg) : wsRoot
        if (!sessionId) return { text: '终端工具需要在会话中使用。', isError: true }
        const result = await termMgr.executeCommand({
          agentSessionId: sessionId,
          scope,
          command,
          cwd: resolvedCwd,
          timeoutMs: timeoutSec * 1000,
          sessionType: 'exec',
          title: `exec: ${command.slice(0, 40)}`,
          workspaceType: wsType === 'granted' ? 'main' : wsType
        })
        const MAX_OUTPUT = 8192
        let output = result.output
        if (output.length > MAX_OUTPUT) {
          const head = output.slice(0, MAX_OUTPUT / 2)
          const tail = output.slice(-MAX_OUTPUT / 2)
          output = head + '\n\n... (输出已截断) ...\n\n' + tail
        }
        const status = result.timedOut
          ? `[超时 ${timeoutSec}s，进程已终止]`
          : `[退出码: ${result.exitCode}]`
        return { text: `${status}\n${output}` }
      }

      case 'prizm_terminal_spawn': {
        if (!sessionId) return { text: '终端工具需要在会话中使用。', isError: true }
        const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined
        const wsArg = typeof args.workspace === 'string' ? args.workspace : undefined
        const title = typeof args.title === 'string' ? args.title : undefined
        const termMgr = getTerminalManager()
        const wsCtx = createWorkspaceContext(scopeRoot, sessionId)
        const { root: wsRoot } = resolveWorkspaceType(wsCtx, wsArg)
        const resolvedCwd = cwdArg ? require('path').resolve(wsRoot, cwdArg) : wsRoot
        const terminal = termMgr.createTerminal({
          agentSessionId: sessionId,
          scope,
          cwd: resolvedCwd,
          title,
          sessionType: 'interactive'
        })
        return {
          text: `已创建终端「${terminal.title}」(ID: ${terminal.id})，用户可在终端面板中查看和交互。`
        }
      }

      case 'prizm_terminal_send_keys': {
        const terminalId = typeof args.terminalId === 'string' ? args.terminalId : ''
        const input = typeof args.input === 'string' ? args.input : ''
        const pressEnter = args.pressEnter !== false // 默认 true
        const waitMs = typeof args.waitMs === 'number' ? Math.min(args.waitMs, 10000) : 2000
        if (!terminalId) return { text: '请提供 terminalId。', isError: true }
        const termMgr = getTerminalManager()
        const terminal = termMgr.getTerminal(terminalId)
        if (!terminal) return { text: `终端不存在: ${terminalId}`, isError: true }
        if (terminal.status !== 'running')
          return { text: `终端已退出 (code: ${terminal.exitCode})`, isError: true }
        // 记录发送前的输出长度
        const prevOutput = termMgr.getRecentOutput(terminalId)
        const prevLen = prevOutput.length
        // 发送输入；pressEnter=true 时追加 \r（PTY 中模拟 Enter 键），否则仅输入文本
        const dataToSend = pressEnter ? input + '\r' : input
        termMgr.writeToTerminal(terminalId, dataToSend)
        // 等待输出
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        // 获取新输出
        const currentOutput = termMgr.getRecentOutput(terminalId)
        let newOutput = currentOutput.length > prevLen ? currentOutput.slice(prevLen) : '(无新输出)'
        // 清理 ANSI 转义序列，避免不可读字符传递给 LLM
        newOutput = stripAnsi(newOutput)
        // 截断
        if (newOutput.length > 8192) {
          newOutput = newOutput.slice(-8192)
        }
        return { text: newOutput }
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
  'prizm_file_list',
  'prizm_file_read',
  'prizm_file_write',
  'prizm_file_move',
  'prizm_file_delete',
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
  'prizm_promote_file',
  'prizm_search',
  'prizm_scope_stats',
  'prizm_list_memories',
  'prizm_search_memories',
  'prizm_terminal_execute',
  'prizm_terminal_spawn',
  'prizm_terminal_send_keys'
])
