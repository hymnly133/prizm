/**
 * 内置资源引用注册测试
 * 覆盖：registerBuiltinResourceRefs 注册 10 种类型、list/resolve 可调用不抛错
 */
import { describe, it, expect } from 'vitest'
import { registerBuiltinResourceRefs } from './builtinRefs'
import { listRegisteredTypes, listResources, resolveResource } from './registry'

const BUILTIN_TYPES = [
  'doc',
  'todo',
  'file',
  'workflow',
  'run',
  'task',
  'session',
  'schedule',
  'cron',
  'memory'
] as const

describe('registerBuiltinResourceRefs', () => {
  it('registers all 10 builtin resource types', () => {
    registerBuiltinResourceRefs()
    const registered = listRegisteredTypes()
    for (const t of BUILTIN_TYPES) {
      expect(registered).toContain(t)
    }
    expect(registered.length).toBe(10)
  })

  it('idempotent: second call does not duplicate', () => {
    registerBuiltinResourceRefs()
    registerBuiltinResourceRefs()
    expect(listRegisteredTypes().length).toBe(10)
  })
})

describe('builtin listResources', () => {
  it('doc list returns array without throw', async () => {
    registerBuiltinResourceRefs()
    const result = await listResources('default', 'doc', 5)
    expect(Array.isArray(result)).toBe(true)
  })

  it('todo list returns array without throw', async () => {
    registerBuiltinResourceRefs()
    const result = await listResources('default', 'todo', 5)
    expect(Array.isArray(result)).toBe(true)
  })

  it('workflow list returns array without throw', async () => {
    registerBuiltinResourceRefs()
    const result = await listResources('default', 'workflow', 5)
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('builtin resolveResource', () => {
  it('doc resolve returns null for missing id without throw', async () => {
    registerBuiltinResourceRefs()
    const result = await resolveResource('default', 'doc', 'nonexistent-id-12345')
    expect(result).toBeNull()
  })

  it('todo resolve returns null for missing id without throw', async () => {
    registerBuiltinResourceRefs()
    const result = await resolveResource('default', 'todo', 'nonexistent-id-12345')
    expect(result).toBeNull()
  })
})
