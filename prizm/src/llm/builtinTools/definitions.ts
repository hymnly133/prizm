/**
 * 内置工具定义：tool() 辅助函数与 getBuiltinTools()
 *
 * 复合工具设计：同类 CRUD 操作通过 action enum 合并为单一工具，
 * 参考 v0 TodoManager、Notion update-page、Replit str_replace_editor 模式。
 */

import type { LLMTool } from '../../adapters/interfaces'
import { getGuardedGroupNames } from '../toolInstructions'

/** 工具参数属性定义（支持 array 类型的 items） */
export interface ToolPropertyDef {
  type: string
  description?: string
  enum?: string[]
  items?: { type: string }
}

export function tool(
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
export const WORKSPACE_PARAM: ToolPropertyDef = {
  type: 'string',
  description: '"main"（默认）或 "session"（临时工作区）',
  enum: ['main', 'session']
}

/**
 * 返回所有内置工具定义（不含 Tavily，Tavily 由 adapter 按配置追加）
 */
export function getBuiltinTools(): LLMTool[] {
  return [
    // ── 文件（复合） ──
    tool(
      'prizm_file',
      '文件操作。action: list(列出目录)/read(读取)/write(写入,不存在则创建)/move(移动或重命名)/delete(删除,需确认)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'read', 'write', 'move', 'delete']
          },
          path: { type: 'string', description: '文件或目录路径 (list/read/write/delete)' },
          content: { type: 'string', description: '写入内容 (write)' },
          from: { type: 'string', description: '源路径 (move)' },
          to: { type: 'string', description: '目标路径 (move)' },
          workspace: WORKSPACE_PARAM
        },
        required: ['action']
      }
    ),

    // ── 待办（复合） ──
    tool(
      'prizm_todo',
      '待办管理。action 分列表级和条目级：list(查看)/create_list(建列表)/delete_list(删列表)/add_items(加条目)/update_item(改条目)/delete_item(删条目)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'create_list', 'delete_list', 'add_items', 'update_item', 'delete_item']
          },
          listId: { type: 'string', description: '列表 ID (list 查看详情/delete_list/add_items)' },
          listTitle: { type: 'string', description: '新建列表标题 (create_list)' },
          itemTitles: {
            type: 'array',
            description: '待办项标题数组 (create_list/add_items)',
            items: { type: 'string' }
          },
          itemId: { type: 'string', description: '条目 ID (update_item/delete_item)' },
          title: { type: 'string', description: '新标题 (update_item)' },
          description: { type: 'string', description: '新描述 (update_item)' },
          status: {
            type: 'string',
            description: '条目状态 (create_list/add_items/update_item)',
            enum: ['todo', 'doing', 'done']
          },
          folder: { type: 'string', description: '列表存放目录 (create_list)' },
          workspace: WORKSPACE_PARAM
        },
        required: ['action']
      }
    ),

    // ── 文档（复合） ──
    tool(
      'prizm_document',
      '文档管理。action: list(列出)/read(读取正文)/create(创建)/update(更新,仅传需改字段)/delete(删除)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'read', 'create', 'update', 'delete']
          },
          documentId: { type: 'string', description: '文档 ID (read/update/delete)' },
          title: { type: 'string', description: '标题 (create/update)' },
          content: { type: 'string', description: '正文 (create/update)' },
          folder: { type: 'string', description: '存放目录 (create)' },
          workspace: WORKSPACE_PARAM
        },
        required: ['action']
      }
    ),

    // ── 搜索（复合） ──
    tool(
      'prizm_search',
      '工作区关键词搜索。mode: keyword(搜索文档/待办/剪贴板)/stats(工作区统计)。语义/记忆搜索请用 prizm_knowledge。',
      {
        properties: {
          mode: {
            type: 'string',
            description: '搜索模式',
            enum: ['keyword', 'stats']
          },
          query: {
            type: 'string',
            description: '搜索关键词 (keyword)'
          },
          types: {
            type: 'array',
            description: '限定类型: document/todoList/clipboard (仅 keyword)',
            items: { type: 'string' }
          },
          tags: {
            type: 'array',
            description: '按标签过滤 (仅 keyword)',
            items: { type: 'string' }
          }
        },
        required: ['mode']
      }
    ),

    // ── 知识库（复合） ──
    tool(
      'prizm_knowledge',
      '知识库与记忆查询。action: search(语义搜索记忆，可反向定位文档；query 留空列出全部记忆)/memories(文档全部记忆)/versions(版本历史)/related(语义相关文档)/round_lookup(通过记忆 id 追溯到原始对话轮，推荐传 memoryId)',
      {
        properties: {
          action: {
            type: 'string',
            description: '查询类型',
            enum: ['search', 'memories', 'versions', 'related', 'round_lookup']
          },
          query: { type: 'string', description: '关键词或问题 (search)' },
          documentId: { type: 'string', description: '文档 ID (memories/versions/related)' },
          memoryId: {
            type: 'string',
            description: '记忆 ID (round_lookup 推荐，自动解析来源会话和消息)'
          },
          sessionId: {
            type: 'string',
            description: '会话 ID (round_lookup 后备，不传则使用当前会话)'
          },
          messageId: {
            type: 'string',
            description: '消息 ID (round_lookup 后备，不传则列出最近 N 条消息)'
          },
          memoryTypes: {
            type: 'array',
            description: '记忆类型: profile/narrative/foresight/document/event_log (search)',
            items: { type: 'string' }
          },
          method: {
            type: 'string',
            description: '检索方法 (search)',
            enum: ['keyword', 'vector', 'hybrid', 'rrf', 'agentic']
          },
          limit: { type: 'number', description: '返回数量 (versions/round_lookup, 默认 20/10)' }
        },
        required: ['action']
      }
    ),

    // ── 资源锁（复合，详细用法见 prizm_tool_guide） ──
    tool(
      'prizm_lock',
      '资源锁管理。action: checkout(签出文档获取编辑锁)/checkin(释放文档锁)/claim(领取待办列表)/set_active(设置待办为进行中)/release(释放待办列表)/status(查询锁定状态)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['checkout', 'checkin', 'claim', 'set_active', 'release', 'status']
          },
          documentId: { type: 'string', description: '文档 ID (checkout/checkin)' },
          todoListId: { type: 'string', description: '待办列表 ID (claim/release)' },
          todoId: { type: 'string', description: '待办项 ID (set_active)' },
          reason: { type: 'string', description: '签出理由 (checkout)' },
          resourceType: {
            type: 'string',
            description: '资源类型 (status)',
            enum: ['document', 'todo_list']
          },
          resourceId: { type: 'string', description: '资源 ID (status)' }
        },
        required: ['action']
      }
    ),

    // ── 提升文件（独立） ──
    tool('prizm_promote_file', '将临时工作区文档/待办提升到主工作区（永久保留）。', {
      properties: {
        fileId: { type: 'string', description: '文档或待办列表 ID' },
        folder: { type: 'string', description: '目标目录' }
      },
      required: ['fileId']
    }),

    // ── 终端工具（独立，详细用法见 prizm_tool_guide） ──
    tool(
      'prizm_terminal_execute',
      '执行一次性命令并返回输出（ls、git status 等）。超时后自动返回。',
      {
        properties: {
          command: { type: 'string', description: 'shell 命令' },
          cwd: { type: 'string', description: '工作目录（相对路径），默认根目录' },
          workspace: WORKSPACE_PARAM,
          timeout: { type: 'number', description: '超时秒数，默认 30' }
        },
        required: ['command']
      }
    ),
    tool('prizm_terminal_spawn', '创建持久终端（dev server、watch 等长期进程）。返回终端 ID。', {
      properties: {
        cwd: { type: 'string', description: '工作目录（相对路径），默认根目录' },
        workspace: WORKSPACE_PARAM,
        title: { type: 'string', description: '终端标题' }
      },
      required: []
    }),
    tool(
      'prizm_terminal_send_keys',
      '向持久终端发送输入。pressEnter=true（默认）自动按回车执行，false 仅键入。',
      {
        properties: {
          terminalId: { type: 'string', description: '终端 ID' },
          input: { type: 'string', description: '文本内容，不要手动加 \\n' },
          pressEnter: { type: 'boolean', description: 'true（默认）按回车执行，false 仅键入' },
          waitMs: { type: 'number', description: '等待输出毫秒数，默认 2000' }
        },
        required: ['terminalId', 'input']
      }
    ),

    // ── 后台任务工具（prizm_set_result 仅后台会话可见，见 getBackgroundOnlyTools()） ──
    tool(
      'prizm_spawn_task',
      '派发子任务到后台会话执行。mode: async（默认，立即返回任务 ID）/ sync（阻塞等待结果，适合 <30s 短任务）',
      {
        properties: {
          task: { type: 'string', description: '子任务指令' },
          mode: {
            type: 'string',
            description: '执行模式',
            enum: ['async', 'sync']
          },
          label: { type: 'string', description: '任务标签（用于管理面板展示）' },
          model: { type: 'string', description: '指定模型（可用廉价模型节省成本）' },
          context: { type: 'string', description: '额外上下文（JSON 字符串）' },
          expected_output: { type: 'string', description: '期望的输出格式描述' },
          timeout_seconds: { type: 'number', description: '超时秒数，默认 600' }
        },
        required: ['task']
      }
    ),

    tool(
      'prizm_task_status',
      '查询/管理后台任务。action: list（列出我的子任务）/ status（查状态）/ result（取结果）/ cancel（取消）',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'status', 'result', 'cancel']
          },
          task_id: { type: 'string', description: '任务 ID（status/result/cancel 时必需）' }
        },
        required: ['action']
      }
    ),

    // ── 工具指南（类 Skill 按需查询） ──
    tool(
      'prizm_tool_guide',
      '查看工具使用指南。受保护工具组（' +
        getGuardedGroupNames().join('、') +
        '）首次使用前必须查阅，否则会被拦截。',
      {
        properties: {
          tool: { type: 'string', description: '工具名或组名（如 "terminal"），不传列出全部' }
        },
        required: []
      }
    )
  ]
}

