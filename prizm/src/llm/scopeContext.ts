/**
 * Scope 上下文构建 - 将 scope 数据格式化为 Agent 可用的摘要
 * 用于注入到 LLM 对话的 system prompt 中
 *
 * 策略：
 * - 便签列表：各便签项全文（单条较短）；超限则按优先级截断
 * - 待办列表：全量注入
 * - 文档：短内容全文，长内容仅标题 + LLM 摘要（或前 150 字）
 * - 会话：总览仅展示数量或标题列表，不提供具体消息（TODO）
 * - 末尾附加统一字数统计（基于 ScopeItemRegistry）
 */

import { scopeStore } from '../core/ScopeStore'
import type { ScopeData } from '../core/ScopeStore'
import { getScopeStats } from './scopeItemRegistry'
import { recordProvision } from './contextTracker'

/** 单条内容最大字符数（摘要时） */
const MAX_CONTENT_LEN = 180

/** 整体摘要最大字符数（约 1500-2000 tokens） */
const DEFAULT_MAX_SUMMARY_LEN = 4000

/** 短内容阈值：低于此用全文 */
const SHORT_THRESHOLD = 500

/** 每类最大条数 */
const MAX_NOTES = 12
const MAX_TODO_ITEMS = 15
const MAX_DOCUMENTS = 8

function getMaxSummaryLen(): number {
  const v = process.env.PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS?.trim()
  if (!v) return DEFAULT_MAX_SUMMARY_LEN
  const n = parseInt(v, 10)
  return Number.isNaN(n) || n < 500 ? DEFAULT_MAX_SUMMARY_LEN : Math.min(n, 12000)
}

