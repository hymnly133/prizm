/**
 * 片段：prompt_injection（本轮命令注入，如 slash，perTurn）
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const prompt_injection: SegmentBuilder = (
  ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario === 'tool_workflow_management') return ''
  return ctx.promptInjection?.trim() ?? ''
}
