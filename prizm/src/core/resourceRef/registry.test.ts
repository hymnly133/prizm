/**
 * 资源引用注册表单元测试
 * 覆盖：注册/注销、listResources、listAllResources、resolveResource、
 * resolveResourceAcrossScopes、searchResources、边界与错误路径
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ResourceType } from '@prizm/shared'
import {
  registerResourceRef,
  unregisterResourceRef,
  getResourceRefDef,
  listRegisteredTypes,
  listResources,
  listAllResources,
  resolveResource,
  resolveResourceAcrossScopes,
  searchResources
} from './registry'
import type { ResourceRefDef, ResourceRefItem, ResourceRefDetail } from './types'

const mockItem = (id: string, title: string): ResourceRefItem => ({
  id,
  type: 'doc',
  title,
  charCount: 10,
  updatedAt: Date.now()
})

const mockDetail = (id: string, title: string, content: string): ResourceRefDetail => ({
  ...mockItem(id, title),
  content
})

describe('registerResourceRef / unregisterResourceRef / getResourceRefDef', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
    unregisterResourceRef('todo')
  })

  it('registers a def and getResourceRefDef returns it', () => {
    const def: ResourceRefDef = {
      type: 'doc',
      list: vi.fn().mockResolvedValue([]),
      resolve: vi.fn().mockResolvedValue(null)
    }
    registerResourceRef(def)
    expect(getResourceRefDef('doc')).toBe(def)
  })

  it('unregister removes the def', () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null)
    })
    unregisterResourceRef('doc')
    expect(getResourceRefDef('doc')).toBeUndefined()
  })

  it('registering same type overwrites', () => {
    const def1: ResourceRefDef = {
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null)
    }
    const def2: ResourceRefDef = {
      type: 'doc',
      list: vi.fn().mockResolvedValue([mockItem('a', 'A')]),
      resolve: vi.fn().mockResolvedValue(null)
    }
    registerResourceRef(def1)
    registerResourceRef(def2)
    expect(getResourceRefDef('doc')).toBe(def2)
  })
})

describe('listRegisteredTypes', () => {
  beforeEach(() => {
    ;(['doc', 'todo', 'workflow'] as ResourceType[]).forEach((t) => unregisterResourceRef(t))
  })

  it('returns empty when nothing registered', () => {
    expect(listRegisteredTypes()).toEqual([])
  })

  it('returns all registered types', () => {
    registerResourceRef({ type: 'doc', resolve: vi.fn().mockResolvedValue(null) })
    registerResourceRef({ type: 'todo', resolve: vi.fn().mockResolvedValue(null) })
    expect(listRegisteredTypes()).toContain('doc')
    expect(listRegisteredTypes()).toContain('todo')
    expect(listRegisteredTypes().length).toBe(2)
  })
})

describe('listResources', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
  })

  it('calls def.list with scope and limit', async () => {
    const item = { ...mockItem('1', 'One'), updatedAt: 1 }
    const list = vi.fn().mockResolvedValue([item])
    registerResourceRef({
      type: 'doc',
      list,
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listResources('default', 'doc', 10)
    expect(list).toHaveBeenCalledWith('default', 10)
    expect(result).toEqual([item])
  })

  it('returns [] when def has no list', async () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listResources('default', 'doc')
    expect(result).toEqual([])
  })

  it('returns [] when type not registered', async () => {
    const result = await listResources('default', 'doc')
    expect(result).toEqual([])
  })

  it('returns [] and does not throw when list throws', async () => {
    const list = vi.fn().mockRejectedValue(new Error('list failed'))
    registerResourceRef({
      type: 'doc',
      list,
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listResources('default', 'doc')
    expect(result).toEqual([])
  })
})

describe('listAllResources', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
    unregisterResourceRef('todo')
  })

  it('aggregates and sorts by updatedAt desc', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockResolvedValue([
        { ...mockItem('a', 'A'), updatedAt: 50 },
        { ...mockItem('b', 'B'), updatedAt: 100 }
      ]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    registerResourceRef({
      type: 'todo',
      list: vi.fn().mockResolvedValue([{ ...mockItem('t1', 'T1'), updatedAt: 200 }]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listAllResources('default')
    expect(result.length).toBe(3)
    expect(result.map((r) => r.updatedAt)).toEqual([200, 100, 50])
  })

  it('respects options.types filter', async () => {
    const docList = vi.fn().mockResolvedValue([mockItem('d1', 'D1')])
    registerResourceRef({
      type: 'doc',
      list: docList,
      resolve: vi.fn().mockResolvedValue(null)
    })
    registerResourceRef({
      type: 'todo',
      list: vi.fn().mockResolvedValue([mockItem('t1', 'T1')]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listAllResources('default', { types: ['doc'] })
    expect(docList).toHaveBeenCalledWith('default', 50)
    expect(result.every((r) => r.type === 'doc')).toBe(true)
  })

  it('respects options.limit per type', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockImplementation((_scope: string, limit?: number) =>
        Promise.resolve(Array.from({ length: limit ?? 50 }, (_, i) => mockItem(`id-${i}`, `Title ${i}`)))
      ),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await listAllResources('default', { limit: 3 })
    expect(result.length).toBe(3)
  })
})

describe('resolveResource', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
  })

  it('calls def.resolve and returns detail', async () => {
    const detail = mockDetail('x', 'X', 'content')
    const resolve = vi.fn().mockResolvedValue(detail)
    registerResourceRef({
      type: 'doc',
      resolve
    })
    const result = await resolveResource('default', 'doc', 'x')
    expect(resolve).toHaveBeenCalledWith('default', 'x')
    expect(result).toEqual(detail)
  })

  it('returns null when type not registered', async () => {
    const result = await resolveResource('default', 'doc', 'any')
    expect(result).toBeNull()
  })

  it('returns null when resolve returns null', async () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await resolveResource('default', 'doc', 'missing')
    expect(result).toBeNull()
  })

  it('returns null when resolve throws', async () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockRejectedValue(new Error('resolve failed'))
    })
    const result = await resolveResource('default', 'doc', 'x')
    expect(result).toBeNull()
  })
})

describe('resolveResourceAcrossScopes', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
  })

  it('calls crossScopeResolve when def has it', async () => {
    const detail = mockDetail('x', 'X', 'content')
    const crossScopeResolve = vi.fn().mockResolvedValue({ scope: 'other', detail })
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null),
      crossScopeResolve
    })
    const result = await resolveResourceAcrossScopes('doc', 'x')
    expect(crossScopeResolve).toHaveBeenCalledWith('x')
    expect(result).toEqual({ scope: 'other', detail })
  })

  it('returns null when def has no crossScopeResolve', async () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await resolveResourceAcrossScopes('doc', 'x')
    expect(result).toBeNull()
  })

  it('returns null when type not registered', async () => {
    const result = await resolveResourceAcrossScopes('doc', 'x')
    expect(result).toBeNull()
  })

  it('returns null when crossScopeResolve throws', async () => {
    registerResourceRef({
      type: 'doc',
      resolve: vi.fn().mockResolvedValue(null),
      crossScopeResolve: vi.fn().mockRejectedValue(new Error('cross failed'))
    })
    const result = await resolveResourceAcrossScopes('doc', 'x')
    expect(result).toBeNull()
  })
})

describe('searchResources', () => {
  beforeEach(() => {
    unregisterResourceRef('doc')
  })

  it('filters by query in title', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockResolvedValue([
        mockItem('1', 'Hello World'),
        mockItem('2', 'Bye'),
        mockItem('3', 'hello again')
      ]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await searchResources('default', 'hello')
    expect(result.length).toBe(2)
    expect(result.map((r) => r.title)).toContain('Hello World')
    expect(result.map((r) => r.title)).toContain('hello again')
  })

  it('filters by query in id', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockResolvedValue([
        mockItem('abc-123', 'Title'),
        mockItem('xyz-456', 'Other')
      ]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await searchResources('default', 'abc')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('abc-123')
  })

  it('filters by groupOrStatus', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockResolvedValue([
        { ...mockItem('1', 'A'), groupOrStatus: 'done' },
        { ...mockItem('2', 'B'), groupOrStatus: 'pending' }
      ]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    const result = await searchResources('default', 'done')
    expect(result.length).toBe(1)
    expect(result[0].groupOrStatus).toBe('done')
  })

  it('returns all when query is empty/whitespace', async () => {
    registerResourceRef({
      type: 'doc',
      list: vi.fn().mockResolvedValue([mockItem('1', 'A'), mockItem('2', 'B')]),
      resolve: vi.fn().mockResolvedValue(null)
    })
    expect((await searchResources('default', '')).length).toBe(2)
    expect((await searchResources('default', '  ')).length).toBe(2)
  })

  it('passes options to listAllResources', async () => {
    const list = vi.fn().mockResolvedValue([mockItem('1', 'A')])
    registerResourceRef({
      type: 'doc',
      list,
      resolve: vi.fn().mockResolvedValue(null)
    })
    await searchResources('default', 'A', { types: ['doc'], limit: 5 })
    expect(list).toHaveBeenCalledWith('default', 5)
  })
})
