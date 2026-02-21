/**
 * @ 引用注册表单元测试
 * 覆盖：registerAtReference、getAtReference、resolveKey、listAtReferences、
 * unregisterAtReference、别名解析、registerBuiltinAtReferences 不重复注册
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerAtReference,
  unregisterAtReference,
  getAtReference,
  resolveKey,
  listAtReferences,
  registerBuiltinAtReferences,
  type AtReferenceDef
} from './atReferenceRegistry'

function mockAtRef(key: string, label: string): AtReferenceDef {
  return {
    key,
    label,
    resolveRef: vi.fn().mockResolvedValue(null),
    builtin: false
  }
}

describe('registerAtReference / getAtReference', () => {
  beforeEach(() => {
    unregisterAtReference('doc')
    unregisterAtReference('custom')
  })

  it('registers and retrieves by key', () => {
    const def = mockAtRef('doc', '文档')
    registerAtReference(def)
    expect(getAtReference('doc')).toBe(def)
  })

  it('retrieves by alias when aliases are set', () => {
    const def = mockAtRef('doc', '文档')
    def.aliases = ['文档', 'note']
    registerAtReference(def)
    expect(getAtReference('文档')).toBe(def)
    expect(getAtReference('note')).toBe(def)
  })

  it('key lookup is case-insensitive', () => {
    const def = mockAtRef('doc', '文档')
    registerAtReference(def)
    expect(getAtReference('DOC')).toBe(def)
  })

  it('returns null for unregistered key', () => {
    expect(getAtReference('nonexistent')).toBeNull()
  })

  it('overwriting same key replaces and updates aliases', () => {
    const def1 = mockAtRef('custom', 'Old')
    def1.aliases = ['old']
    registerAtReference(def1)
    const def2 = mockAtRef('custom', 'New')
    def2.aliases = ['new']
    registerAtReference(def2)
    expect(getAtReference('custom')).toBe(def2)
    expect(getAtReference('new')).toBe(def2)
    expect(getAtReference('old')).toBeNull()
  })
})

describe('resolveKey', () => {
  beforeEach(() => {
    unregisterAtReference('doc')
  })

  it('returns canonical key for registered def', () => {
    registerAtReference(mockAtRef('doc', '文档'))
    expect(resolveKey('doc')).toBe('doc')
    expect(resolveKey('DOC')).toBe('doc')
  })

  it('returns key when resolved via alias', () => {
    const def = mockAtRef('doc', '文档')
    def.aliases = ['note']
    registerAtReference(def)
    expect(resolveKey('note')).toBe('doc')
  })

  it('returns null for unknown key or alias', () => {
    expect(resolveKey('unknown')).toBeNull()
    expect(resolveKey('')).toBeNull()
  })
})

describe('listAtReferences', () => {
  beforeEach(() => {
    unregisterAtReference('doc')
    unregisterAtReference('todo')
    unregisterAtReference('custom')
  })

  it('returns empty when nothing registered', () => {
    expect(listAtReferences()).toEqual([])
  })

  it('returns all registered defs', () => {
    const d1 = mockAtRef('doc', '文档')
    const d2 = mockAtRef('todo', '待办')
    registerAtReference(d1)
    registerAtReference(d2)
    const list = listAtReferences()
    expect(list).toContain(d1)
    expect(list).toContain(d2)
    expect(list.length).toBe(2)
  })
})

describe('unregisterAtReference', () => {
  beforeEach(() => {
    unregisterAtReference('doc')
  })

  it('removes def and aliases', () => {
    const def = mockAtRef('doc', '文档')
    def.aliases = ['note']
    registerAtReference(def)
    unregisterAtReference('doc')
    expect(getAtReference('doc')).toBeNull()
    expect(getAtReference('note')).toBeNull()
  })

  it('no-op when key not registered', () => {
    expect(() => unregisterAtReference('nonexistent')).not.toThrow()
  })
})

describe('registerBuiltinAtReferences', () => {
  it('registers without throw and doc is available', () => {
    registerBuiltinAtReferences()
    const ref = getAtReference('doc')
    expect(ref).not.toBeNull()
    expect(ref?.key).toBe('doc')
    expect(ref?.builtin).toBe(true)
  })

  it('note alias resolves and has 便签 label', () => {
    registerBuiltinAtReferences()
    const noteDef = getAtReference('note')
    const docDef = getAtReference('doc')
    expect(noteDef).not.toBeNull()
    expect(noteDef?.key).toBe('note')
    expect(noteDef?.label).toBe('便签')
    expect(resolveKey('note')).toBe('note')
    expect(resolveKey('便签')).toBe('note')
    expect(docDef?.key).toBe('doc')
  })
})
