/**
 * 后台任务相关工具：prizm_set_result / prizm_spawn_task / prizm_task_status
 */

import type { BuiltinToolContext, BuiltinToolResult } from './types'
import { scopeStore } from '../../core/ScopeStore'
import { bgSessionManager } from '../../core/backgroundSession'
import { createLogger } from '../../logger'

const log = createLogger('TaskTools')

/**
 * prizm_set_result — 设置当前 BG Session 的执行结果
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

  const output = typeof args.output === 'string' ? args.output : ''
  if (!output.trim()) {
    return { text: 'prizm_set_result: output 不能为空', isError: true }
  }

  const status = typeof args.status === 'string' ? args.status : 'success'
  const structuredData = typeof args.structured_data === 'string' ? args.structured_data : undefined

  session.bgResult = output
  session.bgStatus = status === 'failed' ? 'failed' : 'completed'
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
  return { text: resultInfo.join('\n') }
}

/**
 * prizm_spawn_task — 派发子任务到后台会话执行
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

  const parentSession = sessionId
    ? scopeStore.getScopeData(scope).agentSessions.find((s) => s.id === sessionId)
    : null
  const parentDepth = parentSession?.bgMeta?.depth ?? 0

  const payload = {
    prompt: task,
    context: parsedContext,
    expectedOutputFormat: expectedOutput
  }

  const meta = {
    triggerType: 'tool_spawn' as const,
    parentSessionId: sessionId,
    label,
    model,
    timeoutMs: timeoutSeconds * 1000,
    depth: parentDepth + 1,
    announceTarget: sessionId ? { sessionId, scope } : undefined
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
    if (mode === 'sync') {
      const result = await bgSessionManager.triggerSync(scope, payload, meta, {
        timeoutMs: timeoutSeconds * 1000
      })
      return {
        text: [
          `子任务完成（${result.status}）`,
          `会话 ID: ${result.sessionId}`,
          `耗时: ${result.durationMs}ms`,
          '---',
          result.output
        ].join('\n')
      }
    } else {
      const { sessionId: bgId, promise: _ } = await bgSessionManager.trigger(scope, payload, meta)
      return {
        text: [
          '子任务已派发（异步执行中）',
          `任务 ID: ${bgId}`,
          `标签: ${label ?? '(无)'}`,
          '',
          '使用 prizm_task_status({ action: "status", task_id: "' + bgId + '" }) 查询进度。'
        ].join('\n')
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `prizm_spawn_task 失败: ${msg}`, isError: true }
  }
}

/**
 * prizm_task_status — 查询/管理后台任务
 */
export async function executeTaskStatus(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const { scope, sessionId, args } = ctx
  const action = typeof args.action === 'string' ? args.action : ''
  const taskId = typeof args.task_id === 'string' ? args.task_id : undefined

  switch (action) {
    case 'list': {
      const sessions = await bgSessionManager.list(scope, {
        parentSessionId: sessionId
      })
      if (sessions.length === 0) {
        return { text: '当前无子任务。' }
      }
      const lines = sessions.map(
        (s) =>
          `- [${s.bgStatus ?? 'unknown'}] ${s.bgMeta?.label ?? s.id} (ID: ${s.id})`
      )
      return { text: `子任务列表 (${sessions.length}):\n${lines.join('\n')}` }
    }

    case 'status': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      const result = await bgSessionManager.getResult(scope, taskId)
      if (!result) {
        const isRunning = bgSessionManager.isRunning(taskId)
        return {
          text: isRunning
            ? `任务 ${taskId} 正在执行中...`
            : `任务 ${taskId} 未找到或尚未完成。`
        }
      }
      return {
        text: [
          `任务 ${taskId} 状态: ${result.status}`,
          `耗时: ${result.durationMs}ms`,
          result.output ? `结果预览: ${result.output.slice(0, 500)}` : '(无输出)'
        ].join('\n')
      }
    }

    case 'result': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      const result = await bgSessionManager.getResult(scope, taskId)
      if (!result) {
        return { text: `任务 ${taskId} 结果不可用（未完成或不存在）。` }
      }
      return { text: result.output || '(无输出)' }
    }

    case 'cancel': {
      if (!taskId) return { text: 'task_id 参数必需', isError: true }
      try {
        await bgSessionManager.cancel(scope, taskId)
        return { text: `任务 ${taskId} 已取消。` }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { text: `取消失败: ${msg}`, isError: true }
      }
    }

    default:
      return { text: `prizm_task_status: 未知 action "${action}"`, isError: true }
  }
}
