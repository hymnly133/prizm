/**
 * HookRegistry 单元测试
 *
 * 覆盖：注册/注销/更新/清除/匹配/优先级排序/glob匹配/边界情况
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { hookRegistry } from './hookRegistry'
import type { HookRegistration, PreToolUsePayload, PreToolUseDecision } from './types'

beforeEach(() => {
  hookRegistry.clear()
})

describe('HookRegistry', () => {
  // ─── 注册 ───

  describe('register', () => {
    it('should register a PreToolUse hook', () => {
      hookRegistry.register({
        id: 'test-hook',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })
      expect(hookRegistry.size).toBe(1)
    })

    it('should register hooks for different events independently', () => {
      hookRegistry.register({
        id: 'pre-hook',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })
      hookRegistry.register({
        id: 'post-hook',
        event: 'PostToolUse',
        priority: 100,
        callback: async () => ({})
      })
      expect(hookRegistry.size).toBe(2)
    })

    it('should update existing hook with same id', () => {
      const cb1 = async () => ({ decision: 'allow' as const })
      const cb2 = async () => ({ decision: 'deny' as const, denyMessage: 'nope' })

      hookRegistry.register({ id: 'dup', event: 'PreToolUse', priority: 100, callback: cb1 })
      hookRegistry.register({ id: 'dup', event: 'PreToolUse', priority: 50, callback: cb2 })

      expect(hookRegistry.size).toBe(1)
      const hooks = hookRegistry.getMatchingHooks('PreToolUse', 'any_tool')
      expect(hooks).toHaveLength(1)
      expect(hooks[0].priority).toBe(50)
    })

    it('should sort hooks by priority (ascending)', () => {
      hookRegistry.register({
        id: 'low',
        event: 'PreToolUse',
        priority: 200,
        callback: async () => ({ decision: 'allow' as const })
      })
      hookRegistry.register({
        id: 'high',
        event: 'PreToolUse',
        priority: 10,
        callback: async () => ({ decision: 'allow' as const })
      })
      hookRegistry.register({
        id: 'mid',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })

      const hooks = hookRegistry.getMatchingHooks('PreToolUse')
      expect(hooks.map((h) => h.id)).toEqual(['high', 'mid', 'low'])
    })
  })

  // ─── 注销 ───

  describe('unregister', () => {
    it('should remove a registered hook', () => {
      hookRegistry.register({
        id: 'to-remove',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })
      expect(hookRegistry.size).toBe(1)

      const removed = hookRegistry.unregister('to-remove')
      expect(removed).toBe(true)
      expect(hookRegistry.size).toBe(0)
    })

    it('should return false for non-existent hook', () => {
      const removed = hookRegistry.unregister('does-not-exist')
      expect(removed).toBe(false)
    })

    it('should only remove the targeted hook', () => {
      hookRegistry.register({
        id: 'keep',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })
      hookRegistry.register({
        id: 'remove',
        event: 'PreToolUse',
        priority: 200,
        callback: async () => ({ decision: 'allow' as const })
      })

      hookRegistry.unregister('remove')
      expect(hookRegistry.size).toBe(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse')[0].id).toBe('keep')
    })
  })

  // ─── 清除 ───

  describe('clear', () => {
    it('should remove all hooks', () => {
      hookRegistry.register({
        id: 'a',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })
      hookRegistry.register({
        id: 'b',
        event: 'PostToolUse',
        priority: 100,
        callback: async () => ({})
      })
      hookRegistry.register({
        id: 'c',
        event: 'PreMemoryInject',
        priority: 100,
        callback: async () => ({})
      })

      hookRegistry.clear()
      expect(hookRegistry.size).toBe(0)
    })
  })

  // ─── 匹配 ───

  describe('getMatchingHooks', () => {
    it('should return all hooks when no toolMatcher', () => {
      hookRegistry.register({
        id: 'no-matcher',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })

      const hooks = hookRegistry.getMatchingHooks('PreToolUse', 'prizm_write_file')
      expect(hooks).toHaveLength(1)
    })

    it('should match exact tool name', () => {
      hookRegistry.register({
        id: 'exact',
        event: 'PreToolUse',
        priority: 100,
        toolMatcher: 'prizm_write_file',
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_write_file')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_read_file')).toHaveLength(0)
    })

    it('should match glob pattern with *', () => {
      hookRegistry.register({
        id: 'glob',
        event: 'PreToolUse',
        priority: 100,
        toolMatcher: 'prizm_*',
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_write_file')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_read_file')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'tavily_web_search')).toHaveLength(0)
    })

    it('should match wildcard * for all tools', () => {
      hookRegistry.register({
        id: 'all',
        event: 'PreToolUse',
        priority: 100,
        toolMatcher: '*',
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PreToolUse', 'any_tool')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'another')).toHaveLength(1)
    })

    it('should match RegExp toolMatcher', () => {
      hookRegistry.register({
        id: 'regex',
        event: 'PreToolUse',
        priority: 100,
        toolMatcher: /^prizm_(write|delete)_file$/,
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_write_file')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_delete_file')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'prizm_read_file')).toHaveLength(0)
    })

    it('should return empty array for events with no hooks', () => {
      expect(hookRegistry.getMatchingHooks('PostMemoryExtract')).toEqual([])
    })

    it('should not cross-match between event types', () => {
      hookRegistry.register({
        id: 'pre-only',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PostToolUse', 'any')).toHaveLength(0)
      expect(hookRegistry.getMatchingHooks('PreMemoryInject')).toHaveLength(0)
    })
  })

  // ─── 边界情况 ───

  describe('edge cases', () => {
    it('should handle register + unregister + re-register', () => {
      const reg: HookRegistration<'PreToolUse'> = {
        id: 'cycle',
        event: 'PreToolUse',
        priority: 100,
        callback: async () => ({ decision: 'allow' as const })
      }
      hookRegistry.register(reg)
      hookRegistry.unregister('cycle')
      hookRegistry.register({ ...reg, priority: 50 })

      expect(hookRegistry.size).toBe(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse')[0].priority).toBe(50)
    })

    it('should handle many hooks with same priority', () => {
      for (let i = 0; i < 20; i++) {
        hookRegistry.register({
          id: `same-priority-${i}`,
          event: 'PreToolUse',
          priority: 100,
          callback: async () => ({ decision: 'allow' as const })
        })
      }
      expect(hookRegistry.size).toBe(20)
      expect(hookRegistry.getMatchingHooks('PreToolUse')).toHaveLength(20)
    })

    it('should handle glob with special regex chars', () => {
      hookRegistry.register({
        id: 'special',
        event: 'PreToolUse',
        priority: 100,
        toolMatcher: 'mcp.server.tool_*',
        callback: async () => ({ decision: 'allow' as const })
      })

      expect(hookRegistry.getMatchingHooks('PreToolUse', 'mcp.server.tool_search')).toHaveLength(1)
      expect(hookRegistry.getMatchingHooks('PreToolUse', 'mcp_server_tool_search')).toHaveLength(0)
    })
  })
})
