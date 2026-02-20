/**
 * 对话摘要服务：根据最近至多两条用户消息生成动宾短语摘要（每轮覆盖）
 * 若两条消息话题一致则综合概括，否则以较新的一条为准
 * 在用户发送时即触发，用于左侧列表展示
 * 配置来自 agent-tools.agent.conversationSummary
 */

import { scopeStore } from '../core/ScopeStore'
import { getLLMProvider, getLLMProviderName } from './index'
import { createLogger } from '../logger'
import { getConversationSummarySettings } from '../settings/agentToolsStore'
import { recordTokenUsage } from './tokenUsage'
import { getTextContent } from '@prizm/shared'
import { logLLMCall, buildMessagesSummary, formatUsage } from './llmCallLogger'

const log = createLogger('ConversationSummary')

/** Session 级去重：新请求自动取消同 session 的前一个进行中的摘要 */
const _pendingSummary = new Map<string, AbortController>()

/** 从会话消息列表中提取最近至多 N 条用户消息的文本 */
function getRecentUserTexts(
  messages: Array<{ role: string; parts: Array<{ type: string; content?: string }> }>,
  maxCount: number
): string[] {
  const userTexts: string[] = []
  for (let i = messages.length - 1; i >= 0 && userTexts.length < maxCount; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const text = getTextContent(msg as Parameters<typeof getTextContent>[0]).trim()
    if (text) userTexts.unshift(text)
  }
  return userTexts
}

const SUMMARY_SYSTEM_PROMPT =
  '你是对话摘要生成器。根据用户消息用「动宾短语」概括其意图或主题。\n' +
  '规则：只输出一个短语，不要完整句子、不要句号或引号。10 字以内。\n' +
  '示例：查询天气、创建待办、总结文档、询问用法。\n' +
  '如果给出两条消息：话题一致则综合概括，话题不同则仅根据较新的那条概括。'

/** 构建摘要 user prompt：仅包含动态的用户消息内容 */
function buildSummaryUserPrompt(userTexts: string[]): string {
  if (userTexts.length <= 1) {
    const text = (userTexts[0] ?? '').slice(0, 2000)
    return `用户输入：\n${text}`
  }

  const older = userTexts[0].slice(0, 1000)
  const newer = userTexts[1].slice(0, 1500)
  return `[较早消息]\n${older}\n\n[较新消息]\n${newer}`
}

/**
 * 根据最近至多两条用户消息生成动宾短语摘要并覆盖写入会话的 llmSummary
 * 在用户发送消息时调用，与助手回复并行
 */
export function scheduleTurnSummary(scope: string, sessionId: string, userContent: string): void {
  const settings = getConversationSummarySettings()
  if (settings?.enabled === false) return
  if (!userContent.trim()) return

  const dedupeKey = `${scope}:${sessionId}`
  const prev = _pendingSummary.get(dedupeKey)
  if (prev) {
    prev.abort()
    log.debug('scheduleTurnSummary: cancelled previous pending summary for session=%s', sessionId)
  }
  const ac = new AbortController()
  _pendingSummary.set(dedupeKey, ac)

  const model = settings?.model?.trim() || undefined

  void (async () => {
    let lastUsage:
      | { totalInputTokens?: number; totalOutputTokens?: number; totalTokens?: number }
      | undefined
    let summaryMessages: Array<{ role: string; content: string }> = []
    let summaryStartTime = Date.now()
    try {
      if (ac.signal.aborted) return

      const data = scopeStore.getScopeData(scope)
      const idx = data.agentSessions.findIndex((s) => s.id === sessionId)
      if (idx < 0) {
        log.warn('Session not found for turn summary:', sessionId, 'scope:', scope)
        return
      }

      const session = data.agentSessions[idx]
      const userTexts = getRecentUserTexts(
        session.messages as Array<{
          role: string
          parts: Array<{ type: string; content?: string }>
        }>,
        2
      )
      if (userTexts.length === 0) {
        log.warn('No user messages found for turn summary:', sessionId)
        return
      }

      const userPrompt = buildSummaryUserPrompt(userTexts)
      const provider = getLLMProvider()
      summaryMessages = [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
      summaryStartTime = Date.now()

      let llmContent = ''
      for await (const chunk of provider.chat(summaryMessages, {
        temperature: 0.2,
        model,
        signal: ac.signal,
        promptCacheKey: 'prizm:conv_summary'
      })) {
        if (ac.signal.aborted) break
        if (chunk.text) llmContent += chunk.text
        if (chunk.usage) lastUsage = chunk.usage
        if (chunk.done) break
      }

      if (ac.signal.aborted) return

      const summary = llmContent
        .trim()
        .replace(/[。"」]$/, '')
        .slice(0, 20)
      if (!summary) {
        log.warn('LLM returned empty turn summary for:', sessionId)
        return
      }

      data.agentSessions[idx].llmSummary = summary
      data.agentSessions[idx].updatedAt = Date.now()
      scopeStore.saveScope(scope)
      log.debug('Turn summary updated:', sessionId, 'scope:', scope)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      log.error('Turn summary failed:', sessionId, 'scope:', scope, err)
    } finally {
      if (_pendingSummary.get(dedupeKey) === ac) {
        _pendingSummary.delete(dedupeKey)
      }
      if (lastUsage) {
        recordTokenUsage(
          'conversation_summary',
          scope,
          lastUsage,
          model ?? getLLMProviderName(),
          sessionId
        )
        logLLMCall({
          ts: new Date().toISOString(),
          category: 'conversation_summary',
          sessionId,
          scope,
          model: model ?? getLLMProviderName(),
          promptCacheKey: 'prizm:conv_summary',
          messages: buildMessagesSummary(summaryMessages),
          usage: formatUsage(lastUsage),
          durationMs: Date.now() - summaryStartTime
        })
      }
    }
  })()
}
