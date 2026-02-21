import { describe, it, expect } from 'vitest'
import {
  matchToolPattern,
  extractToolPaths,
  extractInteractDetails,
  extractToolAction
} from './toolMatcher'

describe('matchToolPattern', () => {
  it('should match wildcard *', () => {
    expect(matchToolPattern('*', 'prizm_file')).toBe(true)
    expect(matchToolPattern('*', 'anything')).toBe(true)
  })

  it('should match exact tool name', () => {
    expect(matchToolPattern('prizm_file', 'prizm_file')).toBe(true)
    expect(matchToolPattern('prizm_file', 'prizm_todo')).toBe(false)
  })

  it('should match glob with trailing *', () => {
    expect(matchToolPattern('prizm_terminal_*', 'prizm_terminal_execute')).toBe(true)
    expect(matchToolPattern('prizm_terminal_*', 'prizm_terminal_spawn')).toBe(true)
    expect(matchToolPattern('prizm_terminal_*', 'prizm_file')).toBe(false)
  })

  it('should match glob with leading *', () => {
    expect(matchToolPattern('*_execute', 'prizm_terminal_execute')).toBe(true)
    expect(matchToolPattern('*_execute', 'prizm_terminal_spawn')).toBe(false)
  })

  it('should match glob with middle *', () => {
    expect(matchToolPattern('prizm_*_execute', 'prizm_terminal_execute')).toBe(true)
    expect(matchToolPattern('prizm_*_execute', 'prizm_file')).toBe(false)
  })

  it('should handle regex special chars in pattern', () => {
    expect(matchToolPattern('tool.name', 'tool.name')).toBe(true)
    expect(matchToolPattern('tool.name', 'toolXname')).toBe(false)
  })
})

describe('extractToolPaths', () => {
  it('should extract path field', () => {
    expect(extractToolPaths({ path: '/foo/bar.txt' })).toEqual(['/foo/bar.txt'])
  })

  it('should extract from and to fields', () => {
    expect(extractToolPaths({ from: '/a.txt', to: '/b.txt' })).toEqual(['/a.txt', '/b.txt'])
  })

  it('should extract all three fields', () => {
    expect(extractToolPaths({ path: '/p', from: '/f', to: '/t' })).toEqual(['/p', '/f', '/t'])
  })

  it('should ignore non-string and empty values', () => {
    expect(extractToolPaths({ path: 123, from: '', to: '  ' })).toEqual([])
  })

  it('should trim whitespace', () => {
    expect(extractToolPaths({ path: '  /foo  ' })).toEqual(['/foo'])
  })

  it('should return empty for no matching fields', () => {
    expect(extractToolPaths({ action: 'read', query: 'test' })).toEqual([])
  })
})

describe('extractToolAction', () => {
  it('should extract action field', () => {
    expect(extractToolAction({ action: 'write' })).toBe('write')
    expect(extractToolAction({ action: 'read' })).toBe('read')
  })

  it('should fallback to mode when action is missing', () => {
    expect(extractToolAction({ mode: 'create' })).toBe('create')
  })

  it('should prefer action over mode', () => {
    expect(extractToolAction({ action: 'update', mode: 'create' })).toBe('update')
  })

  it('should return empty string for non-string action/mode', () => {
    expect(extractToolAction({ action: 123 })).toBe('')
    expect(extractToolAction({ mode: null })).toBe('')
    expect(extractToolAction({})).toBe('')
  })
})

