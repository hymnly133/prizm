/**
 * 对话摘要服务：仅根据用户本条输入生成动宾短语摘要（单条记录，每轮覆盖）
 * 在用户发送时即触发，用于左侧列表展示
 * 配置来自 agent-tools.agent.conversationSummary
 */

import { scopeStore } from '../core/ScopeStore'
import { getLLMProvider } from './index'
import { createLogger } from '../logger'
import { getConversationSummarySettings } from '../settings/agentToolsStore'
import { MEMORY_USER_ID } from '@prizm/shared'
import { recordTokenUsage } from './tokenUsage'

const log = createLogger('ConversationSummary')

/**
 * 仅根据用户输入生成动宾短语摘要并覆盖写入会话的 llmSummary
 * 在用户发送消息时调用，与助手回复并行
 */
export function scheduleTurnSummary(
  scope: string,
  sessionId: string,
  userContent: string,
  userId?: string
): void {
  const settings = getConversationSummarySettings()
  if (settings?.enabled === false) return
  if (!userContent.trim()) return

  const model = settings?.model?.trim() || undefined

  void (async () => {
    let lastUsage:
      | { totalInputTokens?: number; totalOutputTokens?: number; totalTokens?: number }
      | undefined
    try {
      const data = scopeStore.getScopeData(scope)
      const idx = data.agentSessions.findIndex((s) => s.id === sessionId)
      if (idx < 0) {
        log.warn('Session not found for turn summary:', sessionId, 'scope:', scope)
        return
      }

      const text = userContent.slice(0, 2000)
      const provider = getLLMProvider()
      const prompt = `根据用户下面这条输入，用「动宾短语」概括其意图或主题。只输出一个短语，不要完整句子、不要句号或引号。示例：查询天气、创建待办、总结文档、询问用法。10 字以内。\n\n用户输入：\n${text}`

      let llmContent = ''
      for await (const chunk of provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0.2,
        model
      })) {
        if (chunk.text) llmContent += chunk.text
        if (chunk.usage) lastUsage = chunk.usage
        if (chunk.done) break
      }

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
      log.error('Turn summary failed:', sessionId, 'scope:', scope, err)
    } finally {
      if (lastUsage) {
        recordTokenUsage(MEMORY_USER_ID, 'conversation_summary', lastUsage, model)
      }
    }
  })()
}