/**
 * 仅后台会话 (kind='background') 可见的工具定义
 */
export function getBackgroundOnlyTools(): LLMTool[] {
  return [
    tool('prizm_set_result', '设置当前后台会话的执行结果。必须调用此工具提交输出。', {
      properties: {
        output: { type: 'string', description: '执行结果内容（文本/Markdown）' },
        status: {
          type: 'string',
          description: '结果状态',
          enum: ['success', 'partial', 'failed']
        },
        structured_data: {
          type: 'string',
          description: '可选的结构化数据（JSON 字符串），供调用者程序化消费'
        }
      },
      required: ['output']
    })
  ]
}

/** 判断工具是否仅限后台会话使用 */
export function isBackgroundOnlyTool(name: string): boolean {
  return name === 'prizm_set_result'
}

/** 内置工具名称集合，用于判断是否为内置工具 */
export const BUILTIN_TOOL_NAMES = new Set([
  'prizm_file',
  'prizm_todo',
  'prizm_document',
  'prizm_search',
  'prizm_knowledge',
  'prizm_lock',
  'prizm_promote_file',
  'prizm_terminal_execute',
  'prizm_terminal_spawn',
  'prizm_terminal_send_keys',
  'prizm_set_result',
  'prizm_spawn_task',
  'prizm_task_status',
  'prizm_tool_guide'
])
