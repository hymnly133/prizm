/**
 * 片段：workflow_context（工作流步骤上下文，仅 background_workflow_step）
 */

import type { BgSessionMeta } from '@prizm/shared'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

function truncateOutput(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

async function buildWorkflowContextFromMeta(bgMeta: BgSessionMeta): Promise<string | null> {
  if (bgMeta.source !== 'workflow' || !bgMeta.sourceId) return null

  let run: import('@prizm/shared').WorkflowRun | null = null
  try {
    const { getRunById } = await import('../../../core/workflowEngine/resumeStore.js')
    run = getRunById(bgMeta.sourceId)
  } catch {
    return null
  }

  const lines: string[] = ['<workflow_context>']

  if (run) {
    lines.push(`工作流: ${run.workflowName} | 运行: ${run.id}`)
    const completedSteps = Object.entries(run.stepResults).filter(
      ([, r]) => r.status === 'completed' || r.status === 'skipped'
    )
    const stepId = bgMeta.label?.replace(/^workflow:/, '')
    if (stepId) {
      lines.push(`当前步骤: ${stepId} (已完成 ${completedSteps.length} 步)`)
    }
    if (bgMeta.workflowStepIds?.length) {
      lines.push(`步骤序列: [${bgMeta.workflowStepIds.join(', ')}]`)
      lines.push(`下一步: ${bgMeta.workflowNextStepId ?? '无'}`)
    }
    const withOutput = completedSteps.filter(([, r]) => r.output)
    if (withOutput.length > 0) {
      lines.push('')
      lines.push('前序步骤结果:')
      for (const [sid, result] of withOutput) {
        const preview = truncateOutput(result.output!, 300)
        lines.push(`· ${sid}[${result.status}]: ${preview}`)
      }
    }
    if (run.args && Object.keys(run.args).length > 0) {
      lines.push('')
      lines.push('工作流参数:')
      for (const [k, v] of Object.entries(run.args)) {
        const valStr = typeof v === 'string' ? v : JSON.stringify(v)
        lines.push(`· ${k} = ${truncateOutput(valStr, 200)}`)
      }
    }
  } else {
    lines.push(`工作流运行 ID: ${bgMeta.sourceId}`)
  }

  if (bgMeta.workspaceDir) {
    const hasPersistent =
      !!bgMeta.persistentWorkspaceDir && bgMeta.persistentWorkspaceDir !== bgMeta.workspaceDir
    lines.push('')
    lines.push('工作区使用（非必要不使用、不冗余）：')
    lines.push('· main / workflow：除非步骤或用户明确要求，严禁使用。')
    lines.push(
      `· run：路径 ${bgMeta.workspaceDir}；仅当确有需要在步骤间通过文件传递、且不适合直接通过 prizm_set_result 传递时使用；优先用 prizm_set_result，避免在 run 中重复存放。相对路径与 workspace:"run" 默认指向此处。`
    )
    lines.push('· session：本次步骤的临时文件，仅当确实需要中间文件时使用。')
    if (hasPersistent && bgMeta.persistentWorkspaceDir) {
      lines.push(`· workflow 工作区路径：${bgMeta.persistentWorkspaceDir}（除非要求严禁使用）。`)
    }
    lines.push('· 使用 prizm_file 时通过 workspace 指定 "run" 或 "session"，非必要不写 main/workflow。')
  }

  lines.push('</workflow_context>')
  return lines.join('\n')
}

export const workflow_context: SegmentBuilder = async (
  ctx: PromptBuildContext,
  scenario: PromptScenario
): Promise<string> => {
  if (scenario !== 'background_workflow_step' || !ctx.session?.bgMeta) return ''
  return (await buildWorkflowContextFromMeta(ctx.session.bgMeta)) ?? ''
}
