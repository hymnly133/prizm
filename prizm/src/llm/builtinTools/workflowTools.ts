/**
 * 内置工具：工作流引擎
 *
 * Action: run / resume / list / status / cancel / register / list_defs
 */

import {
  getWorkflowRunner,
  parseWorkflowDef,
  serializeWorkflowDef,
  WorkflowParseError,
  buildRunRefContent
} from '../../core/workflowEngine'
import * as resumeStore from '../../core/workflowEngine/resumeStore'
import * as defStore from '../../core/workflowEngine/workflowDefStore'
import { isWorkflowManagementSession } from '@prizm/shared'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

export function dispatchWorkflow(
  ctx: BuiltinToolContext
): BuiltinToolResult | Promise<BuiltinToolResult> {
  const action = ctx.args.action as string
  switch (action) {
    case 'run':
      return executeRun(ctx)
    case 'resume':
      return executeResume(ctx)
    case 'list':
      return executeList(ctx)
    case 'status':
      return executeStatus(ctx)
    case 'cancel':
      return executeCancel(ctx)
    case 'register':
      return executeRegister(ctx)
    case 'list_defs':
      return executeListDefs(ctx)
    case 'get_def':
      return executeGetDef(ctx)
    default:
      return { text: `未知 action: ${action}`, isError: true }
  }
}

