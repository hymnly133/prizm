/**
 * 内置 Slash 命令实现与注册
 */

import { listRefItems, getScopeRefItem, getScopeStats } from './scopeItemRegistry'
import { getSearchIndexForTools } from './builtinTools'
import {
  registerSlashCommand,
  parseSlashMessage,
  getSlashCommand,
  type SlashCommandRunOptions
} from './slashCommandRegistry'
import { loadAllCustomCommands, replaceTemplateVariables } from './customCommandLoader'
import {
  loadAllSkillMetadata,
  activateSkill,
  deactivateSkill,
  getActiveSkills
} from './skillManager'
import { createLogger } from '../logger'

const log = createLogger('SlashCommands')

async function runNotes(options: SlashCommandRunOptions): Promise<string> {
  const items = listRefItems(options.scope, 'document')
  if (!items.length) return '当前无便签/文档。'
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
    k === 'note' || k === 'doc' || k === 'document' ? 'document' : k === 'todo' ? 'todo' : null
  if (!refKind || !id) return `无法识别的类型: ${kind}`
  const detail = getScopeRefItem(options.scope, refKind, id)
  if (!detail) return `未找到: ${refKind}:${id}`
  return `### ${detail.title}\n\n${detail.content || '(空)'}`
}

async function runStats(options: SlashCommandRunOptions): Promise<string> {
  const stats = getScopeStats(options.scope)
  const t = stats.byKind
  return `文档 ${t.document.count} 篇 / ${t.document.chars} 字；待办 ${t.todoList.count} 项 / ${t.todoList.chars} 字；会话 ${t.sessions.count} 个。总计 ${stats.totalItems} 项，${stats.totalChars} 字。`
}

async function runSearch(options: SlashCommandRunOptions): Promise<string> {
  const query = options.args.join(' ').trim()
  if (!query) return '用法: /search <关键词>'
  const searchIndex = getSearchIndexForTools()
  if (!searchIndex) return '搜索服务未初始化。'
  const results = await searchIndex.search(options.scope, query, { complete: true, limit: 20 })
  if (!results.length) return '未找到匹配项。'
  return results
    .map((r) => {
      const title = (r.raw as { title?: string })?.title ?? r.id
      const srcTag = r.source === 'fulltext' ? ' [全文]' : ''
      return `- [${r.kind}] ${r.id}: ${title}${srcTag}`
    })
    .join('\n')
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

/** 从 .prizm-data/commands/ 加载自定义命令并注册到 registry */
function loadAndRegisterCustomCommands(): void {
  try {
    const commands = loadAllCustomCommands()
    for (const cmd of commands) {
      if (!cmd.enabled) continue
      registerSlashCommand({
        name: cmd.id,
        aliases: cmd.aliases,
        description: cmd.description ?? `自定义命令: ${cmd.name}`,
        mode: cmd.mode,
        allowedTools: cmd.allowedTools,
        builtin: false,
        run: async (options) => {
          return replaceTemplateVariables(cmd.content, options.args)
        }
      })
    }
    if (commands.length > 0) {
      log.info('Registered %d custom commands', commands.filter((c) => c.enabled).length)
    }
  } catch (err) {
    log.warn('Failed to load custom commands:', err)
  }
}

/** 重新加载自定义命令（供外部调用，如命令变更后刷新） */
export function reloadCustomCommands(): void {
  loadAndRegisterCustomCommands()
}

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

  // /skill 命令：管理 skills
  registerSlashCommand({
    name: 'skill',
    aliases: ['技能'],
    description: '管理 Skills: /skill list | /skill <name> | /skill deactivate <name>',
    builtin: true,
    run: async (options) => {
      const [subCmd, ...rest] = options.args
      const scope = options.scope
      const sessionId = options.sessionId ?? ''

      if (!subCmd || subCmd === 'list') {
        const allSkills = loadAllSkillMetadata()
        const active = getActiveSkills(scope, sessionId)
        const activeNames = new Set(active.map((a) => a.skillName))
        if (allSkills.length === 0) return '当前无可用 Skills。'
        return allSkills
          .map(
            (s) =>
              `- ${s.name}${activeNames.has(s.name) ? ' ✓' : ''}: ${s.description.slice(0, 60)}`
          )
          .join('\n')
      }

      if (subCmd === 'deactivate' || subCmd === 'off') {
        const name = rest[0]
        if (!name) return '用法: /skill deactivate <name>'
        const result = deactivateSkill(scope, sessionId, name)
        return result ? `已取消激活 Skill: ${name}` : `Skill "${name}" 未激活或不存在`
      }

      if (subCmd === 'active') {
        const active = getActiveSkills(scope, sessionId)
        if (active.length === 0) return '当前会话无激活的 Skills。'
        return active
          .map(
            (a) =>
              `- ${a.skillName} (${a.autoActivated ? '自动' : '手动'}, ${new Date(
                a.activatedAt
              ).toLocaleTimeString()})`
          )
          .join('\n')
      }

      // /skill <name> → 手动激活
      const activation = activateSkill(scope, sessionId, subCmd)
      if (!activation) return `Skill "${subCmd}" 未找到。使用 /skill list 查看可用 Skills。`
      return `已激活 Skill: ${subCmd}`
    }
  })

  // 加载用户自定义命令
  loadAndRegisterCustomCommands()
}

/** slash 命令执行结果 */
export interface SlashCommandResult {
  /** 结果文本 */
  text: string
  /** 命令模式：prompt 需注入 LLM，action 直接返回 */
  mode: 'prompt' | 'action'
  /** 原始命令名 */
  commandName: string
}

/**
 * 若消息为 slash 命令则执行并返回结果，否则返回 null
 */
export async function tryRunSlashCommand(
  scope: string,
  sessionId: string | undefined,
  message: string
): Promise<SlashCommandResult | null> {
  registerBuiltinSlashCommands()
  const parsed = parseSlashMessage(message)
  if (!parsed) return null
  const cmd = getSlashCommand(parsed.name)
  if (!cmd) return null
  const result = await cmd.run({ scope, sessionId, args: parsed.args })
  return {
    text: result,
    mode: cmd.mode ?? 'action',
    commandName: cmd.name
  }
}
