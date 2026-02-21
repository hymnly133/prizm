/**
 * @(type:id) 预处理为 HTML chip 的单元测试
 */
import { describe, it, expect } from 'vitest'
import { preprocessAtRefs } from './atRefPreprocess'

describe('preprocessAtRefs', () => {
  it('leaves text without refs unchanged', () => {
    const text = 'Hello world\nNo ref here.'
    expect(preprocessAtRefs(text)).toBe(text)
  })

  it('replaces single @(doc:id) with chip HTML', () => {
    const out = preprocessAtRefs('See @(doc:abc123) for details.')
    expect(out).toContain('prizm-ref-chip')
    expect(out).toContain('文档')
    expect(out).toContain('abc123')
    expect(out).toContain('title="@(doc:abc123)"')
  })

  it('replaces @(todo:id) with 待办 tag', () => {
    const out = preprocessAtRefs('@(todo:task-1)')
    expect(out).toContain('prizm-ref-chip')
    expect(out).toContain('待办')
  })

  it('replaces multiple refs in one string', () => {
    const out = preprocessAtRefs('Ref1: @(doc:a) and ref2: @(doc:b).')
    expect(out).toContain('文档')
    expect((out.match(/<code class="prizm-ref-chip"/g) ?? []).length).toBe(2)
    expect(out).toContain('title="@(doc:a)"')
    expect(out).toContain('title="@(doc:b)"')
  })

  it('shortens long id to 12 chars + ellipsis in visible part', () => {
    const longId = 'a'.repeat(20)
    const out = preprocessAtRefs(`@(doc:${longId})`)
    expect(out).toContain('aaaaaaaaaaaa…')
    expect(out).toContain('prizm-ref-chip__tag')
  })

  it('keeps id under 12 chars as-is', () => {
    const out = preprocessAtRefs('@(doc:short)')
    expect(out).toContain('short')
  })

  it('escapes HTML in id', () => {
    const out = preprocessAtRefs('@(doc:<script>)')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })

  it('unknown type still produces chip with fallback style', () => {
    const out = preprocessAtRefs('@(unknown:xyz)')
    expect(out).toContain('prizm-ref-chip')
    expect(out).toContain('unknown')
    expect(out).toContain('xyz')
  })

  it('scope:type:id format (scope in first segment)', () => {
    const out = preprocessAtRefs('@(default:doc:abc)')
    expect(out).toContain('prizm-ref-chip')
    expect(out).toContain('abc')
    expect(out).toContain('title="@(default:doc:abc)"')
  })

  it('empty string returns empty string', () => {
    expect(preprocessAtRefs('')).toBe('')
  })
})
