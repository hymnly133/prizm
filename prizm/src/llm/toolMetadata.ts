/**
 * 工具元数据：用户友好显示名、文档链接、分类、scope 活动类型
 * 供客户端 ToolCallCard 与 活动时间线 使用
 */

export type ToolMetadataCategory =
  | 'note'
  | 'document'
  | 'todo'
  | 'clipboard'
  | 'notice'
  | 'search'
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
}

const TOOL_METADATA: Record<string, ToolMetadata> = {
  // === 便签 ===
  prizm_list_notes: {
    name: 'prizm_list_notes',
    displayName: '列出便签',
    category: 'note',
    scopeActivity: 'list',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_read_note: {
    name: 'prizm_read_note',
    displayName: '读取便签',
    category: 'note',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_get_note: {
    name: 'prizm_get_note',
    displayName: '读取便签',
    category: 'note',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_create_note: {
    name: 'prizm_create_note',
    displayName: '创建便签',
    category: 'note',
    scopeActivity: 'create',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_update_note: {
    name: 'prizm_update_note',
    displayName: '更新便签',
    category: 'note',
    scopeActivity: 'update',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_delete_note: {
    name: 'prizm_delete_note',
    displayName: '删除便签',
    category: 'note',
    scopeActivity: 'delete',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },
  prizm_search_notes: {
    name: 'prizm_search_notes',
    displayName: '搜索便签',
    category: 'note',
    scopeActivity: 'search',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#便签-notes'
  },

  // === 待办 ===
  prizm_list_todos: {
    name: 'prizm_list_todos',
    displayName: '列出待办',
    category: 'todo',
    scopeActivity: 'list',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_list_todo_list: {
    name: 'prizm_list_todo_list',
    displayName: '列出待办',
    category: 'todo',
    scopeActivity: 'list',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_list_todo_lists: {
    name: 'prizm_list_todo_lists',
    displayName: '列出所有待办列表',
    category: 'todo',
    scopeActivity: 'list',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_read_todo: {
    name: 'prizm_read_todo',
    displayName: '读取待办',
    category: 'todo',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_create_todo: {
    name: 'prizm_create_todo',
    displayName: '创建待办',
    category: 'todo',
    scopeActivity: 'create',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_update_todo: {
    name: 'prizm_update_todo',
    displayName: '更新待办',
    category: 'todo',
    scopeActivity: 'update',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_update_todo_list: {
    name: 'prizm_update_todo_list',
    displayName: '更新待办列表',
    category: 'todo',
    scopeActivity: 'update',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },
  prizm_delete_todo: {
    name: 'prizm_delete_todo',
    displayName: '删除待办',
    category: 'todo',
    scopeActivity: 'delete',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#任务-todo-列表'
  },

  // === 文档 ===
  prizm_list_documents: {
    name: 'prizm_list_documents',
    displayName: '列出文档',
    category: 'document',
    scopeActivity: 'list',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },
  prizm_get_document: {
    name: 'prizm_get_document',
    displayName: '读取文档',
    category: 'document',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },
  prizm_get_document_content: {
    name: 'prizm_get_document_content',
    displayName: '读取文档内容',
    category: 'document',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },
  prizm_create_document: {
    name: 'prizm_create_document',
    displayName: '创建文档',
    category: 'document',
    scopeActivity: 'create',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },
  prizm_update_document: {
    name: 'prizm_update_document',
    displayName: '更新文档',
    category: 'document',
    scopeActivity: 'update',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },
  prizm_delete_document: {
    name: 'prizm_delete_document',
    displayName: '删除文档',
    category: 'document',
    scopeActivity: 'delete',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#文档-documents'
  },

  // === 剪贴板 ===
  prizm_get_clipboard: {
    name: 'prizm_get_clipboard',
    displayName: '获取剪贴板',
    category: 'clipboard',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#剪贴板-clipboard'
  },
  prizm_add_clipboard_item: {
    name: 'prizm_add_clipboard_item',
    displayName: '添加剪贴板',
    category: 'clipboard',
    scopeActivity: 'create',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#剪贴板-clipboard'
  },
  prizm_get_clipboard_item: {
    name: 'prizm_get_clipboard_item',
    displayName: '获取剪贴板项',
    category: 'clipboard',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#剪贴板-clipboard'
  },
  prizm_delete_clipboard_item: {
    name: 'prizm_delete_clipboard_item',
    displayName: '删除剪贴板项',
    category: 'clipboard',
    scopeActivity: 'delete',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#剪贴板-clipboard'
  },

  // === 搜索 ===
  prizm_search: {
    name: 'prizm_search',
    displayName: '工作区搜索',
    category: 'search',
    scopeActivity: 'search',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md'
  },
  prizm_scope_stats: {
    name: 'prizm_scope_stats',
    displayName: '工作区统计',
    category: 'search',
    scopeActivity: 'read',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md'
  },

  // === 通知 ===
  prizm_notice: {
    name: 'prizm_notice',
    displayName: '发送通知',
    category: 'notice',
    scopeActivity: 'none',
    docUrl: 'https://github.com/prizm-project/prizm/blob/main/prizm/MCP-CONFIG.md#通知-notification'
  },

  // === Tavily 联网搜索 ===
  tavily_web_search: {
    name: 'tavily_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external',
    scopeActivity: 'none',
    docUrl: 'https://tavily.com'
  }
}

export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return TOOL_METADATA[toolName]
}

export function getToolDisplayName(toolName: string): string {
  return TOOL_METADATA[toolName]?.displayName ?? toolName
}

export function getAllToolMetadata(): ToolMetadata[] {
  return Object.values(TOOL_METADATA)
}
