/**
 * 内置工具执行入口：构建上下文并按工具名分发到各分类 handler
 * 复合工具通过 action 参数进行二级分发
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
import * as taskTools from './taskTools'
import { lookupToolGuide, listToolGuides } from '../toolInstructions'

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
      emit('tool:executed', {
        scope,
        sessionId,
        toolName,
        auditInput: input,
        actor: { type: 'agent', sessionId, source: `tool:${toolName}` }
      }).catch(() => {})
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
    emitAudit,
    wsArg,
    sessionId,
    grantedPaths
  }

  try {
    switch (toolName) {
      case 'prizm_file':
        return dispatchFile(ctx)
      case 'prizm_todo':
        return dispatchTodo(ctx)
      case 'prizm_document':
        return dispatchDocument(ctx)
      case 'prizm_search':
        return dispatchSearch(ctx)
      case 'prizm_knowledge':
        return dispatchKnowledge(ctx)
      case 'prizm_lock':
        return dispatchLock(ctx)
      case 'prizm_promote_file':
        return documentTools.executePromoteFile(ctx)
      case 'prizm_terminal_execute':
        return terminalTools.executeTerminalExecute(ctx)
      case 'prizm_terminal_spawn':
        return terminalTools.executeTerminalSpawn(ctx)
      case 'prizm_terminal_send_keys':
        return terminalTools.executeTerminalSendKeys(ctx)
      case 'prizm_set_result':
        return taskTools.executeSetResult(ctx)
      case 'prizm_spawn_task':
        return taskTools.executeSpawnTask(ctx)
      case 'prizm_task_status':
        return taskTools.executeTaskStatus(ctx)
      case 'prizm_tool_guide':
        return executeToolGuide(ctx)
      default:
        return { text: `未知内置工具: ${toolName}`, isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `Error: ${msg}`, isError: true }
  }
}

/* ── 复合工具二级分发 ── */

function getAction(ctx: BuiltinToolContext): string {
  const a = ctx.args.action ?? ctx.args.mode
  return typeof a === 'string' ? a : ''
}

function dispatchFile(ctx: BuiltinToolContext): Promise<BuiltinToolResult> | BuiltinToolResult {
  switch (getAction(ctx)) {
    case 'list':
      return fileTools.executeFileList(ctx)
    case 'read':
      return fileTools.executeFileRead(ctx)
    case 'write':
      return fileTools.executeFileWrite(ctx)
    case 'move':
      return fileTools.executeFileMove(ctx)
    case 'delete':
      return fileTools.executeFileDelete(ctx)
    default:
      return { text: `prizm_file: 未知 action "${getAction(ctx)}"`, isError: true }
  }
}

function dispatchTodo(ctx: BuiltinToolContext): Promise<BuiltinToolResult> | BuiltinToolResult {
  switch (getAction(ctx)) {
    case 'list':
      return todoTools.executeList(ctx)
    case 'create_list':
      return todoTools.executeCreateList(ctx)
    case 'delete_list':
      return todoTools.executeDeleteList(ctx)
    case 'add_items':
      return todoTools.executeAddItems(ctx)
    case 'update_item':
      return todoTools.executeUpdateItem(ctx)
    case 'delete_item':
      return todoTools.executeDeleteItem(ctx)
    default:
      return { text: `prizm_todo: 未知 action "${getAction(ctx)}"`, isError: true }
  }
}

function dispatchDocument(ctx: BuiltinToolContext): Promise<BuiltinToolResult> | BuiltinToolResult {
  switch (getAction(ctx)) {
    case 'list':
      return documentTools.executeListDocuments(ctx)
    case 'read':
      return documentTools.executeGetDocumentContent(ctx)
    case 'create':
      return documentTools.executeCreateDocument(ctx)
    case 'update':
      return documentTools.executeUpdateDocument(ctx)
    case 'delete':
      return documentTools.executeDeleteDocument(ctx)
    default:
      return { text: `prizm_document: 未知 action "${getAction(ctx)}"`, isError: true }
  }
}

function dispatchSearch(ctx: BuiltinToolContext): Promise<BuiltinToolResult> | BuiltinToolResult {
  const mode = getAction(ctx)
  switch (mode) {
    case 'keyword':
      return searchTools.executeSearch(ctx)
    case 'stats':
      return searchTools.executeScopeStats(ctx)
    default:
      return { text: `prizm_search: 未知 mode "${mode}"。语义/记忆搜索请用 prizm_knowledge(action:search)。`, isError: true }
  }
}

function dispatchKnowledge(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> | BuiltinToolResult {
  switch (getAction(ctx)) {
    case 'search':
      return knowledgeTools.executeSearchDocsByMemory(ctx)
    case 'memories':
      return knowledgeTools.executeGetDocumentMemories(ctx)
    case 'versions':
      return knowledgeTools.executeDocumentVersions(ctx)
    case 'related':
      return knowledgeTools.executeFindRelatedDocuments(ctx)
    case 'round_lookup':
      return knowledgeTools.executeRoundLookup(ctx)
    default:
      return { text: `prizm_knowledge: 未知 action "${getAction(ctx)}"`, isError: true }
  }
}

function dispatchLock(ctx: BuiltinToolContext): Promise<BuiltinToolResult> | BuiltinToolResult {
  switch (getAction(ctx)) {
    case 'checkout':
      return lockTools.executeCheckoutDocument(ctx)
    case 'checkin':
      return lockTools.executeCheckinDocument(ctx)
    case 'claim':
      return lockTools.executeClaimTodoList(ctx)
    case 'set_active':
      return lockTools.executeSetActiveTodo(ctx)
    case 'release':
      return lockTools.executeReleaseTodoList(ctx)
    case 'status':
      return lockTools.executeResourceStatus(ctx)
    default:
      return { text: `prizm_lock: 未知 action "${getAction(ctx)}"`, isError: true }
  }
}

function executeToolGuide(ctx: BuiltinToolContext): BuiltinToolResult {
  const toolArg = typeof ctx.args.tool === 'string' ? ctx.args.tool.trim() : ''

  if (!toolArg) {
    const guides = listToolGuides()
    const lines = guides.map(
      (g) => `- **${g.category}**: ${g.label}\n  工具: ${g.tools.join(', ')}`
    )
    return {
      text:
        '可用的工具使用指南：\n\n' +
        lines.join('\n') +
        '\n\n调用 `prizm_tool_guide({ tool: "类别名或工具名" })` 查看详细说明。'
    }
  }

  const result = lookupToolGuide(toolArg)
  if (!result) {
    return { text: `没有找到 "${toolArg}" 的使用指南。调用 prizm_tool_guide() 查看所有可用指南。` }
  }

  return { text: result.content }
}
