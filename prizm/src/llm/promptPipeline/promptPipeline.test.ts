/**
 * promptPipeline 单元测试
 *
 * 覆盖 resolveScenario、buildPromptForScenario 与 cache 对齐（sessionStatic 会话内不变）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveScenario, buildPromptContext, buildPromptForScenario } from './index'
import type { PromptScenario } from './types'

const mockGetScopeData = vi.fn(() => ({ agentSessions: [] }))
const mockGetScopeRootPath = vi.fn(() => '/tmp/scope')
vi.mock('../../core/ScopeStore', () => ({
  scopeStore: {
    getScopeData: (scope: string) => mockGetScopeData(scope),
    getScopeRootPath: (scope: string) => mockGetScopeRootPath(scope)
  }
}))

vi.mock('../../core/PathProviderCore', () => ({
  getSessionWorkspaceDir: vi.fn((_root: string, sid: string) => `/tmp/scope/workspace/${sid}`)
}))

vi.mock('../../core/resourceLockManager', () => ({
  lockManager: { listSessionLocks: vi.fn(() => []) }
}))

vi.mock('../scopeContext', () => ({
  buildScopeContextSummary: vi.fn().mockResolvedValue('')
}))

describe('promptPipeline', () => {
  describe('resolveScenario', () => {
    it('无 session 返回 interactive', () => {
      expect(resolveScenario('default', 's1', null)).toBe('interactive')
    })

    it('kind=tool 且 source=workflow-management 返回 tool_workflow_management', () => {
      const session = {
        id: 't1',
        scope: 'default',
        kind: 'tool' as const,
        toolMeta: { source: 'workflow-management' as const },
        messages: [],
        createdAt: 0,
        updatedAt: 0
      }
      expect(resolveScenario('default', 't1', session)).toBe('tool_workflow_management')
    })

    it('kind=background 且 source=workflow 返回 background_workflow_step', () => {
      const session = {
        id: 'b1',
        scope: 'default',
        kind: 'background' as const,
        bgMeta: { source: 'workflow' as const },
        messages: [],
        createdAt: 0,
        updatedAt: 0
      }
      expect(resolveScenario('default', 'b1', session)).toBe('background_workflow_step')
    })

    it('kind=background 且 source=api 返回 background_task', () => {
      const session = {
        id: 'b2',
        scope: 'default',
        kind: 'background' as const,
        bgMeta: { source: 'api' as const },
        messages: [],
        createdAt: 0,
        updatedAt: 0
      }
      expect(resolveScenario('default', 'b2', session)).toBe('background_task')
    })
  })

  describe('buildPromptForScenario', () => {
    beforeEach(() => {
      mockGetScopeData.mockReturnValue({
        agentSessions: [
          {
            id: 's1',
            scope: 'default',
            messages: [],
            createdAt: 0,
            updatedAt: 0
          }
        ]
      })
      mockGetScopeRootPath.mockReturnValue('/tmp/scope')
    })

    it('interactive 场景产出 identity + instructions + env', async () => {
      const ctx = buildPromptContext({
        scope: 'default',
        sessionId: 's1',
        session: {
          id: 's1',
          scope: 'default',
          messages: [],
          createdAt: 0,
          updatedAt: 0
        },
        includeScopeContext: false
      })
      const out = await buildPromptForScenario('interactive', ctx)
      expect(out.sessionStatic).toContain('<identity>')
      expect(out.sessionStatic).toContain('<instructions>')
      expect(out.sessionStatic).toContain('<env>')
    })

    it('tool_workflow_management 场景 sessionStatic 含工作流专家且无 instructions', async () => {
      const ctx = buildPromptContext({
        scope: 'default',
        sessionId: 't1',
        session: {
          id: 't1',
          scope: 'default',
          kind: 'tool',
          toolMeta: { source: 'workflow-management', workflowName: 'test_wf' },
          messages: [],
          createdAt: 0,
          updatedAt: 0
        },
        includeScopeContext: false,
        workflowEditContext: 'name: test_wf\nsteps: []'
      })
      const out = await buildPromptForScenario('tool_workflow_management', ctx)
      expect(out.sessionStatic).toContain('工作流设计专家')
      expect(out.sessionStatic).toContain('<schema>')
      expect(out.sessionStatic).not.toContain('你是 Prizm 工作区助手')
      expect(out.perTurnDynamic).toContain('<current_definition>')
      expect(out.perTurnDynamic).toContain('name: test_wf')
    })

    it('同一会话相同 context 两次构建 sessionStatic 一致（cache 不变性）', async () => {
      const session = {
        id: 's1',
        scope: 'default',
        messages: [],
        createdAt: 0,
        updatedAt: 0
      }
      const ctx = buildPromptContext({
        scope: 'default',
        sessionId: 's1',
        session,
        includeScopeContext: false,
        rulesContent: '## R',
        customRulesContent: '## U'
      })
      const [out1, out2] = await Promise.all([
        buildPromptForScenario('interactive', ctx),
        buildPromptForScenario('interactive', ctx)
      ])
      expect(out1.sessionStatic).toBe(out2.sessionStatic)
    })
  })
})
