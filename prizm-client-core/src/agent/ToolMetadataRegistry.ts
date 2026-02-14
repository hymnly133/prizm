/**
 * 工具元数据注册表 - 用户友好显示名等
 * 可优先从 API getAgentToolsMetadata 拉取，此处为 fallback
 */

import type { ToolCallRecord } from '../types'

export interface ToolMetadata {
  name: string
  displayName: string
  description?: string
  docUrl?: string
  category?: string
  scopeActivity?: string
}

const FALLBACK_METADATA: Record<string, ToolMetadata> = {
  prizm_list_notes: { name: 'prizm_list_notes', displayName: '列出便签', category: 'note' },
  prizm_read_note: { name: 'prizm_read_note', displayName: '读取便签', category: 'note' },
  prizm_get_note: { name: 'prizm_get_note', displayName: '读取便签', category: 'note' },
  prizm_create_note: { name: 'prizm_create_note', displayName: '创建便签', category: 'note' },
  prizm_update_note: { name: 'prizm_update_note', displayName: '更新便签', category: 'note' },
  prizm_delete_note: { name: 'prizm_delete_note', displayName: '删除便签', category: 'note' },
  prizm_search_notes: { name: 'prizm_search_notes', displayName: '搜索便签', category: 'note' },
  prizm_list_todos: { name: 'prizm_list_todos', displayName: '列出待办', category: 'todo' },
  prizm_list_todo_list: { name: 'prizm_list_todo_list', displayName: '列出待办', category: 'todo' },
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
  prizm_search: { name: 'prizm_search', displayName: '工作区搜索', category: 'search' },
  prizm_scope_stats: { name: 'prizm_scope_stats', displayName: '工作区统计', category: 'search' },
  prizm_notice: { name: 'prizm_notice', displayName: '发送通知', category: 'notice' },
  tavily_web_search: {
    name: 'tavily_web_search',
    displayName: '联网搜索',
    description: '在互联网上搜索实时信息',
    category: 'external',
    docUrl: 'https://tavily.com'
  }
}

let metadataCache: Record<string, ToolMetadata> = { ...FALLBACK_METADATA }

export function getToolDisplayName(toolName: string): string {
  return metadataCache[toolName]?.displayName ?? toolName
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

export function isTavilyTool(name: string): boolean {
  return name === 'tavily_web_search'
}