function truncate(text: string, maxLen: number = MAX_CONTENT_LEN): string {
  if (!text || typeof text !== 'string') return ''
  const s = text.trim().replace(/\s+/g, ' ')
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

/**
 * 构建便签区块：每条便签项全文（一般较短）
 */
function buildNotesSection(
  scope: string,
  data: ScopeData,
  maxItems: number,
  sessionId?: string
): string {
  const { notes, groups } = data
  if (!notes.length) return ''

  const groupMap = new Map(groups.map((g) => [g.id, g.name]))
  const sorted = [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const lines: string[] = []
  for (const n of sorted.slice(0, maxItems)) {
    const groupName = n.groupId ? groupMap.get(n.groupId) : null
    const prefix = groupName ? `[${groupName}] ` : ''
    const content = (n.content ?? '').trim()
    lines.push(`- ${prefix}[id:${n.id}] ${content}`)
    if (sessionId) {
      recordProvision(scope, sessionId, {
        itemId: n.id,
        kind: 'note',
        mode: 'full',
        charCount: content.length,
        version: n.updatedAt ?? 0
      })
    }
  }
  if (sorted.length > maxItems) {
    lines.push(`  …共 ${sorted.length} 条`)
  }
  return `## 便签\n${lines.join('\n')}`
}

/**
 * 构建待办区块：全量
 */
function buildTodoSection(
  scope: string,
  data: ScopeData,
  maxItems: number,
  sessionId?: string
): string {
  const { todoList } = data
  if (!todoList?.items?.length) return ''

  const items = [...todoList.items].sort((a, b) => {
    const order = { todo: 0, doing: 1, done: 2 }
    return (order[a.status] ?? 0) - (order[b.status] ?? 0)
  })
  const lines: string[] = []
  for (const it of items.slice(0, maxItems)) {
    const status = it.status === 'done' ? '✓' : it.status === 'doing' ? '◐' : '○'
    const desc = (it as { description?: string }).description
      ? `: ${truncate((it as { description: string }).description, 60)}`
      : ''
    lines.push(`- ${status} [id:${it.id}] ${it.title}${desc}`)
    if (sessionId) {
      const charCount =
        (it.title?.length ?? 0) + ((it as { description?: string }).description?.length ?? 0)
      recordProvision(scope, sessionId, {
        itemId: it.id,
        kind: 'todo',
        mode: 'full',
        charCount,
        version: (it.updatedAt as number) ?? 0
      })
    }
  }
  if (items.length > maxItems) {
    lines.push(`  …共 ${items.length} 项`)
  }
  return `## 待办\n${lines.join('\n')}`
}

/**
 * 构建文档区块：短内容全文，长内容标题+摘要
 */
function buildDocumentsSection(
  scope: string,
  data: ScopeData,
  maxItems: number,
  sessionId?: string
): string {
  const { documents } = data
  if (!documents.length) return ''

  const sorted = [...documents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const lines: string[] = []
  for (const d of sorted.slice(0, maxItems)) {
    const content = (d.content ?? '').trim()
    const isShort = content.length < SHORT_THRESHOLD
    const desc = isShort ? content : d.llmSummary ?? truncate(content, 150)
    lines.push(`- [id:${d.id}] ${d.title}: ${desc}`)
    if (sessionId) {
      recordProvision(scope, sessionId, {
        itemId: d.id,
        kind: 'document',
        mode: isShort ? 'full' : 'summary',
        charCount: isShort ? content.length : (d.llmSummary ?? content.slice(0, 150)).length,
        version: d.updatedAt ?? 0
      })
    }
  }
  if (sorted.length > maxItems) {
    lines.push(`  …共 ${sorted.length} 篇`)
  }
  return `## 文档\n${lines.join('\n')}`
}

/**
 * 会话区块：仅数量或标题列表（具体数据 TODO）
 */
function buildSessionsSection(data: ScopeData): string {
  const sessions = data.agentSessions ?? []
  if (!sessions.length) return ''

  const titles = sessions
    .slice(0, 8)
    .map((s) => s.title?.trim() || s.id)
    .join('、')
  const tail = sessions.length > 8 ? ` …共 ${sessions.length} 个会话` : ''
  return `## 会话\n${titles}${tail}（详情接口待实现）`
}

/**
 * 按优先级截断：超限时依次移除 notes → todo → documents → sessions
 */
function truncateByPriority(
  notesSec: string,
  todoSec: string,
  docsSec: string,
  sessionsSec: string,
  maxLen: number
): string {
  const parts = [sessionsSec, docsSec, todoSec, notesSec].filter(Boolean)
  let result = parts.join('\n\n')
  if (result.length <= maxLen) return result

  for (let i = parts.length - 1; i >= 0; i--) {
    const remaining = parts.slice(0, i).filter(Boolean).join('\n\n')
    if (remaining.length <= maxLen) {
      return remaining + (i > 0 ? '\n\n...(已截断)' : '')
    }
  }
  return result.slice(0, maxLen) + '…'
}

/**
 * 构建 scope 的上下文摘要，用于注入到 Agent 的 system prompt
 * @param scope - scope 标识
 * @param options.sessionId - 若提供则在本会话中记录各条提供状态（供 ContextTracker）
 */
export function buildScopeContextSummary(scope: string, options?: { sessionId?: string }): string {
  const data = scopeStore.getScopeData(scope)
  const maxLen = getMaxSummaryLen()
  const sessionId = options?.sessionId

  const notesSection = buildNotesSection(scope, data, MAX_NOTES, sessionId)
  const todoSection = buildTodoSection(scope, data, MAX_TODO_ITEMS, sessionId)
  const docsSection = buildDocumentsSection(scope, data, MAX_DOCUMENTS, sessionId)
  const sessionsSection = buildSessionsSection(data)

  if (!notesSection && !todoSection && !docsSection && !sessionsSection) {
    return ''
  }

  const summary = truncateByPriority(
    notesSection,
    todoSection,
    docsSection,
    sessionsSection,
    maxLen
  )

  const stats = getScopeStats(scope)
  const statsLine = `\n\n---\n统计: ${stats.totalItems} 项, 共 ${stats.totalChars} 字 (便签 ${stats.byKind.notes.count} 条, 待办 ${stats.byKind.todoList.count} 项, 文档 ${stats.byKind.document.count} 篇, 会话 ${stats.byKind.sessions.count} 个)`
  return summary + statsLine
}
