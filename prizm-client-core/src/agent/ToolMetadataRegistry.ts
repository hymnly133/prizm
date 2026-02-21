/**
 * 工具元数据注册表 - 用户友好显示名等
 * 可优先从 API getAgentToolsMetadata 拉取，此处为 fallback
 *
 * 复合工具支持通过 actionLabels 实现 action 感知显示名
 */

import type { ToolCallRecord } from '../types'

export interface ToolMetadata {
  name: string
  displayName: string
  description?: string
  docUrl?: string
  category?: string
  scopeActivity?: string
  /** 复合工具的 action → displayName 映射 */
  actionLabels?: Record<string, string>
}

/** 复合工具 action 映射 */
const COMPOUND_TOOLS: Record<
  string,
  { displayName: string; category: string; actionLabels: Record<string, string> }
> = {
  prizm_file: {
    displayName: '文件操作',
    category: 'file',
    actionLabels: {
      list: '列出文件',
      read: '读取文件',
      write: '写入文件',
      move: '移动/重命名文件',
      delete: '删除文件'
    }
  },
  prizm_todo: {
    displayName: '待办管理',
    category: 'todo',
    actionLabels: {
      list_items: '列出待办',
      list_lists: '列出待办列表',
      read: '读取待办',
      create: '创建待办',
      update: '更新待办',
      delete: '删除待办'
    }
  },
  prizm_document: {
    displayName: '文档管理',
    category: 'document',
    actionLabels: {
      list: '列出文档',
      read: '读取文档',
      create: '创建文档',
      update: '更新文档',
      delete: '删除文档'
    }
  },
  prizm_search: {
    displayName: '搜索',
    category: 'search',
    actionLabels: {
      keyword: '关键词搜索',
      memory: '记忆搜索',
      hybrid: '混合搜索',
      stats: '工作区统计'
    }
  },
  prizm_knowledge: {
    displayName: '知识库查询',
    category: 'knowledge',
    actionLabels: {
      search: '记忆反向定位',
      memories: '文档记忆',
      versions: '版本历史',
      related: '相关文档',
      round_lookup: '对话轮追溯'
    }
  },
  prizm_lock: {
    displayName: '资源锁',
    category: 'lock',
    actionLabels: {
      checkout: '签出文档',
      checkin: '签入文档',
      claim: '领取待办列表',
      set_active: '设置进行中',
      release: '释放待办列表',
      status: '查询锁状态'
    }
  },
  prizm_schedule: {
    displayName: '日程管理',
    category: 'other',
    actionLabels: {
      list: '列出日程',
      read: '查看日程',
      create: '创建日程',
      update: '更新日程',
      delete: '删除日程',
      link: '关联资源',
      unlink: '解除关联'
    }
  },
  prizm_cron: {
    displayName: '定时任务',
    category: 'other',
    actionLabels: {
      list: '列出定时任务',
      create: '创建定时任务',
      update: '更新定时任务',
      delete: '删除定时任务',
      pause: '暂停定时任务',
      resume: '恢复定时任务',
      trigger: '手动触发',
      logs: '执行日志'
    }
  }
}

