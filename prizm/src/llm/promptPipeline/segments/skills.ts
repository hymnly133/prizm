/**
 * 片段：skills（已激活技能指令）
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const skills: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  const { activeSkillInstructions } = ctx
  if (!activeSkillInstructions?.length) return ''
  return activeSkillInstructions
    .map((s) => `<skill name="${s.name}">\n${s.instructions}\n</skill>`)
    .join('\n\n')
}
