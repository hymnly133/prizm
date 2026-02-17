/**
 * Token 使用记录 - 写入全局 SQLite 存储
 */

import type { TokenUsageCategory, TokenUsageRecord } from '../types'
import { genUniqueId } from '../id'
import { insertTokenUsage } from '../core/tokenUsageDb'

export interface TokenUsageInput {
  totalInputTokens?: number
  totalOutputTokens?: number
  totalTokens?: number
}

/**
 * 将一次 LLM 调用的 token 使用记录写入 SQLite。
 * @param forceRecord 为 true 时即使 token 全为 0 也写入（用于统计出错/失败调用次数）
 */
export function recordTokenUsage(
  category: TokenUsageCategory,
  dataScope: string,
  usage: TokenUsageInput,
  model?: string,
  sessionId?: string,
  forceRecord?: boolean
): void {
  const inputTokens = usage.totalInputTokens ?? 0
  const outputTokens = usage.totalOutputTokens ?? 0
  const totalTokens =
    usage.totalTokens ?? (inputTokens + outputTokens > 0 ? inputTokens + outputTokens : 0)
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0 && !forceRecord) {
    return
  }
  const record: TokenUsageRecord = {
    id: genUniqueId(),
    category,
    dataScope,
    sessionId: sessionId || undefined,
    timestamp: Date.now(),
    model: model ?? '',
    inputTokens,
    outputTokens,
    totalTokens
  }
  insertTokenUsage(record)
}
