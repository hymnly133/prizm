/**
 * 内置工具定义：tool() 辅助函数与 getBuiltinTools()
 */

import type { LLMTool } from '../../adapters/interfaces'

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
    // ---- 知识库工具：文档-记忆双向查询 ----
    tool(
      'prizm_search_docs_by_memory',
      '通过语义搜索记忆，反向定位关联文档。可指定记忆类型和检索方法。' +
        '返回匹配文档列表（按记忆子类型分类：总览/事实/变更历史）。',
      {
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          memoryTypes: {
            type: 'array',
            description:
              '限定搜索的记忆类型。默认 ["document"]。可选: profile, narrative, foresight, document, event_log',
            items: { type: 'string' }
          },
          method: {
            type: 'string',
            description: '检索方法：keyword / vector / hybrid（默认） / rrf / agentic',
            enum: ['keyword', 'vector', 'hybrid', 'rrf', 'agentic']
          }
        },
        required: ['query']
      }
    ),
    tool(
      'prizm_get_document_memories',
      '获取文档的全部记忆（按子类型分组：总览/原子事实/变更历史）。' +
        '用于深入了解文档内容摘要和历史变更。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' }
        },
        required: ['documentId']
      }
    ),
    tool(
      'prizm_document_versions',
      '查看文档版本历史，含变更者身份和变更原因。' + '显示谁在什么时候做了什么修改。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' },
          limit: { type: 'number', description: '返回最近的版本数，默认 20' }
        },
        required: ['documentId']
      }
    ),
    tool(
      'prizm_find_related_documents',
      '基于文档记忆关联，查找与指定文档语义相关的其他文档。' + '用于发现知识关联和相关内容。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' }
        },
        required: ['documentId']
      }
    ),
    // ---- 锁定与领取工具 ----
    tool(
      'prizm_checkout_document',
      '签出文档获取编辑锁。在修改文档前必须先签出。返回文档内容和 fenceToken。' +
        '同一时间只有一个 agent 会话可以签出同一文档。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' },
          reason: { type: 'string', description: '签出理由（可选）' }
        },
        required: ['documentId']
      }
    ),
    tool(
      'prizm_checkin_document',
      '签入文档释放编辑锁。完成编辑后调用，让其他 agent 可以编辑此文档。',
      {
        properties: {
          documentId: { type: 'string', description: '文档 ID' }
        },
        required: ['documentId']
      }
    ),
    tool(
      'prizm_claim_todo_list',
      '领取待办列表为当前会话的在线待办。领取后其他 agent 不能修改此列表中的待办项。',
      {
        properties: {
          todoListId: { type: 'string', description: '待办列表 ID' }
        },
        required: ['todoListId']
      }
    ),
    tool(
      'prizm_set_active_todo',
      '设置待办项为"正在实现"状态。需要先领取待办项所在列表。表示当前 agent 正在处理此待办项。',
      {
        properties: {
          todoId: { type: 'string', description: '待办项 ID' }
        },
        required: ['todoId']
      }
    ),
    tool('prizm_release_todo_list', '释放已领取的待办列表，让其他 agent 可以领取和修改。', {
      properties: {
        todoListId: { type: 'string', description: '待办列表 ID' }
      },
      required: ['todoListId']
    }),
    tool('prizm_resource_status', '查询资源的状态信息，包括锁定状态、读取历史、活跃 agent 等。', {
      properties: {
        resourceType: {
          type: 'string',
          description: '资源类型：document / todo_list',
          enum: ['document', 'todo_list']
        },
        resourceId: { type: 'string', description: '资源 ID' }
      },
      required: ['resourceType', 'resourceId']
    }),
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
  'prizm_terminal_send_keys',
  // 知识库工具
  'prizm_search_docs_by_memory',
  'prizm_get_document_memories',
  'prizm_document_versions',
  'prizm_find_related_documents',
  // 锁定与领取工具
  'prizm_checkout_document',
  'prizm_checkin_document',
  'prizm_claim_todo_list',
  'prizm_set_active_todo',
  'prizm_release_todo_list',
  'prizm_resource_status'
])
