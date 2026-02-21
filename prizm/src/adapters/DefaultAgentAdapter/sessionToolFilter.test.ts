/**
 * sessionToolFilter.test.ts — 工作流管理会话工具过滤
 *
 * 覆盖：kind=tool 或 kind=background 且 source=workflow-management 时仅排除 prizm_navigate，保留 prizm_workflow；
 * 其他会话类型原样返回。
 */

import { describe, it, expect } from 'vitest'
import { WORKFLOW_MANAGEMENT_SOURCE } from '@prizm/shared'
import {
  filterWorkflowBuilderForSession,
  isWorkflowManagementSession,
  PRIZM_WORKFLOW_ENGINE_TOOL_NAME
} from './sessionToolFilter'
import type { LLMTool } from '../interfaces'

function makeTool(name: string): LLMTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} desc`,
      parameters: { type: 'object', properties: {} }
    }
  }
}

const TOOLS_WITH_NAVIGATE_AND_WORKFLOW: LLMTool[] = [
  makeTool('prizm_read_document'),
  makeTool('prizm_navigate'),
  makeTool(PRIZM_WORKFLOW_ENGINE_TOOL_NAME),
  makeTool('prizm_write_document')
]

describe('filterWorkflowBuilderForSession', () => {
  it('kind=tool 且 toolMeta.source=workflow-management 时仅排除 prizm_navigate，保留 prizm_workflow', () => {
    const sessionData = {
      kind: 'tool' as const,
      toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE }
    }
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, sessionData)
    expect(result.map((t) => t.function.name)).toEqual([
      'prizm_read_document',
      PRIZM_WORKFLOW_ENGINE_TOOL_NAME,
      'prizm_write_document'
    ])
    expect(result.map((t) => t.function.name)).not.toContain('prizm_navigate')
  })

  it('kind=tool 且 toolMeta.source=workflow_management（旧值）时仍识别为工作流管理', () => {
    const sessionData = {
      kind: 'tool' as const,
      toolMeta: { source: 'workflow_management' as const }
    }
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, sessionData)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.function.name)).not.toContain('prizm_navigate')
    expect(result.map((t) => t.function.name)).toContain(PRIZM_WORKFLOW_ENGINE_TOOL_NAME)
  })

  it('kind=background 且 source=workflow-management 时仅排除 prizm_navigate（兼容旧数据）', () => {
    const sessionData = { kind: 'background' as const, bgMeta: { source: WORKFLOW_MANAGEMENT_SOURCE } }
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, sessionData)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.function.name)).not.toContain('prizm_navigate')
    expect(result.map((t) => t.function.name)).toContain(PRIZM_WORKFLOW_ENGINE_TOOL_NAME)
  })

  it('kind=background 但 source 非 workflow-management 时原样返回', () => {
    const sessionData = { kind: 'background' as const, bgMeta: { source: 'api' as const } }
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, sessionData)
    expect(result).toHaveLength(4)
    expect(result).toEqual(TOOLS_WITH_NAVIGATE_AND_WORKFLOW)
  })

  it('kind=interactive 时原样返回', () => {
    const sessionData = { kind: 'interactive' as const }
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, sessionData)
    expect(result).toHaveLength(4)
    expect(result).toEqual(TOOLS_WITH_NAVIGATE_AND_WORKFLOW)
  })

  it('sessionData 为 undefined 时原样返回', () => {
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, undefined)
    expect(result).toHaveLength(4)
    expect(result).toEqual(TOOLS_WITH_NAVIGATE_AND_WORKFLOW)
  })

  it('sessionData 为 null 时原样返回', () => {
    const result = filterWorkflowBuilderForSession(TOOLS_WITH_NAVIGATE_AND_WORKFLOW, null)
    expect(result).toHaveLength(4)
  })

  it('工具列表无 navigate/workflow 时工作流管理会话原样返回', () => {
    const tools = [makeTool('prizm_read_document'), makeTool('prizm_write_document')]
    const sessionData = { kind: 'tool' as const, toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE } }
    const result = filterWorkflowBuilderForSession(tools, sessionData)
    expect(result).toHaveLength(2)
    expect(result).toEqual(tools)
  })

  it('工作流管理会话仅含 prizm_navigate 与 prizm_workflow 时只保留 prizm_workflow', () => {
    const tools = [
      makeTool('prizm_navigate'),
      makeTool(PRIZM_WORKFLOW_ENGINE_TOOL_NAME)
    ]
    const sessionData = { kind: 'tool' as const, toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE } }
    const result = filterWorkflowBuilderForSession(tools, sessionData)
    expect(result).toHaveLength(1)
    expect(result[0].function.name).toBe(PRIZM_WORKFLOW_ENGINE_TOOL_NAME)
  })
})

describe('isWorkflowManagementSession', () => {
  it('returns true for kind=tool + workflow-management', () => {
    expect(isWorkflowManagementSession({ kind: 'tool', toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE } })).toBe(true)
  })
  it('returns true for kind=tool + legacy workflow_management（读取兼容）', () => {
    expect(isWorkflowManagementSession({ kind: 'tool', toolMeta: { source: 'workflow_management' } })).toBe(true)
  })
  it('returns true for background+workflow-management（兼容旧数据）', () => {
    expect(isWorkflowManagementSession({ kind: 'background', bgMeta: { source: WORKFLOW_MANAGEMENT_SOURCE } })).toBe(true)
  })
  it('returns false for kind=tool with other source', () => {
    expect(isWorkflowManagementSession({ kind: 'tool', toolMeta: { source: 'other' } })).toBe(false)
  })
  it('returns false for other source', () => {
    expect(isWorkflowManagementSession({ kind: 'background', bgMeta: { source: 'api' } })).toBe(false)
  })
  it('returns false for undefined or null', () => {
    expect(isWorkflowManagementSession(undefined)).toBe(false)
    expect(isWorkflowManagementSession(null)).toBe(false)
  })
})
