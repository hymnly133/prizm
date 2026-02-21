/**
 * 片段：caller_preamble（由 BG/ToolLLM 传入的整块，按配方拼到 static 末尾）
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const caller_preamble: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  return ctx.callerPreamble?.trim() ?? ''
}
