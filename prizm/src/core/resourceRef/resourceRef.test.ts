/**
 * Tests for the resource ref system:
 * - URI parse/format helpers (from @prizm/shared)
 * - Registry list/resolve logic
 */

import { describe, it, expect } from 'vitest'
import {
  formatResourceURI,
  parseResourceURI,
  isResourceType,
  resolveResourceType,
  ALL_RESOURCE_TYPES,
  LISTABLE_RESOURCE_TYPES,
  RESOURCE_TYPE_META
} from '@prizm/shared'

describe('formatResourceURI', () => {
  it('formats short URI (no scope)', () => {
    expect(formatResourceURI({ type: 'doc', id: 'abc123' })).toBe('doc:abc123')
  })

  it('formats full URI with scope', () => {
    expect(formatResourceURI({ scope: 'default', type: 'doc', id: 'abc123' })).toBe(
      'default:doc:abc123'
    )
  })

  it('handles all resource types', () => {
    for (const type of ALL_RESOURCE_TYPES) {
      const result = formatResourceURI({ type, id: 'test-id' })
      expect(result).toBe(`${type}:test-id`)
    }
  })

  it('omits scope when scope is empty string', () => {
    expect(formatResourceURI({ scope: '', type: 'doc', id: 'x' })).toBe('doc:x')
  })
})

describe('parseResourceURI', () => {
  it('parses two-segment URI', () => {
    expect(parseResourceURI('doc:abc123')).toEqual({ type: 'doc', id: 'abc123' })
  })

  it('parses three-segment URI (with scope)', () => {
    expect(parseResourceURI('default:doc:abc123')).toEqual({
      scope: 'default',
      type: 'doc',
      id: 'abc123'
    })
  })

  it('handles IDs with colons (file paths)', () => {
    expect(parseResourceURI('file:C:/Users/test/file.txt')).toEqual({
      type: 'file',
      id: 'C:/Users/test/file.txt'
    })
  })

  it('handles scope + ID with colons', () => {
    expect(parseResourceURI('default:file:C:/test')).toEqual({
      scope: 'default',
      type: 'file',
      id: 'C:/test'
    })
  })

  it('returns null for invalid type', () => {
    expect(parseResourceURI('invalid:abc123')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseResourceURI('')).toBeNull()
  })

  it('returns null for single segment', () => {
    expect(parseResourceURI('doc')).toBeNull()
  })

  it('returns null for empty segments', () => {
    expect(parseResourceURI(':doc:abc')).toBeNull()
    expect(parseResourceURI('doc:')).toBeNull()
  })

  it('roundtrips all types', () => {
    for (const type of ALL_RESOURCE_TYPES) {
      const uri = { type, id: 'test-id-123' } as const
      expect(parseResourceURI(formatResourceURI(uri))).toEqual(uri)
    }
  })

  it('roundtrips with scope', () => {
    const uri = { scope: 'myScope', type: 'workflow' as const, id: 'my-flow' }
    expect(parseResourceURI(formatResourceURI(uri))).toEqual(uri)
  })

  it('returns null for null or undefined input', () => {
    expect(parseResourceURI(null as unknown as string)).toBeNull()
    expect(parseResourceURI(undefined as unknown as string)).toBeNull()
  })

  it('parses scope:type:id when id contains multiple colons', () => {
    expect(parseResourceURI('default:file:C:/a/b/c.txt')).toEqual({
      scope: 'default',
      type: 'file',
      id: 'C:/a/b/c.txt'
    })
  })

  it('prefers scope:type:id when second segment is valid type', () => {
    expect(parseResourceURI('myScope:doc:single-id')).toEqual({
      scope: 'myScope',
      type: 'doc',
      id: 'single-id'
    })
  })

  it('returns null for non-string input', () => {
    expect(parseResourceURI(123 as unknown as string)).toBeNull()
  })

  it('handles id with unicode', () => {
    expect(parseResourceURI('doc:文档-1')).toEqual({ type: 'doc', id: '文档-1' })
  })

  it('handles id with hyphens and underscores', () => {
    expect(parseResourceURI('workflow:my_workflow-id')).toEqual({
      type: 'workflow',
      id: 'my_workflow-id'
    })
  })
})

describe('isResourceType', () => {
  it('returns true for valid types', () => {
    expect(isResourceType('doc')).toBe(true)
    expect(isResourceType('todo')).toBe(true)
    expect(isResourceType('workflow')).toBe(true)
    expect(isResourceType('run')).toBe(true)
    expect(isResourceType('memory')).toBe(true)
  })

  it('returns false for invalid types', () => {
    expect(isResourceType('document')).toBe(false)
    expect(isResourceType('note')).toBe(false)
    expect(isResourceType('random')).toBe(false)
  })
})

describe('resolveResourceType', () => {
  it('resolves canonical type keys', () => {
    expect(resolveResourceType('doc')).toBe('doc')
    expect(resolveResourceType('todo')).toBe('todo')
    expect(resolveResourceType('workflow')).toBe('workflow')
  })

  it('resolves Chinese aliases', () => {
    expect(resolveResourceType('文档')).toBe('doc')
    expect(resolveResourceType('待办')).toBe('todo')
    expect(resolveResourceType('工作流')).toBe('workflow')
    expect(resolveResourceType('日程')).toBe('schedule')
    expect(resolveResourceType('记忆')).toBe('memory')
  })

  it('resolves note alias to doc', () => {
    expect(resolveResourceType('note')).toBe('doc')
  })

  it('resolves 便签 alias to doc', () => {
    expect(resolveResourceType('便签')).toBe('doc')
  })

  it('returns null for unknown alias', () => {
    expect(resolveResourceType('unknown')).toBeNull()
    expect(resolveResourceType('')).toBeNull()
  })

  it('resolves case-insensitively', () => {
    expect(resolveResourceType('DOC')).toBe('doc')
    expect(resolveResourceType('Workflow')).toBe('workflow')
  })
})

describe('RESOURCE_TYPE_META', () => {
  it('has metadata for all types', () => {
    for (const type of ALL_RESOURCE_TYPES) {
      expect(RESOURCE_TYPE_META[type]).toBeDefined()
      expect(RESOURCE_TYPE_META[type].label).toBeTruthy()
      expect(RESOURCE_TYPE_META[type].icon).toBeTruthy()
    }
  })

  it('LISTABLE_RESOURCE_TYPES excludes file and memory', () => {
    expect(LISTABLE_RESOURCE_TYPES).not.toContain('file')
    expect(LISTABLE_RESOURCE_TYPES).not.toContain('memory')
    expect(LISTABLE_RESOURCE_TYPES).toContain('doc')
    expect(LISTABLE_RESOURCE_TYPES).toContain('workflow')
    expect(LISTABLE_RESOURCE_TYPES).toContain('schedule')
  })
})