describe('extractInteractDetails', () => {
  describe('prizm_file', () => {
    it('should return file_access with paths from path/from/to', () => {
      expect(extractInteractDetails('prizm_file', { path: '/a.txt' })).toEqual({
        kind: 'file_access',
        paths: ['/a.txt']
      })
      expect(extractInteractDetails('prizm_file', { from: '/x', to: '/y' })).toEqual({
        kind: 'file_access',
        paths: ['/x', '/y']
      })
    })

    it('should ignore non-string and empty path fields', () => {
      expect(extractInteractDetails('prizm_file', { path: '', from: '  ' })).toEqual({
        kind: 'file_access',
        paths: []
      })
    })
  })

  describe('prizm_terminal_*', () => {
    it('should return terminal_command with command and optional cwd', () => {
      expect(extractInteractDetails('prizm_terminal_execute', { command: 'rm -rf /' })).toEqual({
        kind: 'terminal_command',
        command: 'rm -rf /',
        cwd: undefined
      })
      expect(
        extractInteractDetails('prizm_terminal_spawn', { command: 'ls', cwd: '/tmp' })
      ).toEqual({
        kind: 'terminal_command',
        command: 'ls',
        cwd: '/tmp'
      })
    })

    it('should use toolName as command when command is missing', () => {
      expect(extractInteractDetails('prizm_terminal_execute', {})).toEqual({
        kind: 'terminal_command',
        command: 'prizm_terminal_execute',
        cwd: undefined
      })
    })

    it('should ignore non-string command/cwd', () => {
      expect(
        extractInteractDetails('prizm_terminal_execute', { command: 123, cwd: null })
      ).toEqual({
        kind: 'terminal_command',
        command: 'prizm_terminal_execute',
        cwd: undefined
      })
    })
  })

  describe('prizm_document', () => {
    it('should return destructive_operation for delete', () => {
      expect(
        extractInteractDetails('prizm_document', {
          action: 'delete',
          documentId: 'doc-1',
          title: 'My Doc'
        })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'document',
        resourceId: 'doc-1',
        description: 'Delete document "My Doc"'
      })
    })

    it('should return destructive_operation for create', () => {
      expect(
        extractInteractDetails('prizm_document', { action: 'create', title: 'New Doc' })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'document',
        resourceId: '',
        description: 'Create document "New Doc"'
      })
    })

    it('should return destructive_operation for update (default description)', () => {
      expect(
        extractInteractDetails('prizm_document', {
          action: 'update',
          documentId: 'd1',
          title: 'T'
        })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'document',
        resourceId: 'd1',
        description: 'Update document "T"'
      })
    })

    it('should fallback to documentId when title is empty', () => {
      expect(
        extractInteractDetails('prizm_document', { action: 'delete', documentId: 'doc-1' })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'document',
        resourceId: 'doc-1',
        description: 'Delete document "doc-1"'
      })
    })
  })

  describe('prizm_cron', () => {
    it('should return destructive_operation for delete', () => {
      expect(
        extractInteractDetails('prizm_cron', {
          action: 'delete',
          jobId: 'job-1',
          name: 'Daily backup'
        })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'cron_job',
        resourceId: 'job-1',
        description: 'Delete cron job "Daily backup"'
      })
    })

    it('should return destructive_operation for create', () => {
      expect(
        extractInteractDetails('prizm_cron', { action: 'create', name: 'New job' })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'cron_job',
        resourceId: '',
        description: 'Create cron job "New job"'
      })
    })

    it('should fallback to jobId when name is empty', () => {
      expect(
        extractInteractDetails('prizm_cron', { action: 'delete', jobId: 'j1' })
      ).toEqual({
        kind: 'destructive_operation',
        resourceType: 'cron_job',
        resourceId: 'j1',
        description: 'Delete cron job "j1"'
      })
    })
  })

  describe('unknown tool with path-like args', () => {
    it('should return file_access when path/from/to present', () => {
      expect(extractInteractDetails('custom_tool', { path: '/foo' })).toEqual({
        kind: 'file_access',
        paths: ['/foo']
      })
    })
  })

  describe('unknown tool without paths', () => {
    it('should return custom with title and description', () => {
      expect(extractInteractDetails('unknown_tool', { action: 'run' })).toEqual({
        kind: 'custom',
        title: 'unknown_tool',
        description: 'Tool unknown_tool requires approval (action: run)'
      })
    })

    it('should handle missing action', () => {
      expect(extractInteractDetails('other_tool', {})).toEqual({
        kind: 'custom',
        title: 'other_tool',
        description: 'Tool other_tool requires approval (action: unknown)'
      })
    })

    it('should show unknown when action is not a string', () => {
      expect(extractInteractDetails('other_tool', { mode: 'install' })).toEqual({
        kind: 'custom',
        title: 'other_tool',
        description: 'Tool other_tool requires approval (action: unknown)'
      })
    })
  })
})
