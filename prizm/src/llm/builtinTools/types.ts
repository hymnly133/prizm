/**
 * 内置工具执行上下文与结果类型
 */

import type { ScopeData } from '../../core/ScopeStore'
import type { WorkspaceContext } from '../workspaceResolver'
import type { ScopeActivityItemKind, ScopeActivityAction } from '@prizm/shared'
import type { AuditEntryInput } from '../../core/agentAuditLog'

export interface BuiltinToolResult {
  text: string
  isError?: boolean
}

export interface BuiltinToolContext {
  scope: string
  toolName: string
  args: Record<string, unknown>
  scopeRoot: string
  data: ScopeData
  wsCtx: WorkspaceContext
  record: (itemId: string, itemKind: ScopeActivityItemKind, action: ScopeActivityAction) => void
  /** 通过 EventBus 发布审计事件（tool:executed） */
  emitAudit: (input: AuditEntryInput) => void
  wsArg: string | undefined
  sessionId: string | undefined
  grantedPaths: string[] | undefined
}
