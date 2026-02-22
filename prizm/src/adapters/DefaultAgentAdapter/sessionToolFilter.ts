/**
 * 会话级工具过滤 — 工作流管理会话保留通用工作流工具
 *
 * 供 DefaultAgentAdapter 使用，逻辑单独成文件便于单测覆盖。
 * 工作流管理会话：kind=tool + source=workflow-management（或兼容 legacy background）。
 * 管理会话赋予通用工作流工具（prizm_workflow），仅排除 prizm_navigate。
 */

import { isWorkflowManagementSession as isWorkflowManagementSessionShared } from '@prizm/shared'
import type { LLMTool } from '../interfaces'

/** 会话数据子集（用于判断是否工作流管理会话） */
export interface SessionDataForFilter {
  kind?: string
  bgMeta?: { source?: string }
  toolMeta?: { source?: string }
}

/** 是否为工作流管理会话（待创建或已绑定）— 委托 shared 判断 */
export function isWorkflowManagementSession(sessionData?: SessionDataForFilter | null): boolean {
  return isWorkflowManagementSessionShared((sessionData ?? null) as Parameters<typeof isWorkflowManagementSessionShared>[0])
}

const PRIZM_NAVIGATE_TOOL_NAME = 'prizm_navigate'

/** 工作流引擎（run/list/status/cancel/register/list_defs/get_def 等），管理会话与通用会话均可用 */
export const PRIZM_WORKFLOW_ENGINE_TOOL_NAME = 'prizm_workflow'

/**
 * 会话级工具过滤：工作流管理会话仅排除 prizm_navigate，保留 prizm_workflow 等通用工作流能力。
 */
export function filterWorkflowBuilderForSession(
  tools: LLMTool[],
  sessionData?: SessionDataForFilter | null
): LLMTool[] {
  if (!isWorkflowManagementSession(sessionData)) return tools
  return tools.filter((t) => t.function.name !== PRIZM_NAVIGATE_TOOL_NAME)
}
