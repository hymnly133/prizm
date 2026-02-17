/**
 * 从工具调用解析 Scope 活动记录
 * 用于 AgentRightSidebar 展示「正在读取 / 已读 / 已创建 / 已更新 / 已删除」等
 */

import type { ScopeActivityRecord, ScopeActivityAction, ScopeActivityItemKind } from '@prizm/shared'

export type { ScopeActivityRecord, ScopeActivityAction, ScopeActivityItemKind }

/** 工具调用记录（与 MessagePartTool / ToolCallRecord 兼容） */
export interface ToolCallInput {
  id: string
  name: string
  arguments: string
  result: string
}

/** 不产生 scope 交互的工具 */
const NO_SCOPE_TOOLS = new Set(['prizm_notice', 'tavily_web_search', 'prizm_scope_stats'])

/** 从 result 提取 ID 的正则：已创建/更新/删除 xxx {id} */
const ID_FROM_RESULT = /(?:已创建|已更新|已删除)(?:便签|待办项|文档|剪贴板项?)\s+([a-zA-Z0-9_-]+)/

function safeParseJson<T = Record<string, unknown>>(str: string): T | null {
  if (!str || typeof str !== 'string') return null
  try {
    return JSON.parse(str) as T
  } catch {
    return null
  }
}

function extractIdFromResult(result: string): string | undefined {
  const m = result.match(ID_FROM_RESULT)
  return m?.[1]
}

/**
 * 从会话中收集的 toolCalls 解析出统一 scope 活动记录列表
 */
export function deriveScopeActivities(
  toolCalls: ToolCallInput[],
  messageCreatedAt?: number
): ScopeActivityRecord[] {
  const out: ScopeActivityRecord[] = []
  const ts = messageCreatedAt ?? Date.now()

  for (const tc of toolCalls) {
    const name = tc.name
    if (NO_SCOPE_TOOLS.has(name)) continue

    const args = safeParseJson<Record<string, unknown>>(tc.arguments) ?? {}
    const result = tc.result ?? ''

    switch (name) {
      // === 便签 ===
      case 'prizm_read_note':
      case 'prizm_get_note':
        out.push({
          toolName: name,
          action: 'read',
          itemKind: 'document',
          itemId: (args.noteId ?? args.id) as string,
          timestamp: ts
        })
        break
      case 'prizm_list_notes':
        out.push({ toolName: name, action: 'list', itemKind: 'document', timestamp: ts })
        break
      case 'prizm_create_note':
        out.push({
          toolName: name,
          action: 'create',
          itemKind: 'document',
          itemId: extractIdFromResult(result),
          title: '便签',
          timestamp: ts
        })
        break
      case 'prizm_update_note':
        out.push({
          toolName: name,
          action: 'update',
          itemKind: 'document',
          itemId: args.noteId as string,
          timestamp: ts
        })
        break
      case 'prizm_delete_note':
        out.push({
          toolName: name,
          action: 'delete',
          itemKind: 'document',
          itemId: args.noteId as string,
          timestamp: ts
        })
        break
      case 'prizm_search_notes':
        out.push({ toolName: name, action: 'search', itemKind: 'document', timestamp: ts })
        break

      // === 待办 ===
      case 'prizm_read_todo':
        out.push({
          toolName: name,
          action: 'read',
          itemKind: 'todo',
          itemId: args.todoId as string,
          timestamp: ts
        })
        break
      case 'prizm_list_todos':
      case 'prizm_list_todo_list':
      case 'prizm_list_todo_lists':
        out.push({ toolName: name, action: 'list', itemKind: 'todo', timestamp: ts })
        break
      case 'prizm_create_todo':
        out.push({
          toolName: name,
          action: 'create',
          itemKind: 'todo',
          itemId: extractIdFromResult(result),
          title: args.title as string,
          timestamp: ts
        })
        break
      case 'prizm_update_todo':
      case 'prizm_update_todo_list':
        out.push({
          toolName: name,
          action: 'update',
          itemKind: 'todo',
          itemId: args.todoId as string,
          timestamp: ts
        })
        break
      case 'prizm_delete_todo':
        out.push({
          toolName: name,
          action: 'delete',
          itemKind: 'todo',
          itemId: args.todoId as string,
          timestamp: ts
        })
        break

      // === 文档 ===
      case 'prizm_get_document':
      case 'prizm_get_document_content':
        out.push({
          toolName: name,
          action: 'read',
          itemKind: 'document',
          itemId: (args.documentId ?? args.id) as string,
          timestamp: ts
        })
        break
      case 'prizm_list_documents':
        out.push({ toolName: name, action: 'list', itemKind: 'document', timestamp: ts })
        break
      case 'prizm_create_document':
        out.push({
          toolName: name,
          action: 'create',
          itemKind: 'document',
          itemId: extractIdFromResult(result),
          title: args.title as string,
          timestamp: ts
        })
        break
      case 'prizm_update_document':
        out.push({
          toolName: name,
          action: 'update',
          itemKind: 'document',
          itemId: args.documentId as string,
          timestamp: ts
        })
        break
      case 'prizm_delete_document':
        out.push({
          toolName: name,
          action: 'delete',
          itemKind: 'document',
          itemId: args.documentId as string,
          timestamp: ts
        })
        break

      // === 剪贴板 ===
      case 'prizm_get_clipboard':
      case 'prizm_get_clipboard_item':
        out.push({
          toolName: name,
          action: 'read',
          itemKind: 'clipboard',
          itemId: args.id as string,
          timestamp: ts
        })
        break
      case 'prizm_add_clipboard_item':
        out.push({
          toolName: name,
          action: 'create',
          itemKind: 'clipboard',
          itemId: extractIdFromResult(result),
          timestamp: ts
        })
        break
      case 'prizm_delete_clipboard_item':
        out.push({
          toolName: name,
          action: 'delete',
          itemKind: 'clipboard',
          itemId: args.id as string,
          timestamp: ts
        })
        break

      // === 搜索 ===
      case 'prizm_search':
        out.push({ toolName: name, action: 'search', timestamp: ts })
        break

      default:
        break
    }
  }

  return out
}

/**
 * 从会话消息中收集所有 tool 段落（从 parts 提取，按 id 去重）
 */
export function collectToolCallsFromMessages(
  messages: Array<{
    parts: Array<{ type: string; id?: string; name?: string; arguments?: string; result?: string }>
    createdAt?: number
  }>
): Array<{ tc: ToolCallInput; createdAt?: number }> {
  const seen = new Set<string>()
  const collected: Array<{ tc: ToolCallInput; createdAt?: number }> = []

  for (const msg of messages) {
    const ts = msg.createdAt
    const toolParts = msg.parts.filter(
      (p): p is { type: 'tool'; id: string; name: string; arguments: string; result: string } =>
        p.type === 'tool' && 'name' in p && 'id' in p
    )
    for (const p of toolParts) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        collected.push({
          tc: {
            id: p.id,
            name: p.name,
            arguments:
              typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? {}),
            result: typeof p.result === 'string' ? p.result : ''
          },
          createdAt: ts
        })
      }
    }
  }

  return collected
}
