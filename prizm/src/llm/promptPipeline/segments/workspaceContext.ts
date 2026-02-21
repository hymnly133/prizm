/**
 * 片段：workspace_context（文档/待办/会话摘要，perTurn）
 */

import { buildScopeContextSummary } from '../../scopeContext'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const workspace_context: SegmentBuilder = async (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): Promise<string> => {
  if (!ctx.includeScopeContext) return ''
  const summary = await buildScopeContextSummary(ctx.scope)
  if (!summary) return ''
  return `<workspace_context scope="${ctx.scope}">\n${summary}\n</workspace_context>`
}
