/**
 * ContextBudget Manager 单元测试
 *
 * 覆盖：token 估算、预算分配、裁剪逻辑、优先级顺序、边界情况
 */

import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  createContextBudget,
  BUDGET_AREAS,
  TRIM_PRIORITIES
} from './budgetManager'

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should return 0 for undefined-like', () => {
    expect(estimateTokens(null as any)).toBe(0)
  })

  it('should estimate English text (~4 chars/token)', () => {
    const text = 'Hello world!'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 4) + 1)
  })

  it('should estimate CJK text (~2 chars/token)', () => {
    const text = '这是一段中文测试文本'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThanOrEqual(Math.floor(text.length / 3))
  })

  it('should handle mixed CJK and English', () => {
    const text = '用户在使用 TypeScript 进行开发'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('should estimate consistently for same input', () => {
    const text = 'Hello, this is a consistent test'
    expect(estimateTokens(text)).toBe(estimateTokens(text))
  })

  it('should increase with text length', () => {
    const short = 'Hello'
    const long = 'Hello world, this is a much longer sentence for testing token estimation'
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short))
  })
})

describe('ContextBudgetInstance', () => {
  // ─── 基本分配 ───

  describe('basic allocation', () => {
    it('should compute available tokens correctly', () => {
      const budget = createContextBudget({
        totalTokens: 8192,
        systemPromptReserved: 800,
        toolDefinitionsReserved: 1500,
        responseBufferReserved: 1500
      })
      expect(budget.available).toBe(8192 - 800 - 1500 - 1500)
    })

    it('should start with 0 used tokens', () => {
      const budget = createContextBudget()
      expect(budget.used).toBe(0)
    })

    it('should track used tokens after register', () => {
      const budget = createContextBudget()
      budget.register('test', 'Hello world', TRIM_PRIORITIES.SCOPE_CONTEXT)

      expect(budget.used).toBeGreaterThan(0)
    })

    it('should track remaining tokens', () => {
      const budget = createContextBudget({ totalTokens: 10000 })
      const available = budget.available
      budget.register('area-a', 'A'.repeat(1000), TRIM_PRIORITIES.SCOPE_CONTEXT)

      expect(budget.remaining).toBeLessThan(available)
      expect(budget.remaining).toBe(budget.available - budget.used)
    })

    it('should handle multiple registrations', () => {
      const budget = createContextBudget()
      budget.register('a', 'content-a', 10)
      budget.register('b', 'content-b', 20)
      budget.register('c', 'content-c', 30)

      expect(budget.used).toBeGreaterThan(0)
    })
  })

  // ─── 裁剪逻辑 ───

  describe('trim', () => {
    it('should not trim when under budget', () => {
      const budget = createContextBudget({ totalTokens: 100000 })
      budget.register('small', 'Hello', TRIM_PRIORITIES.SCOPE_CONTEXT)

      const snapshot = budget.trim()
      expect(snapshot.trimmed).toBe(false)
    })

    it('should trim when over budget', () => {
      const budget = createContextBudget({
        totalTokens: 100,
        systemPromptReserved: 20,
        toolDefinitionsReserved: 20,
        responseBufferReserved: 20
      })
      budget.register('big', 'A'.repeat(1000), TRIM_PRIORITIES.SCOPE_CONTEXT)

      const snapshot = budget.trim()
      expect(snapshot.trimmed).toBe(true)
      expect(snapshot.trimDetails).toBeDefined()
      expect(snapshot.trimDetails!.length).toBeGreaterThan(0)
    })

    it('should trim highest priority first', () => {
      const budget = createContextBudget({
        totalTokens: 100,
        systemPromptReserved: 10,
        toolDefinitionsReserved: 10,
        responseBufferReserved: 10
      })

      budget.register('low-prio', 'A'.repeat(800), 10)
      budget.register('high-prio', 'B'.repeat(800), 100)

      const snapshot = budget.trim()
      expect(snapshot.trimmed).toBe(true)

      const highPrioTrim = snapshot.trimDetails?.find((d) => d.name === 'high-prio')
      expect(highPrioTrim).toBeDefined()
      expect(highPrioTrim!.after).toBeLessThan(highPrioTrim!.before)
    })

    it('should trim multiple areas if needed', () => {
      const budget = createContextBudget({
        totalTokens: 80,
        systemPromptReserved: 10,
        toolDefinitionsReserved: 10,
        responseBufferReserved: 10
      })

      budget.register('prio-60', 'A'.repeat(400), 60)
      budget.register('prio-50', 'B'.repeat(400), 50)
      budget.register('prio-40', 'C'.repeat(400), 40)

      const snapshot = budget.trim()
      expect(snapshot.trimmed).toBe(true)
      expect(snapshot.trimDetails!.length).toBeGreaterThan(1)
    })

    it('should not make used tokens negative', () => {
      const budget = createContextBudget({
        totalTokens: 50,
        systemPromptReserved: 10,
        toolDefinitionsReserved: 10,
        responseBufferReserved: 10
      })

      budget.register('overload', 'X'.repeat(500), 100)
      budget.trim()

      expect(budget.used).toBeGreaterThanOrEqual(0)
    })

    it('should return snapshot with allocations', () => {
      const budget = createContextBudget()
      budget.register('area1', 'content', 50)

      const snapshot = budget.trim()
      expect(snapshot.config).toBeDefined()
      expect(snapshot.available).toBeGreaterThan(0)
      expect(snapshot.allocations.area1).toBeDefined()
    })
  })

  // ─── getAllowedTokens ───

  describe('getAllowedTokens', () => {
    it('should return used tokens for registered area', () => {
      const budget = createContextBudget()
      budget.register('test', 'Hello world', 50)

      const allowed = budget.getAllowedTokens('test')
      expect(allowed).toBeGreaterThan(0)
    })

    it('should return 0 for unregistered area', () => {
      const budget = createContextBudget()
      expect(budget.getAllowedTokens('nonexistent')).toBe(0)
    })

    it('should reflect trim result', () => {
      const budget = createContextBudget({
        totalTokens: 50,
        systemPromptReserved: 10,
        toolDefinitionsReserved: 10,
        responseBufferReserved: 10
      })

      budget.register('big', 'X'.repeat(500), 100)
      const beforeTrim = budget.getAllowedTokens('big')
      budget.trim()
      const afterTrim = budget.getAllowedTokens('big')

      expect(afterTrim).toBeLessThanOrEqual(beforeTrim)
    })
  })

  // ─── trimContent ───

  describe('trimContent', () => {
    it('should not trim content within budget', () => {
      const budget = createContextBudget({ totalTokens: 100000 })
      budget.register('area', 'Hello world', 50)

      const result = budget.trimContent('area', 'Hello world')
      expect(result).toBe('Hello world')
    })

    it('should trim content exceeding budget', () => {
      const budget = createContextBudget({
        totalTokens: 50,
        systemPromptReserved: 5,
        toolDefinitionsReserved: 5,
        responseBufferReserved: 5
      })

      const longContent = 'A'.repeat(1000)
      budget.register('area', longContent, 100)
      budget.trim()

      const result = budget.trimContent('area', longContent)
      expect(result.length).toBeLessThan(longContent.length)
      expect(result).toContain('…(已按上下文预算裁剪)')
    })
  })

  // ─── 预设常量 ───

  describe('TRIM_PRIORITIES', () => {
    it('should have session memory as highest trim priority', () => {
      expect(TRIM_PRIORITIES.SESSION_MEMORY).toBeGreaterThan(TRIM_PRIORITIES.DOCUMENT_MEMORY)
      expect(TRIM_PRIORITIES.SESSION_MEMORY).toBeGreaterThan(TRIM_PRIORITIES.SCOPE_MEMORY)
    })

    it('should have conversation history as lowest trim priority', () => {
      expect(TRIM_PRIORITIES.CONVERSATION_HISTORY).toBeLessThan(
        TRIM_PRIORITIES.USER_PROFILE
      )
    })

    it('should order: session > doc > scope > context > skill > profile > history', () => {
      expect(TRIM_PRIORITIES.SESSION_MEMORY).toBeGreaterThan(TRIM_PRIORITIES.DOCUMENT_MEMORY)
      expect(TRIM_PRIORITIES.DOCUMENT_MEMORY).toBeGreaterThan(TRIM_PRIORITIES.SCOPE_MEMORY)
      expect(TRIM_PRIORITIES.SCOPE_MEMORY).toBeGreaterThan(TRIM_PRIORITIES.SCOPE_CONTEXT)
      expect(TRIM_PRIORITIES.SCOPE_CONTEXT).toBeGreaterThan(TRIM_PRIORITIES.SKILL_RULES)
      expect(TRIM_PRIORITIES.SKILL_RULES).toBeGreaterThan(TRIM_PRIORITIES.USER_PROFILE)
      expect(TRIM_PRIORITIES.USER_PROFILE).toBeGreaterThan(TRIM_PRIORITIES.CONVERSATION_HISTORY)
    })
  })

  describe('BUDGET_AREAS', () => {
    it('should define all expected area names', () => {
      expect(BUDGET_AREAS.USER_PROFILE).toBe('userProfile')
      expect(BUDGET_AREAS.SCOPE_CONTEXT).toBe('scopeContext')
      expect(BUDGET_AREAS.SCOPE_MEMORY).toBe('scopeMemory')
      expect(BUDGET_AREAS.SESSION_MEMORY).toBe('sessionMemory')
      expect(BUDGET_AREAS.DOCUMENT_MEMORY).toBe('documentMemory')
      expect(BUDGET_AREAS.CONVERSATION_HISTORY).toBe('conversationHistory')
      expect(BUDGET_AREAS.SKILL_RULES).toBe('skillRules')
    })
  })

  // ─── 边界情况 ───

  describe('edge cases', () => {
    it('should handle totalTokens smaller than reserved', () => {
      const budget = createContextBudget({
        totalTokens: 10,
        systemPromptReserved: 100,
        toolDefinitionsReserved: 100,
        responseBufferReserved: 100
      })
      expect(budget.available).toBe(0)
      expect(budget.remaining).toBe(0)
    })

    it('should handle empty content registration', () => {
      const budget = createContextBudget()
      budget.register('empty', '', 50)
      expect(budget.used).toBe(0)
    })

    it('should handle registering same area twice (overwrite)', () => {
      const budget = createContextBudget()
      budget.register('area', 'short', 50)
      const used1 = budget.used
      budget.register('area', 'much longer content here for testing', 50)
      const used2 = budget.used

      expect(used2).toBeGreaterThan(used1)
    })

    it('should use default config when no args provided', () => {
      const budget = createContextBudget()
      expect(budget.available).toBeGreaterThan(0)
    })

    it('should handle partial config override', () => {
      const budget = createContextBudget({ totalTokens: 16384 })
      expect(budget.available).toBeGreaterThan(8192 - 800 - 1500 - 1500)
    })
  })
})
