/**
 * 后台任务相关工具：prizm_set_result / prizm_spawn_task / prizm_task_status
 *
 * prizm_spawn_task 和 prizm_task_status 通过 TaskRunner 执行，
 * TaskRunner 复用 WorkflowEngine 的 IStepExecutor 抽象。
 * prizm_set_result 仍直接操作 BG Session 的 bgResult 字段。
 */

import type { BuiltinToolContext, BuiltinToolResult } from './types'
import { scopeStore } from '../../core/ScopeStore'
import { getTaskRunner } from '../../core/workflowEngine'
import { createLogger } from '../../logger'

const log = createLogger('TaskTools')

/**
 * prizm_set_result — 设置当前 BG Session 的执行结果
 *
 * 支持两种模式：
 * 1. 默认模式：固定 output/status/structured_data 参数
 * 2. 动态模式：当 session 有 ioConfig.outputParams 时，非 status 参数自动打包为 structuredData
 */
export async function executeSetResult(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { scope, sessionId, args } = ctx
  if (!sessionId) {
    return { text: 'prizm_set_result: 无法确定当前会话 ID', isError: true }
  }

  const data = scopeStore.getScopeData(scope)
  const session = data.agentSessions.find((s) => s.id === sessionId)
  if (!session) {
    return { text: `prizm_set_result: 会话 ${sessionId} 不存在`, isError: true }
  }

  if (session.kind !== 'background') {
    return { text: 'prizm_set_result: 此工具仅在后台会话中生效，当前为交互会话。' }
  }

  const ioOutput = session.bgMeta?.ioConfig?.outputParams
  const status = typeof args.status === 'string' ? args.status : 'success'

  let output: string
  let structuredData: string | undefined
  let artifacts: string[] | undefined

  if (ioOutput) {
    // 动态模式：将 output schema 定义的字段打包为 structuredData
    const schemaFields: Record<string, unknown> = {}
    const textParts: string[] = []

    for (const fieldName of Object.keys(ioOutput.schema)) {
      if (args[fieldName] !== undefined) {
        schemaFields[fieldName] = args[fieldName]
        const val = args[fieldName]
        textParts.push(`${fieldName}: ${typeof val === 'string' ? val.slice(0, 200) : JSON.stringify(val).slice(0, 200)}`)
      }
    }

    if (Object.keys(schemaFields).length === 0) {
      return { text: 'prizm_set_result: 至少需要提供一个输出字段', isError: true }
    }

    structuredData = JSON.stringify(schemaFields)
    // bgResult 取第一个字符串字段的值，或拼接摘要
    const firstStringField = Object.entries(schemaFields).find(([, v]) => typeof v === 'string')
    output = firstStringField
      ? String(firstStringField[1])
      : textParts.join('\n')
  } else {
    // 默认模式
    output = typeof args.output === 'string' ? args.output : ''
    if (!output.trim()) {
      return { text: 'prizm_set_result: output 不能为空', isError: true }
    }
    structuredData = typeof args.structured_data === 'string' ? args.structured_data : undefined
    if (Array.isArray(args.artifacts)) {
      artifacts = args.artifacts.filter((a): a is string => typeof a === 'string')
      if (artifacts.length === 0) artifacts = undefined
    }
  }

  session.bgResult = output
  session.bgStatus = status === 'failed' ? 'failed' : 'completed'
  session.bgStructuredData = structuredData
  session.bgArtifacts = artifacts
  session.finishedAt = Date.now()
  session.updatedAt = Date.now()
  scopeStore.saveScope(scope)

  ctx.emitAudit({
    toolName: 'prizm_set_result',
    action: 'bg_set_result',
    resourceType: 'session',
    resourceId: sessionId,
    result: 'success',
    detail: `status=${status}, output_length=${output.length}`
  })

  log.info('BG session result set:', sessionId, 'status:', status)

  const resultInfo = [`结果已提交（状态: ${status}，长度: ${output.length} 字符）`]
  if (structuredData) {
    resultInfo.push(`结构化数据已附加（${structuredData.length} 字符）`)
  }
  if (artifacts?.length) {
    resultInfo.push(`产出文件: ${artifacts.join(', ')}`)
  }
  return { text: resultInfo.join('\n') }
}

/**
 * prizm_spawn_task — 派发子任务（通过 TaskRunner）
 */
