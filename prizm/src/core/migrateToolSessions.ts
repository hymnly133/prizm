/**
 * 启动时迁移：将存量 kind=background + bgMeta.source=workflow-management 的会话
 * 迁移为 kind=tool + toolMeta，便于后续清除旧数据与兼容分支。
 */

import { WORKFLOW_MANAGEMENT_SOURCE, type ToolSessionMeta, isWorkflowManagementSession } from '@prizm/shared'
import type { IAgentAdapter } from '../adapters/interfaces'
import type { AgentSession } from '../types'
import { scopeStore } from './ScopeStore'
import { createLogger } from '../logger'

const log = createLogger('migrateToolSessions')

function needsMigration(s: AgentSession): boolean {
  if (s.kind !== 'background') return false
  if (s.bgMeta?.source !== WORKFLOW_MANAGEMENT_SOURCE) return false
  return true
}

function buildToolMeta(s: AgentSession): ToolSessionMeta {
  const b = s.bgMeta!
  return {
    source: WORKFLOW_MANAGEMENT_SOURCE,
    label: b.label,
    workflowDefId: b.workflowDefId,
    workflowName: b.workflowName,
    persistentWorkspaceDir: b.persistentWorkspaceDir
  }
}

/**
 * 将存量「background + workflow-management」会话迁移为 kind=tool + toolMeta。
 * 幂等：已是 kind=tool 的会话跳过。
 * @returns 迁移条数
 */
export async function migrateToolSessionsFromBackground(
  agentAdapter: IAgentAdapter
): Promise<{ migrated: number }> {
  if (!agentAdapter.updateSession) {
    log.warn('Agent adapter has no updateSession; skip tool session migration')
    return { migrated: 0 }
  }

  let migrated = 0
  const scopes = scopeStore.getAllScopes()

  for (const scope of scopes) {
    const data = scopeStore.getScopeData(scope)
    for (const s of data.agentSessions) {
      if (isWorkflowManagementSession(s)) continue
      if (!needsMigration(s)) continue
      try {
        const toolMeta = buildToolMeta(s)
        await agentAdapter.updateSession(scope, s.id, { kind: 'tool', toolMeta })
        migrated++
        log.info('Migrated tool session:', scope, s.id)
      } catch (err) {
        log.warn('Failed to migrate session', scope, s.id, err)
      }
    }
  }

  if (migrated > 0) {
    log.info('Tool sessions migration done, migrated:', migrated)
  }
  return { migrated }
}
