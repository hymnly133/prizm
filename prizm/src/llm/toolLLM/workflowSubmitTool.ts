/**
 * Tool LLM — 内部精简工具集
 *
 * toolllm_submit_workflow：Tool LLM 提交工作流定义的唯一工具。
 * 服务端用 parseWorkflowDef 校验，校验失败返回错误让 LLM 修正。
 */

import type { LLMTool } from '../../adapters/interfaces'
import { parseWorkflowDef, serializeWorkflowDef, WorkflowParseError } from '../../core/workflowEngine'
import type { WorkflowDef } from '@prizm/shared'

/** Tool LLM 专用工具定义 */
export const TOOL_LLM_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'toolllm_submit_workflow',
      description: '提交工作流定义。参数为完整的 WorkflowDef JSON 对象。提交后由系统校验，校验失败会返回错误信息供你修正。',
      parameters: {
        type: 'object',
        properties: {
          workflow_json: {
            type: 'string',
            description: '完整的 WorkflowDef JSON 字符串'
          }
        },
        required: ['workflow_json']
      }
    }
  }
]

export interface SubmitToolResult {
  success: boolean
  workflowDef?: WorkflowDef
  yamlContent?: string
  error?: string
}

/** 执行 toolllm_submit_workflow 并校验 */
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
    return { success: false, error: `提交失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
