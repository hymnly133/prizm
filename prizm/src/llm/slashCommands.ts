/**
 * 内置 Slash 命令实现与注册
 */

import { listRefItems, getScopeRefItem, getScopeStats, searchScopeItems } from './scopeItemRegistry'
import {
  registerSlashCommand,
  parseSlashMessage,
  getSlashCommand,
  type SlashCommandRunOptions
} from './slashCommandRegistry'

async function runNotes(options: SlashCommandRunOptions): Promise<string> {
  const items = listRefItems(options.scope, 'note')
  if (!items.length) return '当前无便签。'
  return items.map((r) => `- ${r.id}: ${r.title} (${r.charCount} 字)`).join('\n')
}

async function runTodos(options: SlashCommandRunOptions): Promise<string> {
  const items = listRefItems(options.scope, 'todo')
  if (!items.length) return '当前无待办项。'
  return items.map((r) => `- ${r.id}: [${r.groupOrStatus}] ${r.title}`).join('\n')
}

async function runDocs(options: SlashCommandRunOptions): Promise<string> {
  const items = listRefItems(options.scope, 'document')
  if (!items.length) return '当前无文档。'
  return items.map((r) => `- ${r.id}: ${r.title} (${r.charCount} 字)`).join('\n')
}

async function runRead(options: SlashCommandRunOptions): Promise<string> {
  const [kindId] = options.args
  if (!kindId?.includes(':')) {
    return '用法: /read <kind>:<id>，例如 /read doc:xxx 或 /read note:yyy'
  }
  const [kind, id] = kindId.split(':', 2)
  const k = kind.toLowerCase()
  const refKind =
    k === 'note'
      ? 'note'
      : k === 'todo'
      ? 'todo'
      : k === 'doc' || k === 'document'
      ? 'document'
      : null
  if (!refKind || !id) return `无法识别的类型: ${kind}`
  const detail = getScopeRefItem(options.scope, refKind, id)
  if (!detail) return `未找到: ${refKind}:${id}`
  return `### ${detail.title}\n\n${detail.content || '(空)'}`
}

async function runStats(options: SlashCommandRunOptions): Promise<string> {
  const stats = getScopeStats(options.scope)
  const t = stats.byKind
  return `便签 ${t.notes.count} 条 / ${t.notes.chars} 字；待办 ${t.todoList.count} 项 / ${t.todoList.chars} 字；文档 ${t.document.count} 篇 / ${t.document.chars} 字；会话 ${t.sessions.count} 个。总计 ${stats.totalItems} 项，${stats.totalChars} 字。`
}

async function runSearch(options: SlashCommandRunOptions): Promise<string> {
  const query = options.args.join(' ').trim()
  if (!query) return '用法: /search <关键词>'
  const items = searchScopeItems(options.scope, query)
  if (!items.length) return '未找到匹配项。'
  return items.map((r) => `- [${r.kind}] ${r.id}: ${r.title}`).join('\n')
}

async function runContext(options: SlashCommandRunOptions): Promise<string> {
  const { scope, sessionId } = options
  if (!sessionId) return '当前无会话上下文。'
  const { getSessionContext } = await import('./contextTracker')
  const state = getSessionContext(scope, sessionId)
  const activities = state?.activities ?? []
  if (!activities.length) return '本会话内暂无工具操作记录。'
  return activities
    .filter((a) => a.action === 'create' || a.action === 'update' || a.action === 'delete')
    .map((a) => `${a.action} ${a.itemKind ?? ''}:${a.itemId ?? '?'}`)
    .join('\n')
}

async function runHelp(options: SlashCommandRunOptions): Promise<string> {
  const { listSlashCommands } = await import('./slashCommandRegistry')
  const cmds = listSlashCommands()
  return cmds.map((c) => `/${c.name} - ${c.description}`).join('\n')
}

let builtinSlashRegistered = false

/** 注册内置 slash 命令 */
export function registerBuiltinSlashCommands(): void {
  if (builtinSlashRegistered) return
  builtinSlashRegistered = true

  registerSlashCommand({
    name: 'notes',
    aliases: ['便签'],
    description: '列出当前工作区的便签',
    run: runNotes,
    builtin: true
  })
  registerSlashCommand({
    name: 'todos',
    aliases: ['待办'],
    description: '列出待办项',
    run: runTodos,
    builtin: true
  })
  registerSlashCommand({
    name: 'docs',
    aliases: ['文档'],
    description: '列出文档',
    run: runDocs,
    builtin: true
  })
  registerSlashCommand({
    name: 'read',
    description: '读取指定项全文，如 /read doc:id 或 /read note:id',
    run: runRead,
    builtin: true
  })
  registerSlashCommand({
    name: 'stats',
    description: '显示工作区数据统计',
    run: runStats,
    builtin: true
  })
  registerSlashCommand({
    name: 'search',
    description: '全文搜索',
    run: runSearch,
    builtin: true
  })
  registerSlashCommand({
    name: 'context',
    description: '显示当前会话的上下文提供状态',
    run: runContext,
    builtin: true
  })
  registerSlashCommand({
    name: 'help',
    description: '显示可用命令列表',
    run: runHelp,
    builtin: true
  })
}

/**
 * 若消息为 slash 命令则执行并返回结果，否则返回 null
 */
export async function tryRunSlashCommand(
  scope: string,
  sessionId: string | undefined,
  message: string
): Promise<string | null> {
  registerBuiltinSlashCommands()
  const parsed = parseSlashMessage(message)
  if (!parsed) return null
  const cmd = getSlashCommand(parsed.name)
  if (!cmd) return null
  const result = await cmd.run({ scope, sessionId, args: parsed.args })
  return result
}