const FALLBACK_METADATA: Record<string, ToolMetadata> = {
  // 复合工具
  ...Object.fromEntries(
    Object.entries(COMPOUND_TOOLS).map(([name, v]) => [
      name,
      { name, displayName: v.displayName, category: v.category, actionLabels: v.actionLabels }
    ])
  ),
  // 独立工具
  prizm_promote_file: {
    name: 'prizm_promote_file',
    displayName: '提升到主工作区',
    category: 'document'
  },
  prizm_terminal_execute: {
    name: 'prizm_terminal_execute',
    displayName: '执行命令',
    category: 'terminal'
  },
  prizm_terminal_spawn: {
    name: 'prizm_terminal_spawn',
    displayName: '创建终端',
    category: 'terminal'
  },
  prizm_terminal_send_keys: {
    name: 'prizm_terminal_send_keys',
    displayName: '终端输入',
    category: 'terminal'
  },
  // 旧工具名兼容（历史 session 中可能存在的 tool call）
  prizm_tool_guide: { name: 'prizm_tool_guide', displayName: '工具指南', category: 'other' },
  prizm_file_list: { name: 'prizm_file_list', displayName: '列出文件', category: 'file' },
  prizm_file_read: { name: 'prizm_file_read', displayName: '读取文件', category: 'file' },
  prizm_file_write: { name: 'prizm_file_write', displayName: '写入文件', category: 'file' },
  prizm_file_move: { name: 'prizm_file_move', displayName: '移动/重命名文件', category: 'file' },
  prizm_file_delete: { name: 'prizm_file_delete', displayName: '删除文件', category: 'file' },
  prizm_list_todos: { name: 'prizm_list_todos', displayName: '列出待办', category: 'todo' },
  prizm_list_todo_list: { name: 'prizm_list_todo_list', displayName: '列出待办', category: 'todo' },
  prizm_list_todo_lists: {
    name: 'prizm_list_todo_lists',
    displayName: '列出待办列表',
    category: 'todo'
  },
  prizm_read_todo: { name: 'prizm_read_todo', displayName: '读取待办', category: 'todo' },
  prizm_create_todo: { name: 'prizm_create_todo', displayName: '创建待办', category: 'todo' },
  prizm_update_todo: { name: 'prizm_update_todo', displayName: '更新待办', category: 'todo' },
  prizm_update_todo_list: {
    name: 'prizm_update_todo_list',
    displayName: '更新待办列表',
    category: 'todo'
  },
  prizm_delete_todo: { name: 'prizm_delete_todo', displayName: '删除待办', category: 'todo' },
  prizm_list_documents: {
    name: 'prizm_list_documents',
    displayName: '列出文档',
    category: 'document'
  },
  prizm_get_document: { name: 'prizm_get_document', displayName: '读取文档', category: 'document' },
  prizm_get_document_content: {
    name: 'prizm_get_document_content',
    displayName: '读取文档内容',
    category: 'document'
  },
  prizm_create_document: {
    name: 'prizm_create_document',
    displayName: '创建文档',
    category: 'document'
  },
  prizm_update_document: {
    name: 'prizm_update_document',
    displayName: '更新文档',
    category: 'document'
  },
  prizm_delete_document: {
    name: 'prizm_delete_document',
    displayName: '删除文档',
    category: 'document'
  },
  prizm_get_clipboard: {
    name: 'prizm_get_clipboard',
    displayName: '获取剪贴板',
    category: 'clipboard'
  },
  prizm_add_clipboard_item: {
    name: 'prizm_add_clipboard_item',
    displayName: '添加剪贴板',
    category: 'clipboard'
  },
  prizm_get_clipboard_item: {
    name: 'prizm_get_clipboard_item',
    displayName: '获取剪贴板项',
    category: 'clipboard'
  },
  prizm_delete_clipboard_item: {
    name: 'prizm_delete_clipboard_item',
    displayName: '删除剪贴板项',
    category: 'clipboard'
  },
  prizm_scope_stats: { name: 'prizm_scope_stats', displayName: '工作区统计', category: 'search' },
  prizm_list_memories: { name: 'prizm_list_memories', displayName: '列出记忆', category: 'memory' },
  prizm_search_memories: {
    name: 'prizm_search_memories',
    displayName: '搜索记忆',
    category: 'memory'
  },
  prizm_notice: { name: 'prizm_notice', displayName: '发送通知', category: 'notice' },
  prizm_spawn_task: { name: 'prizm_spawn_task', displayName: '派发子任务', category: 'other' },
  prizm_task_status: { name: 'prizm_task_status', displayName: '查询任务状态', category: 'other' },
  prizm_set_result: {
    name: 'prizm_set_result',
    displayName: '提交任务结果',
    description:
      '在后台/工作流会话中，实际参数由会话 schema 决定，可能仅包含当前步骤要求的单字段（如 output），与默认的「内容 + 结构化」不同。',
    category: 'other'
  },
  prizm_workflow: { name: 'prizm_workflow', displayName: '工作流', category: 'other' },
  prizm_web_search: {
    name: 'prizm_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external'
  },
  prizm_web_fetch: {
    name: 'prizm_web_fetch',
    displayName: '网页抓取',
    description: '抓取指定 URL 的网页内容',
    category: 'external'
  },
  tavily_web_search: {
    name: 'tavily_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external'
  }
}

let metadataCache: Record<string, ToolMetadata> = { ...FALLBACK_METADATA }

/**
 * 获取工具显示名。复合工具自动解析 action 参数显示更具体的名称。
 */
export function getToolDisplayName(toolName: string, argsJson?: string): string {
  const meta = metadataCache[toolName]
  if (!meta) return toolName

  if (meta.actionLabels && argsJson) {
    try {
      const obj = JSON.parse(argsJson) as Record<string, unknown>
      const action = String(obj.action ?? obj.mode ?? '')
      if (action && meta.actionLabels[action]) return meta.actionLabels[action]
    } catch {
      /* ignore parse errors */
    }
  }
  return meta.displayName
}

export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return metadataCache[toolName]
}

export function setToolMetadata(tools: ToolMetadata[]): void {
  const next: Record<string, ToolMetadata> = { ...FALLBACK_METADATA }
  for (const t of tools) {
    next[t.name] = t
  }
  metadataCache = next
}

export function isPrizmTool(name: string): boolean {
  return name.startsWith('prizm_')
}

export function isWebSearchTool(name: string): boolean {
  return name === 'prizm_web_search' || name === 'prizm_web_fetch' || name === 'tavily_web_search'
}

/** @deprecated Use isWebSearchTool instead */
export function isTavilyTool(name: string): boolean {
  return isWebSearchTool(name)
}
