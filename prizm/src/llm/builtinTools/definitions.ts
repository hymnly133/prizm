/**
 * 内置工具定义：tool() 辅助函数与 getBuiltinTools()
 *
 * 复合工具设计：同类 CRUD 操作通过 action enum 合并为单一工具，
 * 参考 v0 TodoManager、Notion update-page、Replit str_replace_editor 模式。
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

/** workspace 参数：选择操作的工作区（仅在使用相对路径时生效） */
export const WORKSPACE_PARAM: ToolPropertyDef = {
  type: 'string',
  description:
    '"main"（默认）/ "session"（临时工作区）/ "workflow"（工作流工作区，仅在工作流上下文中有效）',
  enum: ['main', 'session', 'workflow']
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
          itemId: {
            type: 'string',
            description: '条目 UUID (update_item/delete_item)，通过 list 获取'
          },
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
      '工作区关键词搜索。action: keyword(搜索文档/待办/剪贴板)/stats(工作区统计)。语义/记忆搜索请用 prizm_knowledge。',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
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
        required: ['action']
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

    // ── 资源锁（复合） ──
    tool(
      'prizm_lock',
      '资源锁管理。文档编辑流程: checkout→edit→checkin，编辑完务必释放。action: checkout(签出文档获取编辑锁)/checkin(释放文档锁)/claim(领取待办列表)/set_active(设置待办为进行中)/release(释放待办列表)/status(查询锁定状态)',
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
    tool(
      'prizm_promote_file',
      '将临时工作区(session)或工作流工作区(workflow)中的文档/待办提升到主工作区。仅对非主工作区创建的文件有效，主工作区文件无需提升。',
      {
        properties: {
          fileId: { type: 'string', description: '文档或待办列表 ID' },
          folder: { type: 'string', description: '目标目录' }
        },
        required: ['fileId']
      }
    ),

    // ── 终端工具（独立） ──
    tool(
      'prizm_terminal_execute',
      '执行一次性 shell 命令（ls、git、npm 等）并返回输出。交互/长期进程请用 spawn。',
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
    tool(
      'prizm_terminal_spawn',
      '创建持久终端（dev server、watch、REPL 等长期进程），用 send_keys 交互。返回终端 ID。',
      {
        properties: {
          cwd: { type: 'string', description: '工作目录（相对路径），默认根目录' },
          workspace: WORKSPACE_PARAM,
          title: { type: 'string', description: '终端标题' }
        },
        required: []
      }
    ),
    tool(
      'prizm_terminal_send_keys',
      '向持久终端发送输入。pressEnter=true（默认）自动按回车执行，false 仅键入。不要在 input 中加 \\n/\\r。',
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

    // ── 后台任务工具 ──
    tool(
      'prizm_set_result',
      '提交当前后台会话的执行结果。在工作流中，output 会自动传递给下一步骤作为输入。仅在后台任务/工作流会话中有效。',
      {
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
      }
    ),

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

    // ── 日程管理（复合） ──
    tool(
      'prizm_schedule',
      '日程管理。action: list(列出,可按日期范围)/read(详情)/create(创建)/update(更新)/delete(删除)/link(关联todo或文档)/unlink(解除关联)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'read', 'create', 'update', 'delete', 'link', 'unlink']
          },
          scheduleId: { type: 'string', description: '日程 ID (read/update/delete/link/unlink)' },
          title: { type: 'string', description: '标题 (create/update)' },
          description: { type: 'string', description: '描述 (create/update)' },
          type: {
            type: 'string',
            description: '日程类型 (create/update)',
            enum: ['event', 'reminder', 'deadline']
          },
          startTime: { type: 'string', description: 'ISO 日期时间 (create/update)' },
          endTime: { type: 'string', description: 'ISO 日期时间 (create/update)' },
          allDay: { type: 'boolean', description: '全天事件 (create/update)' },
          recurrence: { type: 'string', description: 'JSON: {frequency,interval,...} (create)' },
          reminders: {
            type: 'array',
            description: '提前N分钟提醒数组 (create/update)',
            items: { type: 'number' }
          },
          status: {
            type: 'string',
            description: '状态 (update)',
            enum: ['upcoming', 'active', 'completed', 'cancelled']
          },
          tags: {
            type: 'array',
            description: '标签 (create/update)',
            items: { type: 'string' }
          },
          linkedType: {
            type: 'string',
            description: '关联类型 (link/unlink)',
            enum: ['todo', 'document']
          },
          linkedId: { type: 'string', description: '关联目标 ID (link/unlink)' },
          from: { type: 'string', description: '查询起始日期 ISO (list)' },
          to: { type: 'string', description: '查询截止日期 ISO (list)' }
        },
        required: ['action']
      }
    ),

    // ── 定时任务（复合） ──
    tool(
      'prizm_cron',
      '定时任务管理。action: list(列出)/create(创建)/update(更新)/delete(删除)/pause(暂停)/resume(恢复)/trigger(手动触发)/logs(执行日志)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['list', 'create', 'update', 'delete', 'pause', 'resume', 'trigger', 'logs']
          },
          jobId: {
            type: 'string',
            description: '任务 ID (update/delete/pause/resume/trigger/logs)'
          },
          name: { type: 'string', description: '任务名称 (create/update)' },
          description: { type: 'string', description: '任务描述 (create/update)' },
          schedule: {
            type: 'string',
            description:
              'cron 表达式(如 "0 9 * * *")或一次性时间("once:2026-03-01T09:00:00") (create/update)'
          },
          taskPrompt: { type: 'string', description: '执行时发给 Agent 的指令 (create/update)' },
          timezone: { type: 'string', description: 'IANA 时区 (create/update)' },
          model: { type: 'string', description: '指定 LLM 模型 (create/update)' },
          timeout_seconds: { type: 'number', description: '超时秒数 (create)' },
          status: {
            type: 'string',
            description: '过滤状态 (list)',
            enum: ['active', 'paused', 'completed', 'failed']
          }
        },
        required: ['action']
      }
    ),

    // ── 工作流构建器（Tool LLM 桥接） ──
    tool(
      'prizm_workflow_builder',
      '启动工作流构建器。创建新工作流用 build，修改已有工作流用 edit。结果通过内联卡片展示给用户，用户可在卡片内多轮微调。',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['build', 'edit']
          },
          intent: {
            type: 'string',
            description: '用户的需求描述（创建什么工作流/如何修改）'
          },
          workflow_name: {
            type: 'string',
            description: '工作流名称（edit 时必需，指定要修改的已有工作流）'
          },
          context: {
            type: 'string',
            description: '来自当前对话的相关上下文信息'
          }
        },
        required: ['action', 'intent']
      }
    ),

    // ── 工作流引擎（复合） ──
    tool(
      'prizm_workflow',
      '工作流引擎：确定性多步管线 + 审批门控 + 可恢复执行。action: run(异步启动)/resume(恢复审批)/list(列出运行)/status(查看详情)/cancel(取消)/register(注册定义)/list_defs(列出定义)/get_def(查看完整定义及参数)',
      {
        properties: {
          action: {
            type: 'string',
            description: '操作类型',
            enum: ['run', 'resume', 'list', 'status', 'cancel', 'register', 'list_defs', 'get_def']
          },
          workflow_name: {
            type: 'string',
            description: '工作流名称 (run/get_def: 已注册工作流名/register: 新定义名)'
          },
          def_id: { type: 'string', description: '工作流定义 ID (get_def)' },
          yaml: {
            type: 'string',
            description:
              '工作流 YAML 定义。顶层: name, steps[], description?, args?, outputs?, triggers?, config?({errorStrategy,workspaceMode,maxTotalTimeoutMs,notifyOnComplete,notifyOnFail})。每个 step 必须含 type(agent/approve/transform)，id 可省略。agent 需 prompt，approve 需 approvePrompt，transform 需 transform 表达式。step 可选: description, input, condition, model, timeoutMs, sessionConfig({thinking,skills,allowedTools,outputSchema}), retryConfig({maxRetries,retryDelayMs}), linkedActions。input 省略时自动继承上一步输出（隐式管道）；显式引用: $prev.output 或 $stepId.output'
          },
          run_id: { type: 'string', description: '运行 ID (status/cancel)' },
          resume_token: { type: 'string', description: '恢复令牌 (resume)' },
          approved: { type: 'boolean', description: '审批结果 (resume, 默认 true)' },
          args: { type: 'string', description: 'JSON 格式工作流参数 (run)' },
          description: { type: 'string', description: '工作流描述 (register)' }
        },
        required: ['action']
      }
    )
  ]
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
  'prizm_schedule',
  'prizm_cron',
  'prizm_workflow',
  'prizm_workflow_builder'
])
