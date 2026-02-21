/**
 * 片段：workflow_management_context（工作流管理会话约束与授权说明）
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

interface WorkflowManagementMeta {
  workflowName?: string
  workflowDefId?: string
  persistentWorkspaceDir?: string
}

function buildWorkflowManagementContextBlock(
  meta: WorkflowManagementMeta,
  grantedPaths?: string[] | null
): string | null {
  if (!(meta.workflowDefId || meta.workflowName)) return null

  const lines: string[] = ['<workflow-management-context>']
  lines.push(
    `当前为工作流管理会话，仅负责该工作流的创建/修改/说明。工作流名称: ${meta.workflowName ?? '(未知)'}`
  )

  if (meta.persistentWorkspaceDir) {
    lines.push('')
    lines.push('工作区:')
    lines.push(`· workflow_workspace=${meta.persistentWorkspaceDir}`)
    lines.push(
      '· 创建文档或文件时，若需放在工作流工作区，请使用 workspace:"workflow" 或 prizm_file/prizm_document 的 workspace 参数指定 "workflow"'
    )
  }

  if (grantedPaths?.length) {
    lines.push('')
    lines.push(
      '· 当前已授权本次会话访问部分 run/步骤工作区路径，可通过 prizm_file、prizm_document 等工具使用上述授权路径（绝对路径）进行读写，便于查看某次运行的产出与步骤会话工作区。'
    )
  }

  lines.push('')
  lines.push('文档与工作区约束:')
  lines.push('· 除非用户明确要求，不要在主工作区（main）创建任何文档；主要利用工作流工作区（workspace:"workflow"）。')
  lines.push(
    '· 若用户明确要求文档，至多创建一份「工作流使用说明」类指导文档，须放在工作流工作区（workspace:"workflow"）；可标记为工作流描述文档。'
  )
  lines.push(
    '· 不得主动创建快速参考卡片、项目完成报告、优化建议、参数验证器、测试脚本、技术文档、运行示例、快速启动模板、使用指南等。'
  )
  lines.push('</workflow-management-context>')
  return lines.join('\n')
}

export const workflow_management_context: SegmentBuilder = (
  ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario !== 'tool_workflow_management' || !ctx.session) return ''

  const session = ctx.session as {
    toolMeta?: WorkflowManagementMeta
    bgMeta?: WorkflowManagementMeta
    grantedPaths?: string[] | null
  }
  const mgmtMeta = session.toolMeta ?? session.bgMeta
  if (!mgmtMeta) return ''
  return buildWorkflowManagementContextBlock(mgmtMeta, session.grantedPaths ?? ctx.grantedPaths) ?? ''
}
