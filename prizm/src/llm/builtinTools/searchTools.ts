/**
 * 内置工具：搜索、工作区统计、记忆 list/search 执行逻辑
 */

import type { SearchIndexService } from '../../search/searchIndexService'
import { getScopeStats } from '../scopeItemRegistry'
import { isMemoryEnabled, getAllMemories, searchMemoriesWithOptions } from '../EverMemService'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/** SearchIndexService 实例注入 - 由 server 初始化时调用 */
let _searchIndex: SearchIndexService | null = null

export function setSearchIndexForTools(searchIndex: SearchIndexService): void {
  _searchIndex = searchIndex
}

export function getSearchIndexForTools(): SearchIndexService | null {
  return _searchIndex
}

export async function executeSearch(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const query = typeof ctx.args.query === 'string' ? ctx.args.query.trim() : ''
  if (!query) return { text: '请提供搜索关键词。', isError: true }
  if (!_searchIndex) {
    return { text: '搜索服务未初始化。', isError: true }
  }
  const types = Array.isArray(ctx.args.types) ? ctx.args.types : undefined
  const tags = Array.isArray(ctx.args.tags) ? ctx.args.tags : undefined
  const results = await _searchIndex.search(ctx.scope, query, {
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

export async function executeScopeStats(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const stats = getScopeStats(ctx.scope)
  const t = stats.byKind
  const text = `文档 ${t.document.count} 篇 / ${t.document.chars} 字；待办 ${t.todoList.count} 项 / ${t.todoList.chars} 字；会话 ${t.sessions.count} 个。总计 ${stats.totalItems} 项，${stats.totalChars} 字。`
  return { text }
}

export async function executeListMemories(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const memories = await getAllMemories(ctx.scope)
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

export async function executeSearchMemories(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const searchQuery = typeof ctx.args.query === 'string' ? ctx.args.query.trim() : ''
  if (!searchQuery) return { text: '请提供搜索关键词。', isError: true }
  const memories = await searchMemoriesWithOptions(searchQuery, ctx.scope)
  if (!memories.length) return { text: '未找到相关记忆。' }
  const lines = memories.map((m) => `- ${m.memory}`)
  return { text: lines.join('\n') }
}
