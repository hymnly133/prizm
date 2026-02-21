/**
 * resultGuard 纯函数单元测试
 */

import { describe, it, expect } from 'vitest'
import type { AgentSession } from '@prizm/shared'
import {
  needsResultGuard,
  extractFallbackResult,
  RESULT_GUARD_PROMPT,
  getResultGuardPrompt
} from './resultGuard'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-1',
    scope: 'default',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

describe('needsResultGuard', () => {
  it('kind=background + running + 无 bgResult → true', () => {
    const session = makeSession({ kind: 'background', bgStatus: 'running' })
    expect(needsResultGuard(session)).toBe(true)
  })

  it('kind=background + running + 有 bgResult → false', () => {
    const session = makeSession({
      kind: 'background',
      bgStatus: 'running',
      bgResult: '任务已完成'
    })
    expect(needsResultGuard(session)).toBe(false)
  })

  it('kind=background + completed → false', () => {
    const session = makeSession({ kind: 'background', bgStatus: 'completed' })
    expect(needsResultGuard(session)).toBe(false)
  })

  it('kind=interactive → false', () => {
    const session = makeSession({ bgStatus: 'running' })
    expect(needsResultGuard(session)).toBe(false)
  })

  it('kind 缺失（旧数据兼容）→ false', () => {
    const session = makeSession()
    expect(needsResultGuard(session)).toBe(false)
  })
})

describe('extractFallbackResult', () => {
  it('有 assistant 消息（含 text parts）→ 返回最后一条文本', () => {
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'text', content: '执行任务' }],
          createdAt: 1
        },
        {
          id: 'm2',
          role: 'assistant',
          parts: [{ type: 'text', content: '已完成分析报告' }],
          createdAt: 2
        }
      ]
    })
    expect(extractFallbackResult(session)).toBe('已完成分析报告')
  })

  it('多条 assistant 消息 → 返回最后一条', () => {
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', content: '第一条回复' }],
          createdAt: 1
        },
        {
          id: 'm2',
          role: 'user',
          parts: [{ type: 'text', content: '继续' }],
          createdAt: 2
        },
        {
          id: 'm3',
          role: 'assistant',
          parts: [{ type: 'text', content: '最终回复' }],
          createdAt: 3
        }
      ]
    })
    expect(extractFallbackResult(session)).toBe('最终回复')
  })

  it('assistant 消息只有 tool parts 无 text → 继续往前找', () => {
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', content: '中间回复' }],
          createdAt: 1
        },
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            {
              type: 'tool',
              id: 'tc-1',
              name: 'prizm_file',
              arguments: '{}',
              result: 'ok'
            }
          ],
          createdAt: 2
        }
      ]
    })
    expect(extractFallbackResult(session)).toBe('中间回复')
  })

  it('无 assistant 消息 → 返回默认兜底字符串', () => {
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'text', content: '执行任务' }],
          createdAt: 1
        }
      ]
    })
    expect(extractFallbackResult(session)).toBe('（后台任务已执行，但未产生明确输出）')
  })

  it('空 parts 数组 → 返回默认兜底字符串', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', role: 'assistant', parts: [], createdAt: 1 }
      ]
    })
    expect(extractFallbackResult(session)).toBe('（后台任务已执行，但未产生明确输出）')
  })
})

describe('RESULT_GUARD_PROMPT', () => {
  it('包含 prizm_set_result 关键词', () => {
    expect(RESULT_GUARD_PROMPT).toContain('prizm_set_result')
  })
})

describe('getResultGuardPrompt', () => {
  it('workflow 步骤返回专用提示（强调传给下一步或流水线结果）', () => {
    const session = {
      kind: 'background' as const,
      bgMeta: { source: 'workflow' as const }
    }
    const prompt = getResultGuardPrompt(session as import('@prizm/shared').AgentSession)
    expect(prompt).toContain('prizm_set_result')
    expect(prompt).toContain('下一步')
  })

  it('非 workflow 后台会话返回默认提示', () => {
    const session = { kind: 'background' as const, bgMeta: { source: 'api' as const } }
    expect(getResultGuardPrompt(session as import('@prizm/shared').AgentSession)).toBe(
      RESULT_GUARD_PROMPT
    )
  })
})
