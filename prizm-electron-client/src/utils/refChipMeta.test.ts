/**
 * 资源引用 chip 元数据单元测试
 */
import { describe, it, expect } from 'vitest'
import { REF_CHIP_META, FALLBACK_CHIP_STYLE } from './refChipMeta'

const EXPECTED_TYPES = [
  'doc',
  'note',
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

describe('REF_CHIP_META', () => {
  it('has meta for all expected resource types', () => {
    for (const key of EXPECTED_TYPES) {
      expect(REF_CHIP_META[key]).toBeDefined()
      expect(REF_CHIP_META[key].label).toBeTruthy()
      expect(REF_CHIP_META[key].color).toBeTruthy()
      expect(REF_CHIP_META[key].bg).toBeTruthy()
    }
  })

  it('labels are non-empty strings', () => {
    for (const key of EXPECTED_TYPES) {
      expect(typeof REF_CHIP_META[key].label).toBe('string')
      expect(REF_CHIP_META[key].label.length).toBeGreaterThan(0)
    }
  })

  it('colors and bg are CSS-like values', () => {
    for (const key of EXPECTED_TYPES) {
      const { color, bg } = REF_CHIP_META[key]
      expect(color).toMatch(/^#[0-9a-fA-F]+$/)
      expect(bg).toMatch(/^#[0-9a-fA-F]+$/)
    }
  })

  it('doc has label 文档', () => {
    expect(REF_CHIP_META.doc.label).toBe('文档')
  })

  it('workflow has label 工作流', () => {
    expect(REF_CHIP_META.workflow.label).toBe('工作流')
  })
})

describe('FALLBACK_CHIP_STYLE', () => {
  it('has color and bg', () => {
    expect(FALLBACK_CHIP_STYLE.color).toBeTruthy()
    expect(FALLBACK_CHIP_STYLE.bg).toBeTruthy()
  })
})
