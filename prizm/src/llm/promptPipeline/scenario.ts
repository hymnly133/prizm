/**
 * promptPipeline — 场景解析
 *
 * 从 session（及可选 options）推导 PromptScenario，供配方选择使用。
 */

import { isWorkflowManagementSession } from '@prizm/shared'
import type { AgentSession } from '@prizm/shared'
import type { PromptScenario } from './types'

/**
 * 根据会话与调用上下文解析提示词场景。
 * 覆盖：用户交互、后台任务、工作流步骤、工作流管理（Tool LLM）。
 */
export function resolveScenario(
  _scope: string,
  _sessionId: string,
  session: AgentSession | null
): PromptScenario {
  if (!session) return 'interactive'

  if (isWorkflowManagementSession(session)) return 'tool_workflow_management'

  if (session.kind === 'background') {
    return session.bgMeta?.source === 'workflow'
      ? 'background_workflow_step'
      : 'background_task'
  }

  return 'interactive'
}