export async function executeSpawnTask(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { scope, sessionId, args } = ctx
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (!task) {
    return { text: 'prizm_spawn_task: task 参数不能为空', isError: true }
  }

  const mode = typeof args.mode === 'string' ? args.mode : 'async'
  const label = typeof args.label === 'string' ? args.label : undefined
  const model = typeof args.model === 'string' ? args.model : undefined
  const contextStr = typeof args.context === 'string' ? args.context : undefined
  const expectedOutput = typeof args.expected_output === 'string' ? args.expected_output : undefined
  const timeoutSeconds = typeof args.timeout_seconds === 'number' ? args.timeout_seconds : 600

  let parsedContext: Record<string, unknown> | undefined
  if (contextStr) {
    try {
      parsedContext = JSON.parse(contextStr)
    } catch {
      return { text: 'prizm_spawn_task: context 参数不是合法的 JSON 字符串', isError: true }
    }
  }

  ctx.emitAudit({
    toolName: 'prizm_spawn_task',
    action: 'spawn',
    resourceType: 'session',
    resourceId: sessionId ?? '',
    result: 'success',
    detail: `spawn mode=${mode}, label=${label ?? '(none)'}`
  })

  try {
    const taskRunner = getTaskRunner()
    const input = {
      prompt: task,
      context: parsedContext,
      expectedOutputFormat: expectedOutput,
      model,
      timeoutMs: timeoutSeconds * 1000,
      label
    }
    const meta = {
      triggerType: 'tool_spawn' as const,
      parentSessionId: sessionId
    }

    if (mode === 'sync') {
      const taskRun = await taskRunner.triggerSync(scope, input, meta)
      return {
        text: [
          `子任务完成（${taskRun.status}）`,
          `任务 ID: ${taskRun.id}`,
          taskRun.sessionId ? `会话 ID: ${taskRun.sessionId}` : '',
          `耗时: ${taskRun.durationMs}ms`,
          '---',
          taskRun.output ?? '(无输出)'
        ].filter(Boolean).join('\n')
      }
    } else {
      const { taskId } = await taskRunner.trigger(scope, input, meta)
      return {
        text: [
          '子任务已派发（异步执行中）',
          `任务 ID: ${taskId}`,
          `标签: ${label ?? '(无)'}`,
          '',
          '使用 prizm_task_status({ action: "status", task_id: "' + taskId + '" }) 查询进度。'
        ].join('\n')
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `prizm_spawn_task 失败: ${msg}`, isError: true }
  }
}

/**
 * prizm_task_status — 查询/管理任务（通过 TaskRunner）
 */
export async function executeTaskStatus(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { scope, sessionId, args } = ctx
  const action = typeof args.action === 'string' ? args.action : ''
  const taskId = typeof args.task_id === 'string' ? args.task_id : undefined

  const taskRunner = getTaskRunner()

  switch (action) {
    case 'list': {
      const tasks = taskRunner.list(scope, { parentSessionId: sessionId ?? undefined })
      if (tasks.length === 0) {
        return { text: '当前无子任务。' }
      }
      const lines = tasks.map(
        (t) => `- [${t.status}] ${t.label ?? t.id} (ID: ${t.id})`
      )
      return { text: `子任务列表 (${tasks.length}):\n${lines.join('\n')}` }
    }

    case 'status': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      const task = taskRunner.getStatus(taskId)
      if (!task) {
        return { text: `任务 ${taskId} 未找到。` }
      }
      if (task.status === 'running' || task.status === 'pending') {
        return { text: `任务 ${taskId} 正在执行中...（状态: ${task.status}）` }
      }
      return {
        text: [
          `任务 ${taskId} 状态: ${task.status}`,
          `耗时: ${task.durationMs ?? 0}ms`,
          task.output ? `结果预览: ${task.output.slice(0, 500)}` : '(无输出)'
        ].join('\n')
      }
    }

    case 'result': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      const task = taskRunner.getStatus(taskId)
      if (!task) {
        return { text: `任务 ${taskId} 结果不可用（不存在）。` }
      }
      if (!task.output) {
        return { text: `任务 ${taskId} 结果不可用（未完成）。` }
      }
      return { text: task.output }
    }

    case 'cancel': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      try {
        const ok = await taskRunner.cancel(taskId)
        return ok
          ? { text: `任务 ${taskId} 已取消。` }
          : { text: `任务 ${taskId} 无法取消（可能已完成或不存在）。` }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { text: `取消失败: ${msg}`, isError: true }
      }
    }

    default:
      return { text: `prizm_task_status: 未知 action "${action}"`, isError: true }
  }
}
