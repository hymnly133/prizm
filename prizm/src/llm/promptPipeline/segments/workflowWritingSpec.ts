/**
 * 片段：workflow_writing_spec（流水线编写规范，注入工作流管理会话）
 *
 * 从 docs/workflow-writing-spec.md 读取完整编写规范，仅 tool_workflow_management 场景产出。
 */

import fs from 'fs'
import path from 'path'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

let cachedSpec: string | null = null

function loadSpecContent(): string {
  if (cachedSpec !== null) return cachedSpec
  const candidates = [
    path.join(process.cwd(), '..', 'docs', 'workflow-writing-spec.md'),
    path.join(process.cwd(), 'docs', 'workflow-writing-spec.md'),
    path.join(process.cwd(), '..', '..', 'docs', 'workflow-writing-spec.md')
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedSpec = fs.readFileSync(p, 'utf-8')
        return cachedSpec
      }
    } catch {
      continue
    }
  }
  cachedSpec = ''
  return ''
}

export const workflow_writing_spec: SegmentBuilder = (
  _ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario !== 'tool_workflow_management') return ''
  const content = loadSpecContent()
  if (!content.trim()) return ''
  return `<workflow-writing-spec>\n${content.trim()}\n</workflow-writing-spec>`
}
