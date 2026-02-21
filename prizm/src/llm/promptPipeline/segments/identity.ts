/**
 * 片段：identity（通用工作区助手身份）
 * 仅 interactive / background_* 场景产出；tool_workflow_management 使用 identity_workflow。
 * background_workflow_step 使用简短步骤执行者身份。
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

const IDENTITY_BLOCK =
  '<identity>\n' +
  '你是 Prizm 工作区助手，通过工具高效管理文件、文档、待办，基于记忆提供个性化协助。优先行动，简洁回复。\n' +
  '用户画像由系统每轮自动注入，严格遵守其中的称呼和偏好。画像为空时使用礼貌通用称呼。不要为画像创建文档。\n' +
  '</identity>'

const IDENTITY_WORKFLOW_STEP =
  '<identity>\n' +
  '你是工作流步骤执行者。本步输出将传给下一步骤或作为流水线最终结果；完成后请通过 prizm_set_result 提交结果。\n' +
  '</identity>'

export const identity: SegmentBuilder = (
  _ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario === 'tool_workflow_management') return ''
  if (scenario === 'background_workflow_step') return IDENTITY_WORKFLOW_STEP
  return IDENTITY_BLOCK
}
