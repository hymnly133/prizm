/**
 * DefaultRules 单元测试
 *
 * 覆盖：各 PermissionMode 的规则集生成（复合工具版本）
 */

import { describe, it, expect } from 'vitest'
import { getDefaultRules } from './defaultRules'

describe('getDefaultRules', () => {
  it('should return ask rules for default mode', () => {
    const rules = getDefaultRules('default')
    expect(rules.length).toBeGreaterThan(0)

    const fileRule = rules.find((r) => r.toolPattern === 'prizm_file')
    expect(fileRule).toBeDefined()
    expect(fileRule!.behavior).toBe('ask')
    expect(fileRule!.actionFilter).toEqual(['write', 'move', 'delete'])
  })

  it('should include document write rules in default mode', () => {
    const rules = getDefaultRules('default')
    const docRule = rules.find((r) => r.toolPattern === 'prizm_document')
    expect(docRule).toBeDefined()
    expect(docRule!.behavior).toBe('ask')
    expect(docRule!.actionFilter).toEqual(['create', 'update', 'delete'])
  })

  it('should include terminal rules in default mode', () => {
    const rules = getDefaultRules('default')
    const terminalRule = rules.find((r) => r.toolPattern.includes('terminal'))
    expect(terminalRule).toBeDefined()
    expect(terminalRule!.behavior).toBe('ask')
  })

  it('should include cron write rules in default mode', () => {
    const rules = getDefaultRules('default')
    const cronRule = rules.find((r) => r.toolPattern === 'prizm_cron')
    expect(cronRule).toBeDefined()
    expect(cronRule!.behavior).toBe('ask')
    expect(cronRule!.actionFilter).toEqual(['create', 'delete'])
  })

  it('should return deny rules for plan mode', () => {
    const rules = getDefaultRules('plan')
    expect(rules.length).toBeGreaterThan(0)

    for (const rule of rules) {
      expect(rule.behavior).toBe('deny')
      expect(rule.denyMessage).toBeTruthy()
    }
  })

  it('should deny file write/doc write/terminal/cron in plan mode', () => {
    const rules = getDefaultRules('plan')
    const patterns = rules.map((r) => r.toolPattern)

    expect(patterns).toContain('prizm_file')
    expect(patterns).toContain('prizm_document')
    expect(patterns).toContain('prizm_terminal_*')
    expect(patterns).toContain('prizm_cron')
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
