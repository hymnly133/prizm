/**
 * 跨模块集成测试 — AgentHooks + ToolPermission + ContextBudget
 *
 * 验证三个系统在联动场景下的正确性：
 * 1. Permission hook 作为 PreToolUse 拦截器生效
 * 2. 多个 hook 链式执行，deny 优先级正确
 * 3. ContextBudget 与 hook 配合裁剪注入内容
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hookRegistry } from './agentHooks/hookRegistry'
import { executePreToolUseHooks, executePostToolUseHooks } from './agentHooks/hookExecutor'
import {
  setSessionPermissionMode,
  clearSessionPermission,
  registerPermissionHook,
  addSessionRules,
  checkPermission
} from './toolPermission/permissionManager'
import {
  createContextBudget,
  estimateTokens,
  BUDGET_AREAS,
  TRIM_PRIORITIES
} from '../llm/contextBudget/budgetManager'
import type { PreToolUsePayload, PostToolUsePayload } from './agentHooks/types'

beforeEach(() => {
  hookRegistry.clear()
  clearSessionPermission('integration-sess')
})

// ─── 场景 1：PermissionHook 作为 PreToolUse 拦截（复合工具） ───

describe('Permission hook as PreToolUse interceptor', () => {
  it('should deny compound file write in plan mode via hook chain', async () => {
    setSessionPermissionMode('integration-sess', 'plan')
    registerPermissionHook()

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_file',
      toolCallId: 'tc-1',
      arguments: { action: 'write', path: '/test.txt', content: 'hello' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('deny')
    expect(result.denyMessage).toContain('Plan mode')
  })

  it('should allow file read action in plan mode via hook chain', async () => {
    setSessionPermissionMode('integration-sess', 'plan')
    registerPermissionHook()

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_file',
      toolCallId: 'tc-2',
      arguments: { action: 'read', path: '/test.txt' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('allow')
  })

  it('should bypass all permissions in bypassPermissions mode', async () => {
    setSessionPermissionMode('integration-sess', 'bypassPermissions')
    registerPermissionHook()

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_terminal_execute',
      toolCallId: 'tc-3',
      arguments: { command: 'rm -rf /' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('allow')
  })
})

// ─── 场景 2：多 hook 链式执行优先级 ───

describe('Multi-hook chain execution', () => {
  it('should let permission hook deny before other hooks run', async () => {
    setSessionPermissionMode('integration-sess', 'plan')
    registerPermissionHook()

    const auditCallback = vi.fn(async () => ({ decision: 'allow' as const }))
    hookRegistry.register({
      id: 'audit-hook',
      event: 'PreToolUse',
      priority: 100,
      callback: auditCallback
    })

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_file',
      toolCallId: 'tc-4',
      arguments: { action: 'delete', path: '/important.txt' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('deny')
    expect(auditCallback).not.toHaveBeenCalled()
  })

  it('should allow custom deny rule to override default allow', async () => {
    addSessionRules('integration-sess', [
      {
        id: 'custom:block-search',
        toolPattern: 'prizm_search',
        behavior: 'deny',
        denyMessage: 'search blocked',
        priority: 5
      }
    ])
    registerPermissionHook()

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_search',
      toolCallId: 'tc-5',
      arguments: { query: 'test' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('deny')
    expect(result.denyMessage).toBe('search blocked')
  })

  it('should return ask with interactDetails from permission hook for compound tools', async () => {
    registerPermissionHook()

    const payload: PreToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_file',
      toolCallId: 'tc-6',
      arguments: { action: 'write', path: '/workspace/test.txt' },
      grantedPaths: []
    }

    const result = await executePreToolUseHooks(payload)
    expect(result.decision).toBe('ask')
    expect(result.interactDetails).toBeDefined()
    expect(result.interactDetails!.kind).toBe('file_access')
  })
})

// ─── 场景 3：PostToolUse hook + 上下文注入 ───

describe('PostToolUse hooks with context injection', () => {
  it('should collect additional context from multiple PostToolUse hooks', async () => {
    hookRegistry.register({
      id: 'audit-post',
      event: 'PostToolUse',
      priority: 10,
      callback: async (payload) => ({
        additionalContext: `[audit] Tool ${payload.toolName} executed in ${payload.durationMs}ms`
      })
    })

    hookRegistry.register({
      id: 'stats-post',
      event: 'PostToolUse',
      priority: 20,
      callback: async () => ({
        additionalContext: '[stats] Operation counted'
      })
    })

    const payload: PostToolUsePayload = {
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_write_file',
      toolCallId: 'tc-7',
      arguments: { path: '/test.txt' },
      result: 'File written successfully',
      isError: false,
      durationMs: 150
    }

    const result = await executePostToolUseHooks(payload)
    expect(result.additionalContext).toContain('[audit]')
    expect(result.additionalContext).toContain('[stats]')
  })
})

// ─── 场景 4：ContextBudget 与 hook 联合工作流 ───

describe('ContextBudget integration workflow', () => {
  it('should allocate and trim memory injection within budget', () => {
    const budget = createContextBudget({
      totalTokens: 500,
      systemPromptReserved: 80,
      toolDefinitionsReserved: 100,
      responseBufferReserved: 100
    })

    const profileContent = '用户是一名高级 TypeScript 开发者，偏好 functional programming。'
    const scopeMemory = '在项目 A 中使用了 React 19 和 Ant Design。'.repeat(10)
    const sessionMemory = '本次会话讨论了 Agent 系统的 hooks 架构和权限控制。'.repeat(10)
    const conversationHistory = '用户：请帮我实现 XXX\n助手：好的，我来处理...'.repeat(20)

    budget.register(BUDGET_AREAS.USER_PROFILE, profileContent, TRIM_PRIORITIES.USER_PROFILE)
    budget.register(BUDGET_AREAS.SCOPE_MEMORY, scopeMemory, TRIM_PRIORITIES.SCOPE_MEMORY)
    budget.register(BUDGET_AREAS.SESSION_MEMORY, sessionMemory, TRIM_PRIORITIES.SESSION_MEMORY)
    budget.register(
      BUDGET_AREAS.CONVERSATION_HISTORY,
      conversationHistory,
      TRIM_PRIORITIES.CONVERSATION_HISTORY
    )

    const snapshot = budget.trim()

    if (snapshot.trimmed) {
      expect(snapshot.trimDetails!.length).toBeGreaterThan(0)
      const firstTrimmed = snapshot.trimDetails![0].name
      expect(firstTrimmed).toBe(BUDGET_AREAS.SESSION_MEMORY)
    }

    expect(budget.used).toBeLessThanOrEqual(budget.available)
  })

  it('should preserve conversation history priority over session memory', () => {
    const budget = createContextBudget({
      totalTokens: 200,
      systemPromptReserved: 20,
      toolDefinitionsReserved: 20,
      responseBufferReserved: 20
    })

    budget.register('sessionMem', 'A'.repeat(400), TRIM_PRIORITIES.SESSION_MEMORY)
    budget.register('convHistory', 'B'.repeat(400), TRIM_PRIORITIES.CONVERSATION_HISTORY)

    budget.trim()

    const sessionTokens = budget.getAllowedTokens('sessionMem')
    const convTokens = budget.getAllowedTokens('convHistory')

    expect(sessionTokens).toBeLessThanOrEqual(convTokens)
  })
})

// ─── 场景 5：完整 Agent 请求生命周期模拟 ───

describe('Full agent request lifecycle simulation', () => {
  it('should simulate: permission check -> tool execute -> post-hook -> budget trim', async () => {
    setSessionPermissionMode('integration-sess', 'acceptEdits')
    registerPermissionHook()

    const toolCallLog: string[] = []
    hookRegistry.register({
      id: 'lifecycle-post',
      event: 'PostToolUse',
      priority: 100,
      callback: async (payload) => {
        toolCallLog.push(`${payload.toolName}:${payload.isError ? 'error' : 'ok'}`)
        return {}
      }
    })

    // Step 1: Pre-tool check
    const preResult = await executePreToolUseHooks({
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_write_file',
      toolCallId: 'lc-1',
      arguments: { path: '/project/README.md', content: '# Hello' },
      grantedPaths: []
    })
    expect(preResult.decision).toBe('allow')

    // Step 2: Post-tool hook
    await executePostToolUseHooks({
      scope: 'default',
      sessionId: 'integration-sess',
      toolName: 'prizm_write_file',
      toolCallId: 'lc-1',
      arguments: { path: '/project/README.md' },
      result: 'Written',
      isError: false,
      durationMs: 30
    })
    expect(toolCallLog).toEqual(['prizm_write_file:ok'])

    // Step 3: Context budget for response
    const budget = createContextBudget({
      totalTokens: 4096,
      systemPromptReserved: 500,
      toolDefinitionsReserved: 800,
      responseBufferReserved: 800
    })
    budget.register(BUDGET_AREAS.CONVERSATION_HISTORY, 'mock history', TRIM_PRIORITIES.CONVERSATION_HISTORY)
    budget.register(BUDGET_AREAS.SCOPE_MEMORY, 'mock memory', TRIM_PRIORITIES.SCOPE_MEMORY)

    const snapshot = budget.trim()
    expect(snapshot.trimmed).toBe(false)
    expect(budget.remaining).toBeGreaterThan(0)
  })
})
