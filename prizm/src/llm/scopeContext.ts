/**
 * Scope 上下文构建 - 将 scope 数据格式化为 Agent 可用的摘要
 * 用于注入到 LLM 对话的 system prompt 中
 *
 * 策略：
 * - 待办列表：全量注入
 * - 文档：短内容全文，长内容使用文档总览记忆（回退到 llmSummary 或截断）
 * - 会话：总览仅展示数量或标题列表
 * - 末尾附加统一字数统计（基于 ScopeItemRegistry）
 */

import { scopeStore } from '../core/ScopeStore'
import type { ScopeData } from '../core/ScopeStore'
import { getScopeStats } from './scopeItemRegistry'
import { getDocumentOverview } from './EverMemService'

/** 单条内容最大字符数（摘要时） */
const MAX_CONTENT_LEN = 100

/** 整体摘要最大字符数（约 1000-1500 tokens） */
const DEFAULT_MAX_SUMMARY_LEN = 2800

/** 短内容阈值：低于此用全文 */
const SHORT_THRESHOLD = 400

/** 每类最大条数 */
const MAX_TODO_ITEMS = 10
const MAX_DOCUMENTS = 5

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
 * 构建待办区块：遍历所有 list，全量
 */
function buildTodoSection(scope: string, data: ScopeData, maxItems: number): string {
  const lists = data.todoLists ?? []
  const allItems: Array<{
    item: { id: string; title: string; status: string; updatedAt?: number; description?: string }
    listTitle: string
  }> = []
  for (const list of lists) {
    for (const it of list.items ?? []) {
      allItems.push({ item: it, listTitle: list.title ?? '待办' })
    }
  }
  if (!allItems.length) return ''

  const sorted = [...allItems].sort((a, b) => (b.item.updatedAt ?? 0) - (a.item.updatedAt ?? 0))
  const lines: string[] = []
  for (const { item: it, listTitle } of sorted.slice(0, maxItems)) {
    const status = it.status === 'done' ? '✓' : it.status === 'doing' ? '◐' : '○'
    const desc = (it as { description?: string }).description
      ? `: ${truncate((it as { description: string }).description, 60)}`
      : ''
    const prefix = lists.length > 1 ? `[${listTitle}] ` : ''
    lines.push(`- ${status} ${prefix}[id:${it.id}] ${it.title}${desc}`)
  }
  if (sorted.length > maxItems) {
    lines.push(`  …共 ${sorted.length} 项`)
  }
  return `## 待办\n${lines.join('\n')}`
}

/**
 * 构建文档区块：短内容全文，长内容使用文档总览记忆
 * 回退策略：总览记忆 → llmSummary（存量兼容）→ truncate
 */
async function buildDocumentsSection(
  scope: string,
  data: ScopeData,
  maxItems: number
): Promise<string> {
  const { documents } = data
  if (!documents.length) return ''

  const sorted = [...documents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const lines: string[] = []
  for (const d of sorted.slice(0, maxItems)) {
    const content = (d.content ?? '').trim()
    const isShort = content.length < SHORT_THRESHOLD

    let desc: string
    if (isShort) {
      desc = content
    } else {
      // 优先使用文档总览记忆，回退到 llmSummary（@deprecated 兼容存量），再回退到截断
      let overview: string | null = null
      try {
        overview = await getDocumentOverview(scope, d.id)
      } catch {
        // 记忆系统未初始化或查询失败
      }
      desc = overview ?? d.llmSummary /* @deprecated */ ?? truncate(content, MAX_CONTENT_LEN)
    }
    lines.push(`- [id:${d.id}] ${d.title}: ${desc}`)
  }
  if (sorted.length > maxItems) {
    lines.push(`  …共 ${sorted.length} 篇`)
  }
  return `## 文档\n${lines.join('\n')}`
}

/**
 * 会话区块：仅数量或摘要列表
 */
function buildSessionsSection(data: ScopeData): string {
  const sessions = data.agentSessions ?? []
  if (!sessions.length) return ''

  const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const slice = sorted.slice(0, 8)
  const summaries = slice.map((s) => s.llmSummary?.trim()).filter(Boolean)

  if (!summaries.length) {
    return `## 会话\n共 ${sorted.length} 个会话`
  }
  const tail = sorted.length > 8 ? ` …共 ${sorted.length} 个会话` : ''
  return `## 会话\n${summaries.join('、')}${tail}`
}

/**
 * 按优先级截断：超限时依次移除 todo → documents → sessions
 * @returns { text, truncated }
 */
function truncateByPriority(
  todoSec: string,
  docsSec: string,
  sessionsSec: string,
  maxLen: number
): { text: string; truncated: boolean } {
  const parts = [sessionsSec, docsSec, todoSec].filter(Boolean)
  let result = parts.join('\n\n')
  if (result.length <= maxLen) return { text: result, truncated: false }

  for (let i = parts.length - 1; i >= 0; i--) {
    const remaining = parts.slice(0, i).filter(Boolean).join('\n\n')
    if (remaining.length <= maxLen) {
      return { text: remaining, truncated: i > 0 }
    }
  }
  return { text: result.slice(0, maxLen) + '…', truncated: true }
}

/**
 * 构建 scope 的上下文摘要，用于注入到 Agent 的 system prompt
 * @param scope - scope 标识
 */
export async function buildScopeContextSummary(scope: string): Promise<string> {
  const data = scopeStore.getScopeData(scope)
  const maxLen = getMaxSummaryLen()

  const todoSection = buildTodoSection(scope, data, MAX_TODO_ITEMS)
  const docsSection = await buildDocumentsSection(scope, data, MAX_DOCUMENTS)
  const sessionsSection = buildSessionsSection(data)

  if (!todoSection && !docsSection && !sessionsSection) {
    return ''
  }

  const { text: summary, truncated } = truncateByPriority(
    todoSection,
    docsSection,
    sessionsSection,
    maxLen
  )

  const stats = getScopeStats(scope)
  const statsLine = `\n--- 共 ${stats.totalItems} 项${truncated ? '（部分已截断）' : ''}`
  return summary + statsLine
}
