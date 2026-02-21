/**
 * promptPipeline — 场景配方表
 *
 * 每个场景规定 sessionStatic / perTurnDynamic 的片段顺序；
 * acceptCallerPreamble 为 true 时在 sessionStatic 末尾拼上 context.callerPreamble。
 */

import type { PromptRecipe, PromptScenario } from './types'

const RECIPES: Record<PromptScenario, PromptRecipe> = {
  interactive: {
    sessionStatic: ['identity', 'instructions', 'rules', 'env', 'available_skills', 'skills'],
    acceptCallerPreamble: false,
    perTurnDynamic: ['workspace_context', 'active_locks', 'memory_profile', 'prompt_injection']
  },
  background_task: {
    sessionStatic: [
      'identity',
      'instructions',
      'rules',
      'env',
      'available_skills',
      'skills',
      'caller_preamble'
    ],
    acceptCallerPreamble: true,
    perTurnDynamic: ['workspace_context', 'active_locks', 'memory_profile', 'prompt_injection']
  },
  background_workflow_step: {
    sessionStatic: [
      'identity',
      'instructions',
      'rules',
      'env',
      'workflow_context',
      'available_skills',
      'skills',
      'caller_preamble'
    ],
    acceptCallerPreamble: true,
    perTurnDynamic: ['workspace_context', 'active_locks', 'memory_profile', 'prompt_injection']
  },
  tool_workflow_management: {
    sessionStatic: [
      'identity_workflow',
      'rules',
      'env',
      'workflow_management_context',
      'workflow_writing_spec',
      'available_skills',
      'skills'
    ],
    acceptCallerPreamble: false,
    perTurnDynamic: ['workflow_edit_context', 'active_locks']
  }
}

export function getRecipe(scenario: PromptScenario): PromptRecipe {
  return RECIPES[scenario]
}
