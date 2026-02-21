/**
 * 片段建造器注册表
 */

import type { SegmentId, SegmentBuilder } from '../types'
import { identity } from './identity'
import { identity_workflow } from './identityWorkflow'
import { instructions } from './instructions'
import { rules } from './rules'
import { env } from './env'
import { workflow_context } from './workflowContext'
import { workflow_management_context } from './workflowManagementContext'
import { available_skills } from './availableSkills'
import { skills } from './skills'
import { workspace_context } from './workspaceContext'
import { active_locks } from './activeLocks'
import { memory_profile } from './memoryProfile'
import { prompt_injection } from './promptInjection'
import { workflow_edit_context } from './workflowEditContext'
import { workflow_writing_spec } from './workflowWritingSpec'
import { caller_preamble } from './callerPreamble'

export const SEGMENT_BUILDERS: Record<SegmentId, SegmentBuilder> = {
  identity,
  identity_workflow,
  instructions,
  rules,
  env,
  workflow_context,
  workflow_management_context,
  workflow_writing_spec,
  available_skills,
  skills,
  workspace_context,
  active_locks,
  memory_profile,
  memory_context: memory_profile,
  prompt_injection,
  workflow_edit_context,
  caller_preamble
}
