/**
 * ToolLLMManager 单元测试
 *
 * Mock chatCore 和 adapter，验证 Tool LLM 的核心编排逻辑：
 * - start: 创建会话 + 首轮对话
 * - resume: 复用会话追加轮次
 * - confirm: 确认注册工作流
 * - cancel: 取消会话
 * - getSessionIdForWorkflow: 通过 DefMeta 查找会话
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  type AgentSession,
  WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
  WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW
} from '@prizm/shared'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import type { IChatService, ChatCoreResult, ChatCoreChunkHandler } from '../../core/interfaces'
import { ToolLLMManager } from './manager'

vi.mock('../../core/workflowEngine/workflowDefStore', () => ({
  getDefByName: vi.fn(),
  getDefMeta: vi.fn(),
  registerDef: vi.fn(),
  updateDefMeta: vi.fn()
}))

import * as defStore from '../../core/workflowEngine/workflowDefStore'

const mockGetDefByName = defStore.getDefByName as ReturnType<typeof vi.fn>
const mockGetDefMeta = defStore.getDefMeta as ReturnType<typeof vi.fn>
const mockRegisterDef = defStore.registerDef as ReturnType<typeof vi.fn>
const mockUpdateDefMeta = defStore.updateDefMeta as ReturnType<typeof vi.fn>

function createMockAdapter(): IAgentAdapter {
  const sessions = new Map<string, AgentSession>()
  let idCounter = 0
  return {
    createSession: vi.fn(async (scope: string) => {
      const session: AgentSession = {
        id: `tl-sess-${++idCounter}`,
        scope,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      sessions.set(session.id, session)
      return session
    }),
    getSession: vi.fn(async (_scope: string, id: string) => sessions.get(id) ?? null),
    updateSession: vi.fn(async (_scope: string, id: string, update: Partial<AgentSession>) => {
      const s = sessions.get(id)
      if (!s) throw new Error('not found')
      Object.assign(s, update, { updatedAt: Date.now() })
      return { ...s }
    }),
    appendMessage: vi.fn(async () => ({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      parts: [],
      createdAt: Date.now()
    })),
    chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
      yield { text: '生成工作流…' }
    })
  }
}

function createMockChatService(toolResult?: {
  name: string
  arguments: string
  result: string
}): IChatService {
  return {
    execute: vi.fn(
      async (
        _adapter: IAgentAdapter,
        _options: Record<string, unknown>,
        onChunk: ChatCoreChunkHandler
      ): Promise<ChatCoreResult> => {
        onChunk({ text: '正在设计工作流…' })

        const parts = toolResult
          ? [
              {
                type: 'tool' as const,
                id: 'tc-1',
                name: toolResult.name,
                arguments: toolResult.arguments,
                result: toolResult.result,
                status: 'done' as const
              }
            ]
          : [{ type: 'text' as const, content: '工作流已生成' }]

        return {
          appendedMsg: {
            id: 'msg-1',
            role: 'assistant',
            parts,
            createdAt: Date.now()
          },
          parts,
          reasoning: '',
          memoryRefs: {
            injected: { user: [], scope: [], session: [] },
            created: { user: [], scope: [], session: [] }
          },
          injectedMemories: null,
          stopped: false
        }
      }
    )
  }
}

const VALID_WORKFLOW_JSON = JSON.stringify({
  name: 'test_workflow',
  description: 'A test workflow',
  steps: [{ type: 'agent', prompt: 'Do something', id: 'step_1' }]
})

describe('ToolLLMManager', () => {
  let manager: ToolLLMManager
  let adapter: IAgentAdapter

  beforeEach(() => {
    manager = new ToolLLMManager()
    adapter = createMockAdapter()
    vi.clearAllMocks()
  })

  it('should throw if not initialized', async () => {
    await expect(
      manager.start('default', { domain: 'workflow', intent: 'test' }, () => {})
    ).rejects.toThrow('ToolLLMManager not initialized')
  })

  describe('start', () => {
    it('should create session and execute first round', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      const chunks: string[] = []
      const result = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建一个测试工作流' },
        (chunk) => {
          if (chunk.text) chunks.push(chunk.text)
        }
      )

      expect(result.sessionId).toBe('tl-sess-1')
      expect(result.status).toBe('preview')
      expect(result.version).toBeGreaterThan(0)
      expect(result.workflowDef).toBeDefined()
      expect(result.workflowDef?.name).toBe('test_workflow')
      expect(adapter.createSession).toHaveBeenCalledWith('default')
      expect(adapter.updateSession).toHaveBeenCalled()
      expect(chatService.execute).toHaveBeenCalledOnce()
    })

    it('should handle invalid workflow JSON from LLM', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: '{"invalid": true}' }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      const result = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )

      expect(result.status).toBe('error')
      expect(result.validationError).toBeDefined()
    })
  })

  describe('resume', () => {
    it('should append message to existing session', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      const startResult = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )

      const resumeResult = await manager.resume(
        'default',
        startResult.sessionId,
        '添加一个审批步骤',
        () => {}
      )

      expect(resumeResult.sessionId).toBe(startResult.sessionId)
      expect(resumeResult.version).toBeGreaterThan(startResult.version)
      expect(chatService.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('confirm', () => {
    it('should register workflow and update DefMeta', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      mockRegisterDef.mockReturnValue({ id: 'def-1', name: 'test_workflow' })

      const startResult = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )

      const confirmResult = await manager.confirm('default', startResult.sessionId, 'test_workflow')

      expect(confirmResult.status).toBe('confirmed')
      expect(mockRegisterDef).toHaveBeenCalledWith(
        'test_workflow',
        'default',
        expect.any(String),
        expect.any(String)
      )
      expect(mockUpdateDefMeta).toHaveBeenCalledWith('test_workflow', 'default', {
        workflowManagementSessionId: startResult.sessionId
      })
    })

    it('should throw if no pending def', async () => {
      const chatService = createMockChatService()
      manager.init(adapter, chatService)

      await expect(manager.confirm('default', 'nonexistent', 'test')).rejects.toThrow(
        'No pending workflow definition to confirm'
      )
    })

    it('should write toolMeta.workflowDefId and workflowName to session (bidirectional link)', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      mockRegisterDef.mockReturnValue({
        id: 'def-bidirectional',
        name: 'test_workflow'
      })

      const startResult = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )

      await manager.confirm('default', startResult.sessionId, 'test_workflow')

      expect(adapter.updateSession).toHaveBeenCalledWith(
        'default',
        startResult.sessionId,
        expect.objectContaining({
          toolMeta: expect.objectContaining({
            workflowDefId: 'def-bidirectional',
            workflowName: 'test_workflow'
          })
        })
      )
    })

    it('should include triggerType in bgMeta when updating legacy background session', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)
      mockRegisterDef.mockReturnValue({ id: 'def-1', name: 'test_workflow' })
      ;(adapter.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'tl-sess-1',
        kind: 'background',
        bgMeta: { source: 'workflow-management' }
      } as AgentSession)

      const startResult = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )
      await manager.confirm('default', startResult.sessionId, 'test_workflow')

      const updateCalls = (adapter.updateSession as ReturnType<typeof vi.fn>).mock.calls
      const confirmUpdate = updateCalls.find(
        (c: unknown[]) =>
          c[1] === startResult.sessionId &&
          (c[2] as { bgMeta?: { workflowDefId?: string } })?.bgMeta?.workflowDefId
      )
      expect(confirmUpdate).toBeDefined()
      const bgMeta = (
        confirmUpdate![2] as {
          bgMeta?: { triggerType?: string; workflowDefId?: string; workflowName?: string }
        }
      ).bgMeta
      expect(bgMeta?.triggerType).toBeDefined()
      expect(bgMeta?.workflowDefId).toBe('def-1')
      expect(bgMeta?.workflowName).toBe('test_workflow')
    })
  })

  describe('cancel', () => {
    it('should mark session as cancelled', async () => {
      const chatService = createMockChatService({
        name: WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW,
        arguments: JSON.stringify({ workflow_json: VALID_WORKFLOW_JSON }),
        result: 'ok'
      })
      manager.init(adapter, chatService)

      const startResult = await manager.start(
        'default',
        { domain: 'workflow', intent: '创建工作流' },
        () => {}
      )

      manager.cancel(startResult.sessionId)
      expect(manager.getActiveSession(startResult.sessionId)).toBeUndefined()
    })
  })

  describe('getSessionIdForWorkflow', () => {
    it('should return sessionId from DefMeta', () => {
      const chatService = createMockChatService()
      manager.init(adapter, chatService)

      mockGetDefByName.mockReturnValue({ id: 'def-1', name: 'my_wf' })
      mockGetDefMeta.mockReturnValue({ id: 'def-1', workflowManagementSessionId: 'session-42' })

      const result = manager.getSessionIdForWorkflow('default', 'my_wf')
      expect(result).toBe('session-42')
    })

    it('should return undefined if no def found', () => {
      const chatService = createMockChatService()
      manager.init(adapter, chatService)

      mockGetDefByName.mockReturnValue(null)

      const result = manager.getSessionIdForWorkflow('default', 'missing')
      expect(result).toBeUndefined()
    })

    it('should return undefined if no sessionId in DefMeta', () => {
      const chatService = createMockChatService()
      manager.init(adapter, chatService)

      mockGetDefByName.mockReturnValue({ id: 'def-1', name: 'my_wf' })
      mockGetDefMeta.mockReturnValue({ id: 'def-1' })

      const result = manager.getSessionIdForWorkflow('default', 'my_wf')
      expect(result).toBeUndefined()
    })
  })
})
