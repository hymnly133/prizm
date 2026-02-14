/**
 * 对话 LLM 摘要服务
 * 每 N 轮对话后异步生成会话摘要，用于压缩长对话上下文
 * 配置来自 agent-tools.agent.conversationSummary
 */

import { scopeStore } from '../core/ScopeStore'
import { getLLMProvider } from './index'
import { createLogger } from '../logger'
import { getConversationSummarySettings } from '../settings/agentToolsStore'
import { recordTokenUsage } from './tokenUsage'

const log = createLogger('ConversationSummary')

const DEFAULT_INTERVAL = 10

function countTurns(messages: Array<{ role: string }>): number {
  let turns = 0
  let lastWasUser = false
  for (const m of messages) {
    if (m.role === 'user') {
      lastWasUser = true
    } else if (m.role === 'assistant' && lastWasUser) {
      turns++
      lastWasUser = false
    }
  }
  return turns
}

/**
 * 异步生成对话摘要并更新会话
 * @param userId 可选，用于 token 记录；无则记到 anonymous
 */
export function scheduleConversationSummary(
  scope: string,
  sessionId: string,
  userId?: string
): void {
  const settings = getConversationSummarySettings()
  if (settings?.enabled === false) return

  const interval = settings?.interval ?? DEFAULT_INTERVAL
  const model = settings?.model?.trim() || undefined

  void (async () => {
    let lastUsage:
      | { totalInputTokens?: number; totalOutputTokens?: number; totalTokens?: number }
      | undefined
    try {
      const data = scopeStore.getScopeData(scope)
      const session = data.agentSessions.find((s) => s.id === sessionId)
      if (!session) {
        log.warn('Session not found for summary:', sessionId, 'scope:', scope)
        return
      }

      const turns = countTurns(session.messages)
      if (turns < interval || turns % interval !== 0) {
        log.debug('Conversation turns not at interval:', turns, 'interval:', interval)
        return
      }

      const recent = session.messages.slice(-(interval * 2))
      const text = recent
        .map((m) => `[${m.role}]: ${(m as { content?: string }).content ?? ''}`)
        .join('\n')
      if (!text.trim()) {
        log.debug('No content to summarize')
        return
      }

      const provider = getLLMProvider()
      const prompt = `请用 3-5 句话概括以下对话的核心内容与结论，直接输出摘要，不要加引号或前缀：\n\n${text.slice(
        0,
        6000
      )}`

      let llmContent = ''
      for await (const chunk of provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0.3,
        model
      })) {
        if (chunk.text) llmContent += chunk.text
        if (chunk.usage) lastUsage = chunk.usage
        if (chunk.done) break
      }

      const summary = llmContent.trim()
      if (!summary) {
        log.warn('LLM returned empty conversation summary for:', sessionId)
        return
      }

      const idx = data.agentSessions.findIndex((s) => s.id === sessionId)
      if (idx < 0) return
      const existing = data.agentSessions[idx].llmSummary ?? ''
      data.agentSessions[idx].llmSummary = existing ? `${existing}\n\n---\n${summary}` : summary
      data.agentSessions[idx].updatedAt = Date.now()
      scopeStore.saveScope(scope)
      log.info('Conversation summary generated:', sessionId, 'scope:', scope)
    } catch (err) {
      log.error('Conversation summary failed:', sessionId, 'scope:', scope, err)
    } finally {
      if (lastUsage) {
        recordTokenUsage(userId ?? 'anonymous', 'conversation_summary', lastUsage, model)
      }
    }
  })()
}
