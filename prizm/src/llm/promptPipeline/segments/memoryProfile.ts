/**
 * 片段：memory_profile（画像 + 上下文记忆，perTurn）
 * 由 chatCore 的 injectMemories 产出 memoryTexts，此处仅拼接注入。
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const memory_profile: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  if (!ctx.memoryTexts?.length) return ''
  return ctx.memoryTexts.join('\n\n')
}
