/**
 * 工作流管理工具：创建/更新工作流定义
 *
 * - workflow-management-create-workflow：仅未绑定会话可用，提交后自动 registerDef + 双向绑定
 * - workflow-management-update-workflow：仅已绑定会话可用，提交即 upsert 该工作流定义
 * 服务端用 parseWorkflowDef 校验，校验失败返回错误让 LLM 修正。
 */

import {
  WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
  WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW
} from '@prizm/shared'
import type { LLMTool, IAgentAdapter } from '../../adapters/interfaces'
import {
  parseWorkflowDef,
  serializeWorkflowDef,
  WorkflowParseError
} from '../../core/workflowEngine'
import {
  ensureWorkflowWorkspace,
  getWorkflowPersistentWorkspace
} from '../../core/PathProviderCore'
import { scopeStore } from '../../core/ScopeStore'
import { emit } from '../../core/eventBus'
import * as defStore from '../../core/workflowEngine/workflowDefStore'
import type { WorkflowDef } from '@prizm/shared'

const WORKFLOW_JSON_PARAM = {
  type: 'string' as const,
  description:
    '完整的 WorkflowDef JSON 字符串，与 YAML 等价。服务端会校验定义，失败时返回具体错误信息便于修正。'
}

/** 工作流管理：创建工具（仅未绑定会话可见） */
export const WORKFLOW_MANAGEMENT_CREATE_DEF: LLMTool = {
  type: 'function',
  function: {
    name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
    description:
      '创建并注册一个工作流定义（仅限本会话尚未绑定工作流时使用一次）。参数为 WorkflowDef 的 JSON，与 YAML 等价；服务端会校验，失败时返回具体错误信息便于修正。提交成功后系统自动注册并绑定本会话，之后只能使用更新工具修改该工作流。',
    parameters: {
      type: 'object',
      properties: { workflow_json: WORKFLOW_JSON_PARAM },
      required: ['workflow_json']
    }
  }
}

/** 工作流管理：更新工具（仅已绑定会话可见） */
export const WORKFLOW_MANAGEMENT_UPDATE_DEF: LLMTool = {
  type: 'function',
  function: {
    name: WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW,
    description:
      '更新当前会话已绑定的工作流定义。参数为 WorkflowDef 的 JSON，与 YAML 等价；服务端会校验，失败时返回具体错误信息便于修正。提交后直接覆盖该工作流，不创建新定义。',
    parameters: {
      type: 'object',
      properties: { workflow_json: WORKFLOW_JSON_PARAM },
      required: ['workflow_json']
    }
  }
}

/** 工作流管理工具列表（创建 + 更新），供工作流管理会话使用 */
export const WORKFLOW_MANAGEMENT_TOOLS: LLMTool[] = [
  WORKFLOW_MANAGEMENT_CREATE_DEF,
  WORKFLOW_MANAGEMENT_UPDATE_DEF
]

export interface SubmitToolResult {
  success: boolean
  workflowDef?: WorkflowDef
  yamlContent?: string
  error?: string
}

