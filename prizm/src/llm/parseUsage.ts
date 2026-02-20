/**
 * 解析 OpenAI 兼容 API 流式响应中的 usage
 * 与 lobehub ModelUsage 字段对齐，使用 @prizm/shared MessageUsage
 */
import type { MessageUsage } from '../types'

/** OpenAI 流式 chunk 中 usage 结构 */
interface OpenAIUsageChunk {
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}

export function parseUsageFromChunk(parsed: OpenAIUsageChunk): MessageUsage | undefined {
  const u = parsed.usage
  if (!u || (u.prompt_tokens == null && u.completion_tokens == null && u.total_tokens == null)) {
    return undefined
  }
  return {
    totalInputTokens: u.prompt_tokens,
    totalOutputTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
    cachedInputTokens: u.prompt_tokens_details?.cached_tokens
  }
}
