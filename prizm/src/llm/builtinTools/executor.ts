/**
 * 内置工具执行入口：构建上下文并按工具名分发到各分类 handler
 */

import { scopeStore } from '../../core/ScopeStore'
import { createWorkspaceContext } from '../workspaceResolver'
import { recordActivity } from '../contextTracker'
import { emit } from '../../core/eventBus'
import type { AuditEntryInput } from '../../core/agentAuditLog'
import type { ScopeActivityItemKind, ScopeActivityAction } from '@prizm/shared'
import type { BuiltinToolContext, BuiltinToolResult } from './types'
import * as fileTools from './fileTools'
import * as todoTools from './todoTools'
import * as documentTools from './documentTools'
import * as searchTools from './searchTools'
import * as terminalTools from './terminalTools'
import * as knowledgeTools from './knowledgeTools'
import * as lockTools from './lockTools'

/**
 * 执行内置工具；sessionId 可选，用于记录修改到 ContextTracker
 * userId 可选，用于记忆检索的真实用户 ID
 * grantedPaths 可选，用户授权的外部文件路径列表
 */
export async function executeBuiltinTool(
  scope: string,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string,
  _userId?: string,
  grantedPaths?: string[]
): Promise<BuiltinToolResult> {
  const data = scopeStore.getScopeData(scope)
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const wsCtx = createWorkspaceContext(scopeRoot, sessionId)

  const record = (itemId: string, itemKind: ScopeActivityItemKind, action: ScopeActivityAction) => {
    if (sessionId)
      recordActivity(scope, sessionId, {
        toolName,
        action,
        itemKind,
        itemId,
        timestamp: Date.now()
      })
  }

  /** 通过 EventBus 发布审计事件 */
  const emitAudit = (input: AuditEntryInput) => {
    if (sessionId) {
      emit('tool:executed', { scope, sessionId, toolName, auditInput: input }).catch(() => {})
    }
  }

  const wsArg = typeof args.workspace === 'string' ? args.workspace : undefined

  const ctx: BuiltinToolContext = {
    scope,
    toolName,
    args,
    scopeRoot,
    data,
    wsCtx,
    record,
    audit: emitAudit,
    emitAudit,
    wsArg,
    sessionId,
    grantedPaths
  }

  try {
    switch (toolName) {
      case 'prizm_file_list':
        return fileTools.executeFileList(ctx)
      case 'prizm_file_read':
        return fileTools.executeFileRead(ctx)
      case 'prizm_file_write':
        return fileTools.executeFileWrite(ctx)
      case 'prizm_file_move':
        return fileTools.executeFileMove(ctx)
      case 'prizm_file_delete':
        return fileTools.executeFileDelete(ctx)

      case 'prizm_list_todos':
        return todoTools.executeListTodos(ctx)
      case 'prizm_list_todo_lists':
        return todoTools.executeListTodoLists(ctx)
      case 'prizm_read_todo':
        return todoTools.executeReadTodo(ctx)
      case 'prizm_create_todo':
        return todoTools.executeCreateTodo(ctx)
      case 'prizm_update_todo':
        return todoTools.executeUpdateTodo(ctx)
      case 'prizm_delete_todo':
        return todoTools.executeDeleteTodo(ctx)

      case 'prizm_list_documents':
        return documentTools.executeListDocuments(ctx)
      case 'prizm_get_document_content':
        return documentTools.executeGetDocumentContent(ctx)
      case 'prizm_create_document':
        return documentTools.executeCreateDocument(ctx)
      case 'prizm_update_document':
        return documentTools.executeUpdateDocument(ctx)
      case 'prizm_delete_document':
        return documentTools.executeDeleteDocument(ctx)
      case 'prizm_promote_file':
        return documentTools.executePromoteFile(ctx)

      case 'prizm_search':
        return searchTools.executeSearch(ctx)
      case 'prizm_scope_stats':
        return searchTools.executeScopeStats(ctx)
      case 'prizm_list_memories':
        return searchTools.executeListMemories(ctx)
      case 'prizm_search_memories':
        return searchTools.executeSearchMemories(ctx)

      case 'prizm_terminal_execute':
        return terminalTools.executeTerminalExecute(ctx)
      case 'prizm_terminal_spawn':
        return terminalTools.executeTerminalSpawn(ctx)
      case 'prizm_terminal_send_keys':
        return terminalTools.executeTerminalSendKeys(ctx)

      // 知识库工具：文档-记忆双向查询
      case 'prizm_search_docs_by_memory':
        return knowledgeTools.executeSearchDocsByMemory(ctx)
      case 'prizm_get_document_memories':
        return knowledgeTools.executeGetDocumentMemories(ctx)
      case 'prizm_document_versions':
        return knowledgeTools.executeDocumentVersions(ctx)
      case 'prizm_find_related_documents':
        return knowledgeTools.executeFindRelatedDocuments(ctx)

      // 锁定与领取工具
      case 'prizm_checkout_document':
        return lockTools.executeCheckoutDocument(ctx)
      case 'prizm_checkin_document':
        return lockTools.executeCheckinDocument(ctx)
      case 'prizm_claim_todo_list':
        return lockTools.executeClaimTodoList(ctx)
      case 'prizm_set_active_todo':
        return lockTools.executeSetActiveTodo(ctx)
      case 'prizm_release_todo_list':
        return lockTools.executeReleaseTodoList(ctx)
      case 'prizm_resource_status':
        return lockTools.executeResourceStatus(ctx)

      default:
        return { text: `未知内置工具: ${toolName}`, isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `Error: ${msg}`, isError: true }
  }
}
