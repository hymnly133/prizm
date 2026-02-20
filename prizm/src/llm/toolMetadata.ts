/**
 * 工具元数据：用户友好显示名、文档链接、分类、scope 活动类型
 * 供客户端 ToolCallCard 与 活动时间线 使用
 *
 * 复合工具的 displayName 为通用名（如"文件操作"），
 * 客户端通过解析 args.action 展示更具体的操作名。
 */

export type ToolMetadataCategory =
  | 'file'
  | 'note'
  | 'document'
  | 'todo'
  | 'clipboard'
  | 'notice'
  | 'search'
  | 'memory'
  | 'knowledge'
  | 'lock'
  | 'terminal'
  | 'external'
  | 'other'

export type ScopeActivityActionMeta =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'search'
  | 'none'

export interface ToolMetadata {
  name: string
  displayName: string
  description?: string
  docUrl?: string
  category?: ToolMetadataCategory
  scopeActivity?: ScopeActivityActionMeta
  /** 复合工具的 action → displayName 映射 */
  actionLabels?: Record<string, string>
}

const TOOL_METADATA: Record<string, ToolMetadata> = {
  // === 复合工具 ===
  prizm_file: {
    name: 'prizm_file',
    displayName: '文件操作',
    category: 'file',
    scopeActivity: 'none',
    actionLabels: {
      list: '列出文件',
      read: '读取文件',
      write: '写入文件',
      move: '移动/重命名文件',
      delete: '删除文件'
    }
  },
  prizm_todo: {
    name: 'prizm_todo',
    displayName: '待办管理',
    category: 'todo',
    scopeActivity: 'none',
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
    name: 'prizm_document',
    displayName: '文档管理',
    category: 'document',
    scopeActivity: 'none',
    actionLabels: {
      list: '列出文档',
      read: '读取文档',
      create: '创建文档',
      update: '更新文档',
      delete: '删除文档'
    }
  },
  prizm_search: {
    name: 'prizm_search',
    displayName: '搜索',
    category: 'search',
    scopeActivity: 'search',
    actionLabels: {
      keyword: '关键词搜索',
      memory: '记忆搜索',
      stats: '工作区统计'
    }
  },
  prizm_knowledge: {
    name: 'prizm_knowledge',
    displayName: '知识库查询',
    category: 'knowledge',
    scopeActivity: 'search',
    actionLabels: {
      search: '记忆反向定位',
      memories: '文档记忆',
      versions: '版本历史',
      related: '相关文档'
    }
  },
  prizm_lock: {
    name: 'prizm_lock',
    displayName: '资源锁',
    category: 'lock',
    scopeActivity: 'none',
    actionLabels: {
      checkout: '签出文档',
      checkin: '签入文档',
      claim: '领取待办列表',
      set_active: '设置进行中',
      release: '释放待办列表',
      status: '查询锁状态'
    }
  },
  prizm_promote_file: {
    name: 'prizm_promote_file',
    displayName: '提升到主工作区',
    category: 'document',
    scopeActivity: 'update'
  },

  // === 终端 ===
  prizm_terminal_execute: {
    name: 'prizm_terminal_execute',
    displayName: '执行命令',
    category: 'terminal',
    scopeActivity: 'none'
  },
  prizm_terminal_spawn: {
    name: 'prizm_terminal_spawn',
    displayName: '创建终端',
    category: 'terminal',
    scopeActivity: 'none'
  },
  prizm_terminal_send_keys: {
    name: 'prizm_terminal_send_keys',
    displayName: '终端输入',
    category: 'terminal',
    scopeActivity: 'none'
  },

  // === 旧工具名兼容（历史 session 中可能存在） ===
  prizm_file_list: {
    name: 'prizm_file_list',
    displayName: '列出文件',
    category: 'file',
    scopeActivity: 'list'
  },
  prizm_file_read: {
    name: 'prizm_file_read',
    displayName: '读取文件',
    category: 'file',
    scopeActivity: 'read'
  },
  prizm_file_write: {
    name: 'prizm_file_write',
    displayName: '写入文件',
    category: 'file',
    scopeActivity: 'create'
  },
  prizm_file_move: {
    name: 'prizm_file_move',
    displayName: '移动/重命名文件',
    category: 'file',
    scopeActivity: 'update'
  },
  prizm_file_delete: {
    name: 'prizm_file_delete',
    displayName: '删除文件',
    category: 'file',
    scopeActivity: 'delete'
  },
  prizm_list_todos: {
    name: 'prizm_list_todos',
    displayName: '列出待办',
    category: 'todo',
    scopeActivity: 'list'
  },
  prizm_list_todo_lists: {
    name: 'prizm_list_todo_lists',
    displayName: '列出待办列表',
    category: 'todo',
    scopeActivity: 'list'
  },
  prizm_read_todo: {
    name: 'prizm_read_todo',
    displayName: '读取待办',
    category: 'todo',
    scopeActivity: 'read'
  },
  prizm_create_todo: {
    name: 'prizm_create_todo',
    displayName: '创建待办',
    category: 'todo',
    scopeActivity: 'create'
  },
  prizm_update_todo: {
    name: 'prizm_update_todo',
    displayName: '更新待办',
    category: 'todo',
    scopeActivity: 'update'
  },
  prizm_delete_todo: {
    name: 'prizm_delete_todo',
    displayName: '删除待办',
    category: 'todo',
    scopeActivity: 'delete'
  },
  prizm_list_documents: {
    name: 'prizm_list_documents',
    displayName: '列出文档',
    category: 'document',
    scopeActivity: 'list'
  },
  prizm_get_document_content: {
    name: 'prizm_get_document_content',
    displayName: '读取文档',
    category: 'document',
    scopeActivity: 'read'
  },
  prizm_create_document: {
    name: 'prizm_create_document',
    displayName: '创建文档',
    category: 'document',
    scopeActivity: 'create'
  },
  prizm_update_document: {
    name: 'prizm_update_document',
    displayName: '更新文档',
    category: 'document',
    scopeActivity: 'update'
  },
  prizm_delete_document: {
    name: 'prizm_delete_document',
    displayName: '删除文档',
    category: 'document',
    scopeActivity: 'delete'
  },
  prizm_scope_stats: {
    name: 'prizm_scope_stats',
    displayName: '工作区统计',
    category: 'search',
    scopeActivity: 'read'
  },
  prizm_list_memories: {
    name: 'prizm_list_memories',
    displayName: '列出记忆',
    category: 'memory',
    scopeActivity: 'list'
  },
  prizm_search_memories: {
    name: 'prizm_search_memories',
    displayName: '搜索记忆',
    category: 'memory',
    scopeActivity: 'search'
  },

  // === 便签（MCP 工具，非内置） ===
  prizm_list_notes: {
    name: 'prizm_list_notes',
    displayName: '列出便签',
    category: 'note',
    scopeActivity: 'list'
  },
  prizm_read_note: {
    name: 'prizm_read_note',
    displayName: '读取便签',
    category: 'note',
    scopeActivity: 'read'
  },
  prizm_get_note: {
    name: 'prizm_get_note',
    displayName: '读取便签',
    category: 'note',
    scopeActivity: 'read'
  },
  prizm_create_note: {
    name: 'prizm_create_note',
    displayName: '创建便签',
    category: 'note',
    scopeActivity: 'create'
  },
  prizm_update_note: {
    name: 'prizm_update_note',
    displayName: '更新便签',
    category: 'note',
    scopeActivity: 'update'
  },
  prizm_delete_note: {
    name: 'prizm_delete_note',
    displayName: '删除便签',
    category: 'note',
    scopeActivity: 'delete'
  },
  prizm_search_notes: {
    name: 'prizm_search_notes',
    displayName: '搜索便签',
    category: 'note',
    scopeActivity: 'search'
  },

  // === 剪贴板 ===
  prizm_get_clipboard: {
    name: 'prizm_get_clipboard',
    displayName: '获取剪贴板',
    category: 'clipboard',
    scopeActivity: 'read'
  },
  prizm_add_clipboard_item: {
    name: 'prizm_add_clipboard_item',
    displayName: '添加剪贴板',
    category: 'clipboard',
    scopeActivity: 'create'
  },
  prizm_get_clipboard_item: {
    name: 'prizm_get_clipboard_item',
    displayName: '获取剪贴板项',
    category: 'clipboard',
    scopeActivity: 'read'
  },
  prizm_delete_clipboard_item: {
    name: 'prizm_delete_clipboard_item',
    displayName: '删除剪贴板项',
    category: 'clipboard',
    scopeActivity: 'delete'
  },

  // === 通知 ===
  prizm_notice: {
    name: 'prizm_notice',
    displayName: '发送通知',
    category: 'notice',
    scopeActivity: 'none'
  },

  // === 日程管理 ===
  prizm_schedule: {
    name: 'prizm_schedule',
    displayName: '日程管理',
    category: 'other',
    scopeActivity: 'none',
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

  // === 定时任务 ===
  prizm_cron: {
    name: 'prizm_cron',
    displayName: '定时任务',
    category: 'other',
    scopeActivity: 'none',
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
  },

  // === 联网搜索 ===
  prizm_web_search: {
    name: 'prizm_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external',
    scopeActivity: 'none'
  },
  prizm_web_fetch: {
    name: 'prizm_web_fetch',
    displayName: '网页抓取',
    description: '抓取指定 URL 的网页内容',
    category: 'external',
    scopeActivity: 'none'
  },
  /** @deprecated 旧名称兼容 */
  tavily_web_search: {
    name: 'tavily_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external',
    scopeActivity: 'none'
  }
}

export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return TOOL_METADATA[toolName]
}

/**
 * 获取工具显示名。复合工具支持通过 action 参数获取更具体的名称。
 */
export function getToolDisplayName(toolName: string, action?: string): string {
  const meta = TOOL_METADATA[toolName]
  if (!meta) return toolName
  if (action && meta.actionLabels?.[action]) return meta.actionLabels[action]
  return meta.displayName
}

export function getAllToolMetadata(): ToolMetadata[] {
  return Object.values(TOOL_METADATA)
}
