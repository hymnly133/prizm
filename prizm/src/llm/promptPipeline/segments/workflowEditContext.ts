/**
 * 片段：workflow_edit_context（当前工作流 YAML，perTurn，cache 友好）
 */

import { buildWorkflowEditContext } from '../../toolLLM/workflowPrompt'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const workflow_edit_context: SegmentBuilder = (
  ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario !== 'tool_workflow_management' || !ctx.workflowEditContext?.trim()) return ''
  return buildWorkflowEditContext(ctx.workflowEditContext.trim())
}
