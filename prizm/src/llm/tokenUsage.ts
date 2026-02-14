/**
 * 按功能 scope 记录 token 使用到用户级存储
 * 与数据 scope 分离，存储到 .prizm-data/users/{userId}/
 */

import type { TokenUsageScope } from '../types'
import type { TokenUsageRecord } from '../types'
import { genUniqueId } from '../id'
import { readUserTokenUsage, writeUserTokenUsage } from '../core/UserStore'

export interface TokenUsageInput {
  totalInputTokens?: number
  totalOutputTokens?: number
  totalTokens?: number
}

/**
 * 将一次 LLM 调用的 token 使用记录到对应用户目录。
 * 无 userId 时不写入（由调用方决定是否传匿名 id）。
 * @param forceRecord 为 true 时即使 token 全为 0 也写入（用于统计出错/失败调用次数）
 */
export function recordTokenUsage(
  userId: string,
  usageScope: TokenUsageScope,
  usage: TokenUsageInput,
  model?: string,
  forceRecord?: boolean
): void {
  const inputTokens = usage.totalInputTokens ?? 0
  const outputTokens = usage.totalOutputTokens ?? 0
  const totalTokens =
    usage.totalTokens ?? (inputTokens + outputTokens > 0 ? inputTokens + outputTokens : 0)
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0 && !forceRecord) {
    return
  }
  const records = readUserTokenUsage(userId)
  const record: TokenUsageRecord = {
    id: genUniqueId(),
    usageScope,
    timestamp: Date.now(),
    model: model ?? '',
    inputTokens,
    outputTokens,
    totalTokens
  }
  records.push(record)
  writeUserTokenUsage(userId, records)
}
