/**
 * 片段：rules（外部规则 + 用户规则）
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const rules: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  const { rulesContent, customRulesContent } = ctx
  if (!rulesContent && !customRulesContent) return ''
  const parts: string[] = []
  if (rulesContent) parts.push(rulesContent)
  if (customRulesContent) parts.push(customRulesContent)
  return '<rules>\n' + parts.join('\n\n') + '\n</rules>'
}
