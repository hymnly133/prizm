/**
 * 文档 LLM 摘要服务
 * 对超长文档异步生成持久化摘要，用于 Agent 上下文
 * 配置来自 agent-tools.agent.documentSummary
 */

import { scopeStore } from '../core/ScopeStore'
import { getLLMProvider } from './index'
import { createLogger } from '../logger'
import { getDocumentSummarySettings } from '../settings/agentToolsStore'

const log = createLogger('DocumentSummary')

const DEFAULT_MIN_LEN = parseInt(process.env.PRIZM_DOC_SUMMARY_MIN_LEN ?? '500', 10) || 500
const ENV_DISABLED = process.env.PRIZM_DOC_SUMMARY_ENABLED === '0'

/**
 * 异步生成文档摘要并持久化
 * 不阻塞调用方，失败时仅记录日志
 */
export function scheduleDocumentSummary(scope: string, documentId: string): void {
  const settings = getDocumentSummarySettings()
  const enabled = !ENV_DISABLED && settings?.enabled !== false
  if (!enabled) return

  const minLen = settings?.minLen ?? DEFAULT_MIN_LEN
  const model = settings?.model?.trim() || undefined

  void (async () => {
    try {
      const data = scopeStore.getScopeData(scope)
      const doc = data.documents.find((d) => d.id === documentId)
      if (!doc) {
        log.warn('Document not found for summary:', documentId, 'scope:', scope)
        return
      }

      const content = doc.content?.trim() ?? ''
      if (content.length < minLen) {
        log.debug('Document too short for summary:', documentId, 'len:', content.length)
        return
      }

      const provider = getLLMProvider()
      const prompt = `请用一句话（约150字以内）概括以下文档的核心内容，直接输出摘要，不要加引号或前缀：\n\n${content.slice(
        0,
        4000
      )}`

      let llmContent = ''
      for await (const chunk of provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0.3,
        model
      })) {
        if (chunk.text) llmContent += chunk.text
        if (chunk.done) break
      }

      const summary = llmContent.trim()
      if (!summary) {
        log.warn('LLM returned empty summary for:', documentId)
        return
      }

      const idx = data.documents.findIndex((d) => d.id === documentId)
      if (idx < 0) return
      data.documents[idx] = {
        ...data.documents[idx],
        llmSummary: summary,
        updatedAt: Date.now()
      }
      scopeStore.saveScope(scope)
      log.info('Document summary generated:', documentId, 'scope:', scope)
    } catch (err) {
      log.error('Document summary failed:', documentId, 'scope:', scope, err)
    }
  })()
}
