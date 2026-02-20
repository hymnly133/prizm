import { describe, it, expect } from 'vitest'
import type { LLMTool } from '../../adapters/interfaces'
import {
  filterToolsByGroups,
  resolveGroupStates,
  getToolGroupId,
  getToolGroup,
  getAllToolGroups,
  BUILTIN_TOOL_GROUPS
} from './toolGroups'

function makeTool(name: string): LLMTool {
  return { type: 'function', function: { name, description: `tool ${name}` } }
}

const sampleTools: LLMTool[] = [
  makeTool('prizm_file'),
  makeTool('prizm_promote_file'),
  makeTool('prizm_document'),
  makeTool('prizm_lock'),
  makeTool('prizm_todo'),
  makeTool('prizm_search'),
  makeTool('prizm_knowledge'),
  makeTool('prizm_terminal_execute'),
  makeTool('prizm_terminal_spawn'),
  makeTool('prizm_terminal_send_keys'),
  makeTool('prizm_set_result'),
  makeTool('prizm_spawn_task'),
  makeTool('prizm_task_status'),
  makeTool('prizm_schedule'),
  makeTool('prizm_cron'),
  makeTool('prizm_workflow'),
  makeTool('prizm_web_search'), // not in any group
  makeTool('mcp_some_tool')     // not in any group
]

describe('toolGroups', () => {
  describe('BUILTIN_TOOL_GROUPS', () => {
    it('should define 8 groups', () => {
      expect(BUILTIN_TOOL_GROUPS).toHaveLength(8)
    })

    it('should have unique group ids', () => {
      const ids = BUILTIN_TOOL_GROUPS.map((g) => g.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should not have overlapping tool names across groups', () => {
      const seen = new Set<string>()
      for (const group of BUILTIN_TOOL_GROUPS) {
        for (const tool of group.tools) {
          expect(seen.has(tool)).toBe(false)
          seen.add(tool)
        }
      }
    })
  })

  describe('getToolGroupId', () => {
    it('should return correct group for known tools', () => {
      expect(getToolGroupId('prizm_file')).toBe('workspace')
      expect(getToolGroupId('prizm_document')).toBe('document')
      expect(getToolGroupId('prizm_todo')).toBe('todo')
      expect(getToolGroupId('prizm_terminal_execute')).toBe('terminal')
      expect(getToolGroupId('prizm_workflow')).toBe('workflow')
    })

    it('should return undefined for unknown tools', () => {
      expect(getToolGroupId('prizm_web_search')).toBeUndefined()
      expect(getToolGroupId('mcp_some_tool')).toBeUndefined()
    })
  })

  describe('getToolGroup', () => {
    it('should return the group definition', () => {
      const group = getToolGroup('terminal')
      expect(group).toBeDefined()
      expect(group!.tools).toContain('prizm_terminal_execute')
    })

    it('should return undefined for unknown group', () => {
      expect(getToolGroup('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllToolGroups', () => {
    it('should return a copy of groups', () => {
      const groups = getAllToolGroups()
      expect(groups).toHaveLength(8)
      expect(groups).not.toBe(BUILTIN_TOOL_GROUPS)
    })
  })

  describe('filterToolsByGroups', () => {
    it('should keep all tools when config is undefined (all defaults enabled)', () => {
      const result = filterToolsByGroups(sampleTools, undefined)
      expect(result).toHaveLength(sampleTools.length)
    })

    it('should keep all tools when config is empty', () => {
      const result = filterToolsByGroups(sampleTools, {})
      expect(result).toHaveLength(sampleTools.length)
    })

    it('should remove tools from disabled groups', () => {
      const result = filterToolsByGroups(sampleTools, { terminal: false })
      const names = result.map((t) => t.function.name)
      expect(names).not.toContain('prizm_terminal_execute')
      expect(names).not.toContain('prizm_terminal_spawn')
      expect(names).not.toContain('prizm_terminal_send_keys')
      expect(names).toContain('prizm_file')
      expect(names).toContain('prizm_document')
    })

    it('should remove multiple disabled groups', () => {
      const result = filterToolsByGroups(sampleTools, { terminal: false, schedule: false })
      const names = result.map((t) => t.function.name)
      expect(names).not.toContain('prizm_terminal_execute')
      expect(names).not.toContain('prizm_schedule')
      expect(names).not.toContain('prizm_cron')
      expect(names).toContain('prizm_workflow')
    })

    it('should always keep tools not in any group', () => {
      const result = filterToolsByGroups(sampleTools, {
        workspace: false,
        document: false,
        todo: false,
        search: false,
        terminal: false,
        task: false,
        schedule: false,
        workflow: false
      })
      const names = result.map((t) => t.function.name)
      expect(names).toContain('prizm_web_search')
      expect(names).toContain('mcp_some_tool')
      expect(names).toHaveLength(2)
    })

    it('should handle explicitly enabling a group that is enabled by default', () => {
      const result = filterToolsByGroups(sampleTools, { terminal: true })
      const names = result.map((t) => t.function.name)
      expect(names).toContain('prizm_terminal_execute')
    })
  })

  describe('resolveGroupStates', () => {
    it('should return all groups with default state when config is undefined', () => {
      const states = resolveGroupStates(undefined)
      expect(states).toHaveLength(8)
      for (const state of states) {
        expect(state.enabled).toBe(true)
      }
    })

    it('should reflect config overrides', () => {
      const states = resolveGroupStates({ terminal: false, workflow: false })
      const terminalState = states.find((s) => s.id === 'terminal')
      const workflowState = states.find((s) => s.id === 'workflow')
      const searchState = states.find((s) => s.id === 'search')

      expect(terminalState!.enabled).toBe(false)
      expect(workflowState!.enabled).toBe(false)
      expect(searchState!.enabled).toBe(true)
    })

    it('should include tools list in each group state', () => {
      const states = resolveGroupStates(undefined)
      const workspace = states.find((s) => s.id === 'workspace')
      expect(workspace!.tools).toContain('prizm_file')
      expect(workspace!.tools).toContain('prizm_promote_file')
    })
  })
})