async function executeRun(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  try {
    const runner = getWorkflowRunner()
    const yamlStr = ctx.args.yaml as string | undefined
    const workflowName = ctx.args.workflow_name as string | undefined
    const argsStr = ctx.args.args as string | undefined

    let args: Record<string, unknown> | undefined
    if (argsStr) {
      try {
        args = JSON.parse(argsStr)
      } catch {
        args = undefined
      }
    }

    let def
    if (yamlStr) {
      def = parseWorkflowDef(yamlStr)
    } else if (workflowName) {
      const defRecord = defStore.getDefByName(workflowName, ctx.scope)
      if (!defRecord) {
        return { text: `工作流 "${workflowName}" 未注册`, isError: true }
      }
      def = parseWorkflowDef(defRecord.yamlContent)
    } else {
      return { text: '需要提供 yaml 或 workflow_name', isError: true }
    }

    const runId = runner.startWorkflow(ctx.scope, def, {
      args,
      triggerType: 'manual'
    })

    return {
      text: JSON.stringify({
        runId,
        status: 'running',
        message: `工作流 "${def.name}" 已启动，使用 action:status + run_id 查看进度`
      })
    }
  } catch (err) {
    if (err instanceof WorkflowParseError) {
      return { text: `工作流定义错误: ${err.message}`, isError: true }
    }
    return { text: `执行失败: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

async function executeResume(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const resumeToken = ctx.args.resume_token as string
  if (!resumeToken) {
    return { text: '需要提供 resume_token', isError: true }
  }

  const approved = ctx.args.approved !== false
  try {
    const runner = getWorkflowRunner()
    const result = await runner.resumeWorkflow(resumeToken, approved)
    return { text: JSON.stringify(result) }
  } catch (err) {
    return { text: `恢复失败: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

const DEFAULT_LIST_LIMIT = 50

function executeList(ctx: BuiltinToolContext): BuiltinToolResult {
  const limit = Math.min(Number(ctx.args.limit) || DEFAULT_LIST_LIMIT, 100)
  let runs = resumeStore.listRuns(ctx.scope, undefined, limit)

  const session = ctx.sessionId
    ? ctx.data.agentSessions.find((s) => s.id === ctx.sessionId)
    : undefined
  const boundWorkflowName =
    session && isWorkflowManagementSession(session)
      ? (session as { toolMeta?: { workflowName?: string } }).toolMeta?.workflowName
      : undefined
  const workflowName = (ctx.args.workflow_name as string) || boundWorkflowName
  if (workflowName) {
    runs = runs.filter((r) => r.workflowName === workflowName)
  }

  const summary = runs.map((r) => ({
    id: r.id,
    name: r.workflowName,
    status: r.status,
    currentStep: r.currentStepIndex,
    triggerType: r.triggerType,
    createdAt: new Date(r.createdAt).toISOString(),
    error: r.error
  }))
  return { text: JSON.stringify(summary, null, 2) }
}

function executeStatus(ctx: BuiltinToolContext): BuiltinToolResult {
  const runId = ctx.args.run_id as string
  if (!runId) {
    return { text: '需要提供 run_id', isError: true }
  }

  const run = resumeStore.getRunById(runId)
  if (!run) {
    return { text: `运行记录 "${runId}" 不存在`, isError: true }
  }
  if (run.scope !== ctx.scope) {
    return { text: `运行记录 "${runId}" 不在当前 scope`, isError: true }
  }

  return { text: buildRunRefContent(ctx.scopeRoot, run) }
}

function executeCancel(ctx: BuiltinToolContext): BuiltinToolResult {
  const runId = ctx.args.run_id as string
  if (!runId) {
    return { text: '需要提供 run_id', isError: true }
  }

  try {
    const runner = getWorkflowRunner()
    const ok = runner.cancelWorkflow(runId)
    return ok
      ? { text: `工作流 ${runId} 已取消` }
      : { text: `无法取消 ${runId}（可能不在运行/暂停状态）`, isError: true }
  } catch (err) {
    return { text: `取消失败: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function executeRegister(ctx: BuiltinToolContext): BuiltinToolResult {
  const yamlStr = ctx.args.yaml as string
  const name = ctx.args.workflow_name as string
  const description = ctx.args.description as string | undefined

  if (!yamlStr || !name) {
    return { text: '需要提供 yaml 和 workflow_name', isError: true }
  }

  try {
    const def = parseWorkflowDef(yamlStr)

    if (def.name && def.name !== name) {
      return {
        text: `workflow_name ("${name}") 与 YAML 内部 name ("${def.name}") 不一致，请保持一致`,
        isError: true
      }
    }

    const triggersJson = def.triggers ? JSON.stringify(def.triggers) : undefined
    const record = defStore.registerDef(
      name,
      ctx.scope,
      yamlStr,
      description ?? def.description,
      triggersJson
    )
    return {
      text: JSON.stringify({
        id: record.id,
        name: record.name,
        scope: record.scope,
        message: '工作流已注册'
      })
    }
  } catch (err) {
    if (err instanceof WorkflowParseError) {
      return { text: `工作流定义错误: ${err.message}`, isError: true }
    }
    return { text: `注册失败: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

function executeListDefs(ctx: BuiltinToolContext): BuiltinToolResult {
  const defs = defStore.listDefs(ctx.scope)
  const summary = defs.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString()
  }))
  return { text: JSON.stringify(summary, null, 2) }
}

function executeGetDef(ctx: BuiltinToolContext): BuiltinToolResult {
  const workflowName = ctx.args.workflow_name as string | undefined
  const defId = ctx.args.def_id as string | undefined

  let defRecord
  if (defId) {
    defRecord = defStore.getDefById(defId)
  } else if (workflowName) {
    defRecord = defStore.getDefByName(workflowName, ctx.scope)
  } else {
    return { text: '需要提供 workflow_name 或 def_id', isError: true }
  }

  if (!defRecord) {
    return { text: `工作流定义未找到`, isError: true }
  }

  try {
    const def = parseWorkflowDef(defRecord.yamlContent)
    const argsSchema = extractArgsSchema(def)
    return {
      text: JSON.stringify(
        {
          id: defRecord.id,
          name: defRecord.name,
          description: defRecord.description,
          scope: defRecord.scope,
          yamlContent: defRecord.yamlContent,
          argsSchema,
          steps: def.steps.map((s) => ({ id: s.id, type: s.type, description: s.description })),
          triggers: def.triggers
        },
        null,
        2
      )
    }
  } catch {
    return {
      text: JSON.stringify(
        {
          id: defRecord.id,
          name: defRecord.name,
          yamlContent: defRecord.yamlContent
        },
        null,
        2
      )
    }
  }
}

/** 导航卡片：不执行实际操作，仅返回导航参数供前端展示 */
export function dispatchNavigate(ctx: BuiltinToolContext): BuiltinToolResult {
  const target = ctx.args.target as string
  const initialPrompt = ctx.args.initialPrompt as string | undefined
  const title = ctx.args.title as string | undefined
  const description = ctx.args.description as string | undefined
  const payload = {
    navigation: {
      target: target ?? 'workflow-create',
      initialPrompt: initialPrompt ?? '',
      title: title ?? '去工作流创建会话',
      description: description ?? ''
    }
  }
  return { text: JSON.stringify(payload) }
}

/** 从工作流定义中合并 def.args 与步骤内 $args.xxx 引用，得到完整参数 schema */
function extractArgsSchema(def: import('@prizm/shared').WorkflowDef): Record<string, string> {
  const schema: Record<string, string> = {}

  if (def.args && typeof def.args === 'object') {
    for (const [key, arg] of Object.entries(def.args)) {
      const desc = (arg as { description?: string }).description
      schema[key] = desc ? desc : `工作流输入参数 (def.args)`
    }
  }

  const argsPattern = /\$args\.([a-zA-Z_][a-zA-Z0-9_.]*)/g
  for (const step of def.steps) {
    for (const field of [step.prompt, step.input, step.transform]) {
      if (!field) continue
      argsPattern.lastIndex = 0
      let match
      while ((match = argsPattern.exec(field)) !== null) {
        const key = match[1]
        if (!schema[key]) schema[key] = `Referenced in step "${step.id}" (${step.type})`
      }
    }
  }
  return schema
}
