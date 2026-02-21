/**
 * HookExecutor 单元测试
 *
 * 覆盖：PreToolUse/PostToolUse/PreMemoryInject/PostMemoryExtract
 * 链式执行、deny优先、参数传递、错误容忍、空链
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hookRegistry } from './hookRegistry'
import {
  executePreToolUseHooks,
  executePostToolUseHooks,
  executePreMemoryInjectHooks,
  executePostMemoryExtractHooks
} from './hookExecutor'
import type {
  PreToolUsePayload,
  PostToolUsePayload,
  PreMemoryInjectPayload,
  PostMemoryExtractPayload
} from './types'

beforeEach(() => {
  hookRegistry.clear()
})

const basePreToolPayload: PreToolUsePayload = {
  scope: 'default',
  sessionId: 'sess-1',
  toolName: 'prizm_write_file',
  toolCallId: 'tc-1',
  arguments: { path: '/test.txt', content: 'hello' },
  grantedPaths: []
}

const basePostToolPayload: PostToolUsePayload = {
  scope: 'default',
  sessionId: 'sess-1',
  toolName: 'prizm_write_file',
  toolCallId: 'tc-1',
  arguments: { path: '/test.txt' },
  result: 'File written',
  isError: false,
  durationMs: 50
}

// ─── PreToolUse ───

describe('executePreToolUseHooks', () => {
  it('should return allow when no hooks registered', async () => {
    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('allow')
  })

  it('should return allow when all hooks return allow', async () => {
    hookRegistry.register({
      id: 'h1',
      event: 'PreToolUse',
      priority: 100,
      callback: async () => ({ decision: 'allow' as const })
    })
    hookRegistry.register({
      id: 'h2',
      event: 'PreToolUse',
      priority: 200,
      callback: async () => ({ decision: 'allow' as const })
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('allow')
  })

  it('should return deny immediately when any hook denies', async () => {
    const cb1 = vi.fn(async () => ({ decision: 'allow' as const }))
    const cb2 = vi.fn(async () => ({
      decision: 'deny' as const,
      denyMessage: 'blocked'
    }))
    const cb3 = vi.fn(async () => ({ decision: 'allow' as const }))

    hookRegistry.register({ id: 'h1', event: 'PreToolUse', priority: 10, callback: cb1 })
    hookRegistry.register({ id: 'h2', event: 'PreToolUse', priority: 20, callback: cb2 })
    hookRegistry.register({ id: 'h3', event: 'PreToolUse', priority: 30, callback: cb3 })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('deny')
    expect(result.denyMessage).toBe('blocked')
    expect(cb1).toHaveBeenCalled()
    expect(cb2).toHaveBeenCalled()
    expect(cb3).not.toHaveBeenCalled()
  })

  it('should use first ask interactDetails from hooks', async () => {
    hookRegistry.register({
      id: 'h1',
      event: 'PreToolUse',
      priority: 10,
      callback: async () => ({
        decision: 'ask' as const,
        interactDetails: { kind: 'file_access' as const, paths: ['/path/a'] }
      })
    })
    hookRegistry.register({
      id: 'h2',
      event: 'PreToolUse',
      priority: 20,
      callback: async () => ({
        decision: 'ask' as const,
        interactDetails: { kind: 'file_access' as const, paths: ['/path/b'] }
      })
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('ask')
    expect(result.interactDetails).toEqual({ kind: 'file_access', paths: ['/path/a'] })
  })

  it('should pass updated arguments through the chain', async () => {
    hookRegistry.register({
      id: 'updater',
      event: 'PreToolUse',
      priority: 10,
      callback: async (payload) => ({
        decision: 'allow' as const,
        updatedArguments: { ...payload.arguments, injected: true }
      })
    })
    hookRegistry.register({
      id: 'checker',
      event: 'PreToolUse',
      priority: 20,
      callback: async (payload) => {
        expect(payload.arguments.injected).toBe(true)
        return { decision: 'allow' as const }
      }
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('allow')
    expect(result.updatedArguments?.injected).toBe(true)
  })

  it('should collect additional context from multiple hooks', async () => {
    hookRegistry.register({
      id: 'ctx1',
      event: 'PreToolUse',
      priority: 10,
      callback: async () => ({
        decision: 'allow' as const,
        additionalContext: 'context-A'
      })
    })
    hookRegistry.register({
      id: 'ctx2',
      event: 'PreToolUse',
      priority: 20,
      callback: async () => ({
        decision: 'allow' as const,
        additionalContext: 'context-B'
      })
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.additionalContext).toContain('context-A')
    expect(result.additionalContext).toContain('context-B')
  })

  it('should tolerate hook errors and continue chain', async () => {
    hookRegistry.register({
      id: 'thrower',
      event: 'PreToolUse',
      priority: 10,
      callback: async () => {
        throw new Error('hook crashed')
      }
    })
    hookRegistry.register({
      id: 'safe',
      event: 'PreToolUse',
      priority: 20,
      callback: async () => ({ decision: 'allow' as const })
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('allow')
  })

  it('should only match hooks with matching toolMatcher', async () => {
    const writeOnly = vi.fn(async () => ({ decision: 'deny' as const, denyMessage: 'no write' }))
    hookRegistry.register({
      id: 'write-deny',
      event: 'PreToolUse',
      priority: 10,
      toolMatcher: 'prizm_write_file',
      callback: writeOnly
    })

    const readPayload = { ...basePreToolPayload, toolName: 'prizm_read_file' }
    const result = await executePreToolUseHooks(readPayload)
    expect(result.decision).toBe('allow')
    expect(writeOnly).not.toHaveBeenCalled()
  })

  it('should skip hooks returning void/undefined', async () => {
    hookRegistry.register({
      id: 'noop',
      event: 'PreToolUse',
      priority: 10,
      callback: async () => undefined as any
    })

    const result = await executePreToolUseHooks(basePreToolPayload)
    expect(result.decision).toBe('allow')
  })
})

// ─── PostToolUse ───

describe('executePostToolUseHooks', () => {
  it('should return empty decision when no hooks', async () => {
    const result = await executePostToolUseHooks(basePostToolPayload)
    expect(result).toEqual({})
  })

  it('should allow hooks to modify result', async () => {
    hookRegistry.register({
      id: 'modifier',
      event: 'PostToolUse',
      priority: 100,
      callback: async (payload) => ({
        updatedResult: payload.result + '\n[audit logged]'
      })
    })

    const result = await executePostToolUseHooks(basePostToolPayload)
    expect(result.updatedResult).toBe('File written\n[audit logged]')
  })

  it('should chain result modifications', async () => {
    hookRegistry.register({
      id: 'mod1',
      event: 'PostToolUse',
      priority: 10,
      callback: async (payload) => ({
        updatedResult: payload.result + ' +mod1'
      })
    })
    hookRegistry.register({
      id: 'mod2',
      event: 'PostToolUse',
      priority: 20,
      callback: async (payload) => ({
        updatedResult: payload.result + ' +mod2'
      })
    })

    const result = await executePostToolUseHooks(basePostToolPayload)
    expect(result.updatedResult).toBe('File written +mod1 +mod2')
  })

  it('should tolerate PostToolUse hook errors', async () => {
    hookRegistry.register({
      id: 'bad',
      event: 'PostToolUse',
      priority: 10,
      callback: async () => {
        throw new Error('oops')
      }
    })
    hookRegistry.register({
      id: 'good',
      event: 'PostToolUse',
      priority: 20,
      callback: async () => ({
        additionalContext: 'extra'
      })
    })

    const result = await executePostToolUseHooks(basePostToolPayload)
    expect(result.additionalContext).toBe('extra')
  })
})

// ─── PreMemoryInject ───

describe('executePreMemoryInjectHooks', () => {
  const basePayload: PreMemoryInjectPayload = {
    scope: 'default',
    sessionId: 'sess-1',
    query: '用户问题',
    memories: {
      user: [{ id: 'u1', memory: 'profile', memory_type: 'profile' } as any],
      scope: [
        { id: 's1', memory: 'narrative', memory_type: 'narrative' } as any,
        { id: 's2', memory: 'doc', memory_type: 'document_overview' } as any
      ],
      session: [{ id: 'se1', memory: 'event', memory_type: 'event_log' } as any]
    }
  }

  it('should return empty when no hooks', async () => {
    const result = await executePreMemoryInjectHooks(basePayload)
    expect(result).toEqual({})
  })

  it('should allow filtering memories', async () => {
    hookRegistry.register({
      id: 'filter',
      event: 'PreMemoryInject',
      priority: 100,
      callback: async (payload) => ({
        filteredMemories: {
          user: payload.memories.user,
          scope: payload.memories.scope.filter((m: any) => m.memory_type !== 'narrative'),
          session: []
        }
      })
    })

    const result = await executePreMemoryInjectHooks(basePayload)
    expect(result.filteredMemories?.scope).toHaveLength(1)
    expect(result.filteredMemories?.session).toHaveLength(0)
  })

  it('should allow overriding query', async () => {
    hookRegistry.register({
      id: 'query-override',
      event: 'PreMemoryInject',
      priority: 100,
      callback: async () => ({
        overrideQuery: '自定义检索词'
      })
    })

    const result = await executePreMemoryInjectHooks(basePayload)
    expect(result.overrideQuery).toBe('自定义检索词')
  })
})

// ─── PostMemoryExtract ───

describe('executePostMemoryExtractHooks', () => {
  const basePayload: PostMemoryExtractPayload = {
    scope: 'default',
    sessionId: 'sess-1',
    pipeline: 'P1',
    created: [
      { id: 'mem-1', type: 'event_log', content: '用户讨论了...' },
      { id: 'mem-2', type: 'profile', content: '用户偏好...' },
      { id: 'mem-3', type: 'foresight', content: '下一步计划...' }
    ]
  }

  it('should return empty when no hooks', async () => {
    const result = await executePostMemoryExtractHooks(basePayload)
    expect(result).toEqual({})
  })

  it('should collect exclude IDs from hooks', async () => {
    hookRegistry.register({
      id: 'exclude-sensitive',
      event: 'PostMemoryExtract',
      priority: 100,
      callback: async () => ({
        excludeIds: ['mem-2']
      })
    })

    const result = await executePostMemoryExtractHooks(basePayload)
    expect(result.excludeIds).toEqual(['mem-2'])
  })

  it('should deduplicate exclude IDs', async () => {
    hookRegistry.register({
      id: 'ex1',
      event: 'PostMemoryExtract',
      priority: 10,
      callback: async () => ({ excludeIds: ['mem-1', 'mem-2'] })
    })
    hookRegistry.register({
      id: 'ex2',
      event: 'PostMemoryExtract',
      priority: 20,
      callback: async () => ({ excludeIds: ['mem-2', 'mem-3'] })
    })

    const result = await executePostMemoryExtractHooks(basePayload)
    expect(result.excludeIds).toEqual(['mem-1', 'mem-2', 'mem-3'])
  })

  it('should tolerate errors in PostMemoryExtract hooks', async () => {
    hookRegistry.register({
      id: 'bad',
      event: 'PostMemoryExtract',
      priority: 10,
      callback: async () => {
        throw new Error('hook failed')
      }
    })

    const result = await executePostMemoryExtractHooks(basePayload)
    expect(result).toEqual({})
  })
})
