/**
 * 技能相关内置工具：渐进式发现按需加载完整说明
 */

import {
  loadAllSkillMetadata,
  loadSkillFull,
  getSkillFileTree,
  type SkillFileTree
} from '../skillManager'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

function formatFileTree(tree: SkillFileTree, indent = ''): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(tree).sort()) {
    if (value === 'file') {
      lines.push(`${indent}${key}`)
    } else {
      lines.push(`${indent}${key}/`)
      lines.push(formatFileTree(value as SkillFileTree, indent + '  '))
    }
  }
  return lines.join('\n')
}

/**
 * 返回当前会话允许的技能名集合（与 getSkillsToInject / getSkillsMetadataForDiscovery 同源逻辑）
 */
function getAllowedSkillNames(ctx: BuiltinToolContext): Set<string> {
  const session = ctx.sessionId
    ? ctx.data.agentSessions.find((s) => s.id === ctx.sessionId)
    : undefined
  const allowedSkills =
    (session as { allowedSkills?: string[] })?.allowedSkills ??
    (session as { bgMeta?: { inlineAgentDef?: { allowedSkills?: string[] } } })?.bgMeta
      ?.inlineAgentDef?.allowedSkills
  const all = loadAllSkillMetadata()
  const enabled = all.filter((s) => s.enabled)
  if (!allowedSkills || allowedSkills.length === 0) {
    return new Set(enabled.map((s) => s.name))
  }
  return new Set(allowedSkills)
}

export function executeGetSkillInstructions(ctx: BuiltinToolContext): BuiltinToolResult {
  const skillName = typeof ctx.args.skill_name === 'string' ? ctx.args.skill_name.trim() : ''
  if (!skillName) {
    return { text: '参数 skill_name 必填，且需与 <available_skills> 中的 name 一致。', isError: true }
  }

  const allowed = getAllowedSkillNames(ctx)
  if (!allowed.has(skillName)) {
    return {
      text: `技能 "${skillName}" 不在当前会话允许列表中，或未启用。请仅使用 <available_skills> 中列出的技能名。`,
      isError: true
    }
  }

  const full = loadSkillFull(skillName)
  if (!full) {
    return { text: `未找到技能 "${skillName}" 的完整内容，可能已被删除。`, isError: true }
  }

  const fileTree = getSkillFileTree(skillName)
  let pathAndTree = `**技能目录（可被 prizm_file 访问，已自动授权）**\n- path: \`${full.path}\`\n`
  if (fileTree && Object.keys(fileTree).length > 0) {
    pathAndTree += `**文件树：**\n\`\`\`\n${formatFileTree(fileTree)}\n\`\`\`\n\n`
  }

  return {
    text: `## ${full.name}\n\n${pathAndTree}## 操作说明\n\n${full.body}`
  }
}
