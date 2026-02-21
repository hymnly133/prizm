/**
 * 片段：identity_workflow（工作流专家不变部分，cache 友好）
 * 仅 tool_workflow_management 场景产出；当前 YAML 由 workflow_edit_context 在 perTurn 注入。
 */

import { getWorkflowExpertStaticPrompt } from '../../toolLLM/workflowPrompt'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const identity_workflow: SegmentBuilder = (
  _ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario !== 'tool_workflow_management') return ''
  return getWorkflowExpertStaticPrompt()
}
