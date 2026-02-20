/**
 * 工具分组定义与过滤逻辑
 *
 * 将内置工具按功能领域分组，支持按组开关配置。
 * 分组仅影响工具是否传给 LLM，不影响工具执行权限。
 */

import type { LLMTool } from '../../adapters/interfaces'
import type { SessionKind } from '@prizm/shared'

/** 工具分组开关配置：groupId → enabled */
export type ToolGroupConfig = Record<string, boolean>

/** 工具分组定义 */
export interface ToolGroup {
  id: string
  label: string
  description: string
  /** 组内工具名列表 */
  tools: string[]
  /** 默认启用状态 */
  defaultEnabled: boolean
  /** 仅在特定 session 类型下出现（未指定则所有类型均可见） */
  sessionKindFilter?: SessionKind[]
}

/** 内置工具分组定义 */
export const BUILTIN_TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'workspace',
    label: '文件与工作区',
    description: '文件读写、列目录、移动/删除，以及临时文件提升到主工作区',
    tools: ['prizm_file', 'prizm_promote_file'],
    defaultEnabled: true
  },
  {
    id: 'document',
    label: '文档管理',
    description: '文档 CRUD 和资源锁（checkout/checkin 编辑流程）',
    tools: ['prizm_document', 'prizm_lock'],
    defaultEnabled: true
  },
  {
    id: 'todo',
    label: '待办管理',
    description: '待办列表和条目的增删改查',
    tools: ['prizm_todo'],
    defaultEnabled: true
  },
  {
    id: 'search',
    label: '搜索与知识',
    description: '关键词搜索、语义记忆搜索、知识库查询',
    tools: ['prizm_search', 'prizm_knowledge'],
    defaultEnabled: true
  },
  {
    id: 'terminal',
    label: '终端',
    description: '执行 shell 命令、创建持久终端、终端交互',
    tools: ['prizm_terminal_execute', 'prizm_terminal_spawn', 'prizm_terminal_send_keys'],
    defaultEnabled: true
  },
  {
    id: 'task',
    label: '后台任务',
    description: '派发子任务到后台执行、查询任务状态、提交执行结果',
    tools: ['prizm_set_result', 'prizm_spawn_task', 'prizm_task_status'],
    defaultEnabled: true
  },
  {
    id: 'schedule',
    label: '日程与定时',
    description: '日程管理和 Cron 定时任务',
    tools: ['prizm_schedule', 'prizm_cron'],
    defaultEnabled: true
  },
  {
    id: 'workflow',
    label: '工作流',
    description: '工作流引擎：注册、运行、审批、管理工作流定义和运行实例',
    tools: ['prizm_workflow'],
    defaultEnabled: true
  }
]

/** 工具名 → 所属分组 ID 的索引 */
const toolToGroupMap = new Map<string, string>()
for (const group of BUILTIN_TOOL_GROUPS) {
  for (const tool of group.tools) {
    toolToGroupMap.set(tool, group.id)
  }
}

/** 分组 ID → ToolGroup 的索引 */
const groupById = new Map<string, ToolGroup>()
for (const group of BUILTIN_TOOL_GROUPS) {
  groupById.set(group.id, group)
}

/** 获取工具所属的分组 ID */
export function getToolGroupId(toolName: string): string | undefined {
  return toolToGroupMap.get(toolName)
}

/** 获取分组定义 */
export function getToolGroup(groupId: string): ToolGroup | undefined {
  return groupById.get(groupId)
}

/** 获取所有分组定义 */
export function getAllToolGroups(): ToolGroup[] {
  return [...BUILTIN_TOOL_GROUPS]
}

/**
 * 根据分组配置和 session 类型过滤工具列表。
 *
 * 过滤顺序：
 * 1. 检查工具所属分组的启用状态（config > defaultEnabled）
 * 2. 检查分组的 sessionKindFilter（如有）
 * 3. 不属于任何分组的工具（如动态添加的 MCP/Web 工具）始终保留
 */
export function filterToolsByGroups(
  tools: LLMTool[],
  groupConfig: ToolGroupConfig | undefined,
  sessionKind?: SessionKind
): LLMTool[] {
  return tools.filter((tool) => {
    const toolName = tool.function.name
    const groupId = toolToGroupMap.get(toolName)

    if (!groupId) return true

    const group = groupById.get(groupId)
    if (!group) return true

    const enabled = groupConfig?.[groupId] ?? group.defaultEnabled
    if (!enabled) return false

    if (group.sessionKindFilter && sessionKind) {
      if (!group.sessionKindFilter.includes(sessionKind)) return false
    }

    return true
  })
}

/**
 * 合并分组配置与默认值，返回完整的分组状态。
 * 用于 API 响应，让客户端知道每个分组的实际启用状态。
 */
export function resolveGroupStates(
  groupConfig: ToolGroupConfig | undefined
): Array<{ id: string; label: string; description: string; tools: string[]; enabled: boolean }> {
  return BUILTIN_TOOL_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    tools: group.tools,
    enabled: groupConfig?.[group.id] ?? group.defaultEnabled
  }))
}
