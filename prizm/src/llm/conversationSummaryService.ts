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

/** 构建摘要 prompt：单条消息使用简单 prompt，两条消息让 LLM 判断话题一致性 */
function buildSummaryPrompt(userTexts: string[]): string {
  if (userTexts.length <= 1) {
    const text = (userTexts[0] ?? '').slice(0, 2000)
    return (
      '根据用户下面这条输入，用「动宾短语」概括其意图或主题。' +
      '只输出一个短语，不要完整句子、不要句号或引号。' +
      '示例：查询天气、创建待办、总结文档、询问用法。10 字以内。\n\n' +
      `用户输入：\n${text}`
    )
  }

  const older = userTexts[0].slice(0, 1000)
  const newer = userTexts[1].slice(0, 1500)
  return (
    '下面给出同一个对话中最近两条用户消息（按时间顺序）。\n' +
    '请判断它们的话题是否基本一致：\n' +
    '- 如果一致，综合两条消息用「动宾短语」概括整体意图；\n' +
    '- 如果话题不同，仅根据较新的那条消息概括。\n' +
    '只输出一个短语，不要完整句子、不要句号或引号。10 字以内。\n\n' +
    `[较早消息]\n${older}\n\n[较新消息]\n${newer}`
  )
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

      const prompt = buildSummaryPrompt(userTexts)
      const provider = getLLMProvider()

      let llmContent = ''
      for await (const chunk of provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0.2,
        model,
        signal: ac.signal
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
      }
    }
  })()
}
