/**
 * DefaultRules 单元测试
 *
 * 覆盖：各 PermissionMode 的规则集生成
 */

import { describe, it, expect } from 'vitest'
import { getDefaultRules } from './defaultRules'

describe('getDefaultRules', () => {
  it('should return ask rules for default mode', () => {
    const rules = getDefaultRules('default')
    expect(rules.length).toBeGreaterThan(0)

    const writeRule = rules.find((r) => r.toolPattern === 'prizm_write_file')
    expect(writeRule).toBeDefined()
    expect(writeRule!.behavior).toBe('ask')
  })

  it('should include terminal rules in default mode', () => {
    const rules = getDefaultRules('default')
    const terminalRule = rules.find((r) => r.toolPattern.includes('terminal'))
    expect(terminalRule).toBeDefined()
    expect(terminalRule!.behavior).toBe('ask')
  })

  it('should return deny rules for plan mode', () => {
    const rules = getDefaultRules('plan')
    expect(rules.length).toBeGreaterThan(0)

    for (const rule of rules) {
      expect(rule.behavior).toBe('deny')
      expect(rule.denyMessage).toBeTruthy()
    }
  })

  it('should deny write/update/create/delete/terminal in plan mode', () => {
    const rules = getDefaultRules('plan')
    const patterns = rules.map((r) => r.toolPattern)

    expect(patterns).toContain('prizm_write_file')
    expect(patterns).toContain('prizm_move_file')
    expect(patterns).toContain('prizm_delete_file')
    expect(patterns).toContain('prizm_update_document')
    expect(patterns).toContain('prizm_create_document')
    expect(patterns).toContain('prizm_terminal_*')
  })

  it('should return empty rules for acceptEdits mode', () => {
    const rules = getDefaultRules('acceptEdits')
    expect(rules).toEqual([])
  })

  it('should return empty rules for bypassPermissions mode', () => {
    const rules = getDefaultRules('bypassPermissions')
    expect(rules).toEqual([])
  })

  it('should return deny rules for dontAsk mode', () => {
    const rules = getDefaultRules('dontAsk')
    expect(rules.length).toBeGreaterThan(0)

    for (const rule of rules) {
      expect(rule.behavior).toBe('deny')
      expect(rule.denyMessage).toContain('dontAsk')
    }
  })

  it('should return empty for unknown mode', () => {
    const rules = getDefaultRules('unknown_mode')
    expect(rules).toEqual([])
  })

  it('should have unique rule IDs within each mode', () => {
    for (const mode of ['default', 'plan', 'dontAsk']) {
      const rules = getDefaultRules(mode)
      const ids = rules.map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('should have lower priority for plan deny rules', () => {
    const rules = getDefaultRules('plan')
    for (const rule of rules) {
      expect(rule.priority).toBeLessThanOrEqual(20)
    }
  })
})