/** 校验并序列化工作流定义（不落库） */
export function executeSubmitWorkflow(workflowJson: string): SubmitToolResult {
  try {
    const raw = JSON.parse(workflowJson) as Record<string, unknown>
    const yamlContent = serializeWorkflowDef(raw as unknown as WorkflowDef)
    const def = parseWorkflowDef(yamlContent)
    return { success: true, workflowDef: def, yamlContent }
  } catch (err) {
    if (err instanceof WorkflowParseError) {
      return { success: false, error: `工作流定义校验失败: ${err.message}` }
    }
    if (err instanceof SyntaxError) {
      return { success: false, error: `JSON 解析失败: ${err.message}` }
    }
    return {
      success: false,
      error: `提交失败: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

export interface CreateWorkflowResult {
  text: string
  isError: boolean
}

/**
 * 创建并绑定：校验 → registerDef → updateDefMeta(workflowManagementSessionId) → updateSession(toolMeta)
 * 供 executor 调用，需传入 adapter 以更新会话双向引用。
 */
export async function executeCreateWorkflow(
  scope: string,
  sessionId: string,
  workflowJson: string,
  adapter: IAgentAdapter | undefined
): Promise<CreateWorkflowResult> {
  const submit = executeSubmitWorkflow(workflowJson)
  if (!submit.success || !submit.workflowDef || !submit.yamlContent) {
    return { text: submit.error ?? '校验失败', isError: true }
  }
  if (!adapter?.getSession || !adapter?.updateSession) {
    return { text: 'Agent 适配器不可用，无法完成绑定', isError: true }
  }
  const existing = await adapter.getSession(scope, sessionId)
  const boundId =
    existing?.toolMeta?.workflowDefId ??
    (existing as { bgMeta?: { workflowDefId?: string } })?.bgMeta?.workflowDefId
  if (boundId) {
    return { text: '当前会话已绑定工作流，请使用更新工具修改', isError: true }
  }

  const name = submit.workflowDef.name
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  ensureWorkflowWorkspace(scopeRoot, name)
  const persistentWorkspaceDir = getWorkflowPersistentWorkspace(scopeRoot, name)

  const record = defStore.registerDef(
    name,
    scope,
    submit.yamlContent,
    submit.workflowDef.description
  )

  // 先写 session 再写 def，避免 updateSession 失败时 def 已带引用导致单向引用且 GET /workflow/defs 清掉后双向都丢
  try {
    if (existing?.kind === 'tool' && existing.toolMeta) {
      await adapter.updateSession(scope, sessionId, {
        toolMeta: {
          ...existing.toolMeta,
          workflowDefId: record.id,
          workflowName: name,
          persistentWorkspaceDir
        }
      })
    } else if (existing && 'bgMeta' in existing && existing.bgMeta) {
      const bg = existing.bgMeta as Record<string, unknown>
      await adapter.updateSession(scope, sessionId, {
        bgMeta: {
          ...bg,
          workflowDefId: record.id,
          workflowName: name,
          persistentWorkspaceDir
        }
      })
    }
  } catch (err) {
    return {
      text: `工作流已注册，但会话绑定更新失败: ${err instanceof Error ? err.message : String(err)}`,
      isError: true
    }
  }

  defStore.updateDefMeta(name, scope, { workflowManagementSessionId: sessionId })

  void emit('workflow:def.registered', { scope, defId: record.id, name: record.name })
  return {
    text: JSON.stringify(
      {
        success: true,
        defId: record.id,
        name: record.name,
        message: `工作流「${record.name}」已创建并绑定到本会话，后续请使用更新工具修改。`
      },
      null,
      2
    ),
    isError: false
  }
}

export interface UpdateWorkflowResult {
  text: string
  isError: boolean
}

/**
 * 更新已绑定工作流：根据 session 的 workflowDefId 取 def，再 registerDef(name, scope, yaml) upsert
 */
export async function executeUpdateWorkflow(
  scope: string,
  sessionId: string,
  workflowJson: string,
  adapter: IAgentAdapter | undefined
): Promise<UpdateWorkflowResult> {
  const submit = executeSubmitWorkflow(workflowJson)
  if (!submit.success || !submit.workflowDef || !submit.yamlContent) {
    return { text: submit.error ?? '校验失败', isError: true }
  }
  if (!adapter?.getSession) {
    return { text: 'Agent 适配器不可用', isError: true }
  }
  const existing = await adapter.getSession(scope, sessionId)
  const boundId =
    existing?.toolMeta?.workflowDefId ??
    (existing as { bgMeta?: { workflowDefId?: string } })?.bgMeta?.workflowDefId
  if (!boundId) {
    return { text: '当前会话未绑定工作流，请先使用创建工具', isError: true }
  }

  const record = defStore.getDefById(boundId)
  if (!record) {
    return { text: '绑定的工作流定义不存在', isError: true }
  }
  const name = record.name
  defStore.registerDef(name, scope, submit.yamlContent, submit.workflowDef.description)
  return {
    text: JSON.stringify(
      {
        success: true,
        name,
        message: `工作流「${name}」已更新。`
      },
      null,
      2
    ),
    isError: false
  }
}
