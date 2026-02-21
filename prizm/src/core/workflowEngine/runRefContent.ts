/**
 * Run 引用内容构建 — 与 @run 引用解析、prizm_workflow status 共用
 *
 * 产出「全量 run JSON + .meta 运行日志」，保证发送前引用与对话内 status 内容一致。
 */

import * as fs from 'fs'
import { getWorkflowRunMetaPath } from '../PathProviderCore'
import type { WorkflowRun } from '@prizm/shared'

/**
 * 读取 .meta/runs/{runId}.md 的完整内容；无文件或读失败则返回 null。
 */
function readRunMetaFileContent(scopeRoot: string, workflowName: string, runId: string): string | null {
  try {
    const filePath = getWorkflowRunMetaPath(scopeRoot, workflowName, runId)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 构建 run 的完整 content：全量 JSON + 若存在则追加「## Run 运行日志」+ .meta 文件原文。
 * 供 builtinRefs 与 workflowTools.executeStatus 共用，保证与 @run 引用内容一致。
 */
export function buildRunRefContent(scopeRoot: string, run: WorkflowRun): string {
  const payload = {
    id: run.id,
    workflowName: run.workflowName,
    scope: run.scope,
    status: run.status,
    currentStepIndex: run.currentStepIndex,
    stepResults: run.stepResults,
    args: run.args,
    error: run.error,
    errorDetail: run.errorDetail,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    triggerType: run.triggerType,
    resumeToken: run.resumeToken,
    linkedScheduleId: run.linkedScheduleId,
    linkedTodoId: run.linkedTodoId
  }
  const jsonPart = JSON.stringify(payload, null, 2)
  const metaRaw = readRunMetaFileContent(scopeRoot, run.workflowName, run.id)
  if (!metaRaw) return jsonPart
  return jsonPart + '\n\n## Run 运行日志\n\n' + metaRaw
}
