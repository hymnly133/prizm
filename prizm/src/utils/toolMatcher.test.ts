import { describe, it, expect } from 'vitest'
import { matchToolPattern, extractToolPaths } from './toolMatcher'

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
