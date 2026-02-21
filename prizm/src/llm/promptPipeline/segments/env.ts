/**
 * 片段：env（scope / root / session_workspace / workflow_workspace）
 */

import { getSessionWorkspaceDir } from '../../../core/PathProviderCore'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const env: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  const { scope, sessionId, scopeRoot, session } = ctx
  const sessionWorkspace = sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null

  const isWorkflowSession = session?.bgMeta?.source === 'workflow'
  const hasWorkflowManagementContext = !!(
    session &&
    ((session as { toolMeta?: { workflowDefId?: string; workflowName?: string } }).toolMeta
      ?.workflowDefId ??
      (session as { bgMeta?: { workflowDefId?: string } }).bgMeta?.workflowDefId ??
      (session as { toolMeta?: { workflowName?: string } }).toolMeta?.workflowName ??
      (session as { bgMeta?: { workflowName?: string } }).bgMeta?.workflowName)
  )
  const workflowWorkspace = isWorkflowSession
    ? session?.bgMeta?.workspaceDir
    : hasWorkflowManagementContext && session
      ? (session as { toolMeta?: { persistentWorkspaceDir?: string }; bgMeta?: { persistentWorkspaceDir?: string } })
          .toolMeta?.persistentWorkspaceDir ?? session.bgMeta?.persistentWorkspaceDir
      : undefined

  const envParts = [`scope=${scope}`, `root=${scopeRoot}`]
  if (sessionWorkspace) envParts.push(`session_workspace=${sessionWorkspace}`)
  if (workflowWorkspace) envParts.push(`workflow_workspace=${workflowWorkspace}`)
  return `<env>${envParts.join(' ')}</env>`
}
