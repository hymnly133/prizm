/**
 * systemPrompt 单元测试
 *
 * 重点：Cache 友好结构对齐测试 —— 保证 SESSION-STATIC 与 PER-TURN DYNAMIC 拆分正确，
 * 同一会话内 sessionStatic 不变，且 sessionStatic 不包含每轮变化内容。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildSystemPromptParts,
  type SystemPromptOptions,
  type SystemPromptParts
} from './systemPrompt'

// ─── 依赖 mock（与 buildSystemPromptParts 实际依赖对齐）────

const mockGetScopeData = vi.fn()
const mockGetScopeRootPath = vi.fn()
vi.mock('../core/ScopeStore', () => ({
  scopeStore: {
    getScopeData: (scope: string) => mockGetScopeData(scope),
    getScopeRootPath: (scope: string) => mockGetScopeRootPath(scope)
  }
}))

const mockGetSessionWorkspaceDir = vi.fn()
vi.mock('../core/PathProviderCore', () => ({
  getSessionWorkspaceDir: (scopeRoot: string, sessionId: string) =>
    mockGetSessionWorkspaceDir(scopeRoot, sessionId)
}))

const mockListSessionLocks = vi.fn()
vi.mock('../core/resourceLockManager', () => ({
  lockManager: {
    listSessionLocks: (scope: string, sessionId: string) =>
      mockListSessionLocks(scope, sessionId)
  }
}))

const mockBuildScopeContextSummary = vi.fn()
vi.mock('./scopeContext', () => ({
  buildScopeContextSummary: (scope: string) => mockBuildScopeContextSummary(scope)
}))

const mockGetDefById = vi.fn()
const mockGetDefByName = vi.fn()
vi.mock('../core/workflowEngine/workflowDefStore', () => ({
  getDefById: (id: string) => mockGetDefById(id),
  getDefByName: (name: string, scope: string) => mockGetDefByName(name, scope)
}))

describe('systemPrompt', () => {
  const defaultScope = 'default'
  const defaultSessionId = 'sess-static-test'
  const defaultScopeRoot = '/tmp/prizm-scope'

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetScopeRootPath.mockReturnValue(defaultScopeRoot)
    mockGetSessionWorkspaceDir.mockReturnValue(`${defaultScopeRoot}/workspace/${defaultSessionId}`)
    mockListSessionLocks.mockReturnValue([])
    mockBuildScopeContextSummary.mockResolvedValue('## 文档\n- doc1\n\n## 待办\n- todo1')
    mockGetScopeData.mockReturnValue({
      agentSessions: [
        {
          id: defaultSessionId,
          scope: defaultScope,
          messages: [],
          createdAt: 0,
          updatedAt: 0
        }
      ]
    })
  })

  describe('Cache 友好结构对齐', () => {
    /** sessionStatic 中禁止出现的每轮变化内容（应只在 perTurnDynamic 或 adapter 侧 memoryTexts/promptInjection 中）。
     * 注：identity 中“用户画像由系统每轮自动注入”为说明文案，非注入块本身；禁止的是记忆注入块标题【用户画像】。 */
    const PER_TURN_ONLY_MARKERS = [
      '<workspace_context',
      '<active_locks>',
      '【用户画像',
      '【相关记忆】',
      '【文档记忆】',
      '【会话记忆】',
      '【前瞻/意图】'
    ] as const

    it('sessionStatic 不包含每轮变化内容（workspace_context / active_locks / 画像 / 记忆）', async () => {
      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId,
        includeScopeContext: true,
        rulesContent: undefined,
        customRulesContent: undefined
      })

      for (const marker of PER_TURN_ONLY_MARKERS) {
        expect(out.sessionStatic, `sessionStatic 不应包含 "${marker}"`).not.toContain(marker)
      }
    })

    it('perTurnDynamic 可包含 workspace_context 与 active_locks（由 buildSystemPromptParts 产出）', async () => {
      mockBuildScopeContextSummary.mockResolvedValue('## 文档\n- d1')
      mockListSessionLocks.mockReturnValue([
        { resourceType: 'document', resourceId: 'doc-1', reason: 'editing' }
      ])

      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId,
        includeScopeContext: true
      })

      expect(out.perTurnDynamic).toMatch(/<workspace_context\s/)
      expect(out.perTurnDynamic).toContain('<active_locks>')
    })

    it('includeScopeContext=false 时 perTurnDynamic 不包含 workspace_context', async () => {
      mockBuildScopeContextSummary.mockResolvedValue('## 文档\n- d1')

      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId,
        includeScopeContext: false
      })

      expect(out.perTurnDynamic).not.toContain('<workspace_context>')
    })

    it('sessionStatic 包含会话内不变的结构（identity / instructions / env）', async () => {
      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId
      })

      expect(out.sessionStatic).toContain('<identity>')
      expect(out.sessionStatic).toContain('</identity>')
      expect(out.sessionStatic).toContain('<instructions>')
      expect(out.sessionStatic).toContain('<env>')
      expect(out.sessionStatic).toContain(`scope=${defaultScope}`)
      expect(out.sessionStatic).toContain(`root=${defaultScopeRoot}`)
    })

    it('同一会话、相同 options 两次调用得到的 sessionStatic 完全一致（cache 不变性）', async () => {
      const options: SystemPromptOptions = {
        scope: defaultScope,
        sessionId: defaultSessionId,
        includeScopeContext: true,
        rulesContent: '## Project rules',
        customRulesContent: '## User rules',
        activeSkillInstructions: [{ name: 'sk1', instructions: 'Do X' }]
      }

      const [out1, out2] = await Promise.all([
        buildSystemPromptParts(options),
        buildSystemPromptParts(options)
      ])

      expect(out1.sessionStatic).toBe(out2.sessionStatic)
      expect(out1.sessionStatic.length).toBeGreaterThan(0)
    })

    it('无 sessionId 时 sessionStatic 仍稳定且不含 session 相关路径', async () => {
      mockGetScopeData.mockReturnValue({ agentSessions: [] })

      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: undefined,
        includeScopeContext: false
      })

      expect(out.sessionStatic).toContain('<identity>')
      expect(out.sessionStatic).toContain('<env>')
      expect(out.sessionStatic).not.toContain('session_workspace=')
    })
  })

  describe('工作流管理会话的 static 与 dynamic 拆分', () => {
    const WORKFLOW_MANAGEMENT_SOURCE = 'workflow-management'

    beforeEach(() => {
      mockGetScopeData.mockReturnValue({
        agentSessions: [
          {
            id: 'tool-sess-1',
            scope: defaultScope,
            kind: 'tool',
            toolMeta: {
              source: WORKFLOW_MANAGEMENT_SOURCE,
              label: '工作流管理: test_wf',
              workflowName: 'test_wf',
              persistentWorkspaceDir: '/tmp/wf-workspace'
            },
            messages: [],
            createdAt: 0,
            updatedAt: 0
          }
        ]
      })
      mockGetDefByName.mockReturnValue(null)
      mockGetDefById.mockReturnValue(null)
    })

    it('工作流管理会话 sessionStatic 含工作流专家身份且不含通用 instructions', async () => {
      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: 'tool-sess-1'
      })

      expect(out.sessionStatic).toContain('工作流设计专家')
      expect(out.sessionStatic).toContain('<schema>')
      expect(out.sessionStatic).toContain('WorkflowDef')
      // 通用工作区助手的工具路由不应出现
      expect(out.sessionStatic).not.toContain('你是 Prizm 工作区助手')
      expect(out.sessionStatic).not.toContain('prizm_workflow\n')
    })
  })

  describe('buildSystemPromptParts 返回结构', () => {
    it('返回 sessionStatic 与 perTurnDynamic 两个字段', async () => {
      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId
      })

      expect(out).toHaveProperty('sessionStatic')
      expect(out).toHaveProperty('perTurnDynamic')
      expect(typeof out.sessionStatic).toBe('string')
      expect(typeof out.perTurnDynamic).toBe('string')
    })

    it('无锁且 includeScopeContext=false 时 perTurnDynamic 可为空', async () => {
      mockBuildScopeContextSummary.mockResolvedValue('')

      const out = await buildSystemPromptParts({
        scope: defaultScope,
        sessionId: defaultSessionId,
        includeScopeContext: false
      })

      expect(mockListSessionLocks).toHaveBeenCalledWith(defaultScope, defaultSessionId)
      expect(out.perTurnDynamic).toBe('')
    })
  })
})
