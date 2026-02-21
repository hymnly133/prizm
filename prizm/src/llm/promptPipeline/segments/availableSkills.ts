/**
 * 片段：available_skills（渐进式发现 — 仅技能元数据）
 * 模型根据 name+description 决定是否使用某技能，需完整说明时调用 prizm_get_skill_instructions(skill_name)。
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const available_skills: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  const { skillMetadataForDiscovery } = ctx
  if (!skillMetadataForDiscovery?.length) return ''
  const lines = skillMetadataForDiscovery.map(
    (s) => `- name: ${s.name}\n  description: ${s.description}`
  )
  return (
    '<available_skills>\n' +
    '可用技能（仅摘要）；若需某技能的完整操作说明，请调用工具 prizm_get_skill_instructions(skill_name)。\n' +
    lines.join('\n') +
    '\n</available_skills>'
  )
}
