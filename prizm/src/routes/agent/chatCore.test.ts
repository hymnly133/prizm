/**
 * chatCore 核心对话逻辑单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentSession, AgentMessage, MessagePart } from '@prizm/shared'
import type { IAgentAdapter, LLMStreamChunk } from '../../adapters/interfaces'
import { chatCore, type ChatCoreOptions } from './chatCore'

// ─── 依赖 mock ───

vi.mock('../../core/ScopeStore', () => ({
  scopeStore: {
    getScopeData: vi.fn(() => ({ agentSessions: [] })),
    saveScope: vi.fn(),
    getScopeRootPath: vi.fn(() => '/tmp/scope')
  }
}))

vi.mock('../../llm/conversationSummaryService', () => ({
  scheduleTurnSummary: vi.fn()
}))

vi.mock('../../settings/agentToolsStore', () => ({
  getAgentLLMSettings: vi.fn(() => ({ defaultModel: 'test-model' })),
  getContextWindowSettings: vi.fn(() => ({ fullContextTurns: 4, cachedContextTurns: 3 }))
}))

vi.mock('../../llm/slashCommands', () => ({
  registerBuiltinSlashCommands: vi.fn(),
  tryRunSlashCommand: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../llm/skillManager', () => ({
  getSkillsToInject: vi.fn(() => []),
  getSkillsMetadataForDiscovery: vi.fn(() => []),
  loadAllSkillMetadata: vi.fn(() => [])
}))

vi.mock('../../llm/rulesLoader', () => ({
  loadRules: vi.fn(() => null)
}))

vi.mock('../../llm/agentRulesManager', () => ({
  loadActiveRules: vi.fn(() => null)
}))

vi.mock('../../llm/EverMemService', () => ({
  isMemoryEnabled: vi.fn(() => false),
  listAllUserProfiles: vi.fn(async () => []),
  searchUserAndScopeMemories: vi.fn(async () => ({ user: [], scope: [] })),
  searchThreeLevelMemories: vi.fn(async () => ({ user: [], scope: [], session: [] })),
  addMemoryInteraction: vi.fn(async () => null),
  addSessionMemoryFromRounds: vi.fn(async () => undefined),
  updateMemoryRefStats: vi.fn(async () => undefined)
}))

vi.mock('../../llm/tokenUsage', () => ({
  recordTokenUsage: vi.fn()
}))

vi.mock('../../llm/index', () => ({
  getLLMProviderName: vi.fn(() => 'test-provider')
}))

vi.mock('../../llm/memoryLogger', () => ({
  memLog: vi.fn()
}))

vi.mock('../../llm/scopeInteractionParser', () => ({
  deriveScopeActivities: vi.fn(() => [])
}))

vi.mock('../../core/mdStore', () => ({
  appendSessionActivities: vi.fn()
}))

vi.mock('../../core/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../core/checkpointStore', () => ({
  createCheckpoint: vi.fn((_sid: string, idx: number, content: string) => ({
    id: `cp-${idx}`,
    sessionId: _sid,
    messageIndex: idx,
    userContent: content,
    createdAt: Date.now(),
    fileChanges: []
  })),
  completeCheckpoint: vi.fn((cp: Record<string, unknown>) => cp),
  saveFileSnapshots: vi.fn(),
  extractFileChangesFromMessages: vi.fn(() => []),
  initSnapshotCollector: vi.fn(),
  flushSnapshotCollector: vi.fn(() => [])
}))

vi.mock('./_shared', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  persistMemoryRefs: vi.fn(),
  activeChats: new Map(),
  chatKey: vi.fn((scope: string, id: string) => `${scope}:${id}`),
  setSessionChatStatus: vi.fn()
}))

// ─── 辅助工具 ───

function createMockAdapter(
  chatYields: LLMStreamChunk[] = [{ text: '回复内容' }, { done: true }]
): IAgentAdapter {
  const sessions = new Map<string, AgentSession>()
  let msgIdCounter = 0

  const session: AgentSession = {
    id: 'test-session',
    scope: 'default',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  sessions.set(session.id, session)

  return {
    getSession: vi.fn(async (_scope: string, id: string) => sessions.get(id) ?? null),
    appendMessage: vi.fn(
      async (_scope: string, _sessionId: string, msg: Omit<AgentMessage, 'id' | 'createdAt'>) => {
        const message: AgentMessage = {
          id: `msg-${++msgIdCounter}`,
          ...msg,
          createdAt: Date.now()
        }
        const s = sessions.get(_sessionId)
        if (s) s.messages.push(message)
        return message
      }
    ),
    updateSession: vi.fn(async (_scope: string, id: string, update: Partial<AgentSession>) => {
      const s = sessions.get(id)
      if (!s) throw new Error('not found')
      Object.assign(s, update)
      return { ...s }
    }),
    chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
      for (const chunk of chatYields) {
        yield chunk
      }
    })
  }
}

// ─── 测试 ───

describe('chatCore', () => {
  let adapter: IAgentAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = createMockAdapter()
  })

  describe('基本流程', () => {
    it('正常完成：追加用户消息 + 调用 adapter.chat + 追加 assistant 消息', async () => {
      const chunks: LLMStreamChunk[] = []
      const result = await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        (chunk) => {
          chunks.push(chunk)
        }
      )

      expect(adapter.appendMessage).toHaveBeenCalledTimes(2)
      const firstCall = (adapter.appendMessage as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(firstCall[2].role).toBe('user')
      expect(firstCall[2].parts[0].content).toBe('你好')

      expect(result.appendedMsg.role).toBe('assistant')
      expect(result.parts.length).toBeGreaterThan(0)
      expect(result.stopped).toBe(false)
    })

    it('onChunk 回调被正确调用', async () => {
      const chunks: LLMStreamChunk[] = []
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        (chunk) => {
          chunks.push(chunk)
        }
      )

      expect(chunks.length).toBe(2)
      expect(chunks[0]).toEqual({ text: '回复内容' })
      expect(chunks[1]).toEqual({ done: true })
    })

    it('onReady 回调在流开始前调用', async () => {
      let readyCalled = false
      let readyInfo: unknown = null
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        () => {},
        (info) => {
          readyCalled = true
          readyInfo = info
        }
      )

      expect(readyCalled).toBe(true)
      expect(readyInfo).toHaveProperty('injectedMemories')
    })

    it('session 不存在时抛错', async () => {
      await expect(
        chatCore(
          adapter,
          {
            scope: 'default',
            sessionId: 'nonexistent',
            content: '你好'
          },
          () => {}
        )
      ).rejects.toThrow('not found')
    })
  })

  describe('skip 参数', () => {
    it('skipCheckpoint=true 不创建 checkpoint', async () => {
      const { createCheckpoint: mockCreateCp } = await import('../../core/checkpointStore')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipCheckpoint: true
        },
        () => {}
      )

      expect(mockCreateCp).not.toHaveBeenCalled()
    })

    it('skipSummary=true 不调度对话摘要', async () => {
      const { scheduleTurnSummary } = await import('../../llm/conversationSummaryService')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipSummary: true
        },
        () => {}
      )

      expect(scheduleTurnSummary).not.toHaveBeenCalled()
    })

    it('skipSummary=false 调度对话摘要', async () => {
      const { scheduleTurnSummary } = await import('../../llm/conversationSummaryService')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipSummary: false
        },
        () => {}
      )

      expect(scheduleTurnSummary).toHaveBeenCalledWith('default', 'test-session', '你好')
    })

    it('skipSlashCommands=true 跳过 slash 命令处理', async () => {
      const { tryRunSlashCommand } = await import('../../llm/slashCommands')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '/help',
          skipSlashCommands: true
        },
        () => {}
      )

      expect(tryRunSlashCommand).not.toHaveBeenCalled()
    })

    it('skipChatStatus=true 不设置聊天状态', async () => {
      const { setSessionChatStatus } = await import('./_shared')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipChatStatus: true
        },
        () => {}
      )

      expect(setSessionChatStatus).not.toHaveBeenCalled()
    })
  })

  describe('systemPreamble', () => {
    it('systemPreamble 通过 options 传递给 adapter.chat', async () => {
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          systemPreamble: '你是一个后台任务执行器'
        },
        () => {}
      )

      const chatCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0]
      const options = chatCall[3]
      expect(options.systemPreamble).toBe('你是一个后台任务执行器')
    })
  })

  describe('Slash 命令处理', () => {
    it('命令返回 response 模式 → 直接返回 commandResult', async () => {
      const { tryRunSlashCommand } = await import('../../llm/slashCommands')
      ;(tryRunSlashCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mode: 'response',
        text: '命令执行结果'
      })

      const result = await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '/status'
        },
        () => {}
      )

      expect(result.commandResult).toBe('命令执行结果')
      expect(adapter.chat).not.toHaveBeenCalled()
    })
  })

  describe('tool call 处理', () => {
    it('tool call chunks 收集到 parts 中', async () => {
      const toolAdapter = createMockAdapter([
        { toolCall: { id: 'tc-1', name: 'test_tool', arguments: '{}', result: 'ok' } },
        { text: '工具执行完毕' },
        { done: true }
      ])

      const result = await chatCore(
        toolAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '使用工具'
        },
        () => {}
      )

      const toolParts = result.parts.filter((p) => p.type === 'tool')
      expect(toolParts.length).toBe(1)
      expect((toolParts[0] as { name: string }).name).toBe('test_tool')
    })
  })

  describe('adapter 缺少方法', () => {
    it('adapter 无 chat 方法时抛错', async () => {
      const brokenAdapter: IAgentAdapter = {
        getSession: adapter.getSession,
        appendMessage: adapter.appendMessage
      }

      await expect(
        chatCore(
          brokenAdapter,
          {
            scope: 'default',
            sessionId: 'test-session',
            content: '你好'
          },
          () => {}
        )
      ).rejects.toThrow('Agent adapter missing required methods')
    })
  })

  describe('文件路径授权合并', () => {
    it('新的 fileRefPaths 被合并到 session.grantedPaths', async () => {
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          fileRefPaths: ['/path/to/file.ts']
        },
        () => {}
      )

      expect(adapter.updateSession).toHaveBeenCalledWith(
        'default',
        'test-session',
        expect.objectContaining({ grantedPaths: ['/path/to/file.ts'] })
      )
    })
  })

  describe('usage 记录', () => {
    it('用户对话记录为 chat:user', async () => {
      const { recordTokenUsage } = await import('../../llm/tokenUsage')
      const usageAdapter = createMockAdapter([
        { text: '回复' },
        { usage: { totalTokens: 100, totalInputTokens: 60, totalOutputTokens: 40 } },
        { done: true }
      ])

      await chatCore(
        usageAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        () => {}
      )

      expect(recordTokenUsage).toHaveBeenCalledWith(
        'chat:user',
        'default',
        { totalTokens: 100, totalInputTokens: 60, totalOutputTokens: 40 },
        expect.any(String),
        'test-session'
      )
    })

    it('BG session (source=workflow) 记录为 chat:workflow', async () => {
      const { recordTokenUsage } = await import('../../llm/tokenUsage')
      const sessions = new Map<string, AgentSession>()
      let msgIdCounter = 0

      const bgSession: AgentSession = {
        id: 'bg-wf-session',
        scope: 'default',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kind: 'background',
        bgMeta: { triggerType: 'event_hook', source: 'workflow', sourceId: 'run-1' }
      }
      sessions.set(bgSession.id, bgSession)

      const wfAdapter: IAgentAdapter = {
        getSession: vi.fn(async (_s: string, id: string) => sessions.get(id) ?? null),
        appendMessage: vi.fn(
          async (_s: string, _sid: string, msg: Omit<AgentMessage, 'id' | 'createdAt'>) => {
            const message: AgentMessage = {
              id: `msg-${++msgIdCounter}`,
              ...msg,
              createdAt: Date.now()
            }
            const s = sessions.get(_sid)
            if (s) s.messages.push(message)
            return message
          }
        ),
        updateSession: vi.fn(async (_s: string, id: string, update: Partial<AgentSession>) => {
          const s = sessions.get(id)
          if (!s) throw new Error('not found')
          Object.assign(s, update)
          return { ...s }
        }),
        chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
          yield { text: '工作流结果' }
          yield { usage: { totalTokens: 200, totalInputTokens: 120, totalOutputTokens: 80 } }
          yield { done: true }
        })
      }

      await chatCore(
        wfAdapter,
        {
          scope: 'default',
          sessionId: 'bg-wf-session',
          content: '执行步骤',
          actor: { type: 'system', source: 'bg-session' }
        },
        () => {}
      )

      expect(recordTokenUsage).toHaveBeenCalledWith(
        'chat:workflow',
        'default',
        expect.objectContaining({ totalTokens: 200 }),
        expect.any(String),
        'bg-wf-session'
      )
    })

    it('BG session (source=task) 记录为 chat:task', async () => {
      const { recordTokenUsage } = await import('../../llm/tokenUsage')
      const sessions = new Map<string, AgentSession>()
      let msgIdCounter = 0

      const bgSession: AgentSession = {
        id: 'bg-task-session',
        scope: 'default',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        kind: 'background',
        bgMeta: { triggerType: 'api', source: 'task', sourceId: 'task-1' }
      }
      sessions.set(bgSession.id, bgSession)

      const taskAdapter: IAgentAdapter = {
        getSession: vi.fn(async (_s: string, id: string) => sessions.get(id) ?? null),
        appendMessage: vi.fn(
          async (_s: string, _sid: string, msg: Omit<AgentMessage, 'id' | 'createdAt'>) => {
            const message: AgentMessage = {
              id: `msg-${++msgIdCounter}`,
              ...msg,
              createdAt: Date.now()
            }
            const s = sessions.get(_sid)
            if (s) s.messages.push(message)
            return message
          }
        ),
        updateSession: vi.fn(async (_s: string, id: string, update: Partial<AgentSession>) => {
          const s = sessions.get(id)
          if (!s) throw new Error('not found')
          Object.assign(s, update)
          return { ...s }
        }),
        chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
          yield { text: '任务结果' }
          yield { usage: { totalTokens: 150, totalInputTokens: 90, totalOutputTokens: 60 } }
          yield { done: true }
        })
      }

      await chatCore(
        taskAdapter,
        {
          scope: 'default',
          sessionId: 'bg-task-session',
          content: '执行任务',
          actor: { type: 'system', source: 'bg-session' }
        },
        () => {}
      )

      expect(recordTokenUsage).toHaveBeenCalledWith(
        'chat:task',
        'default',
        expect.objectContaining({ totalTokens: 150 }),
        expect.any(String),
        'bg-task-session'
      )
    })

    it('actor.source 含 guard 时记录为 chat:guard', async () => {
      const { recordTokenUsage } = await import('../../llm/tokenUsage')
      const usageAdapter = createMockAdapter([
        { text: '守卫结果' },
        { usage: { totalTokens: 50, totalInputTokens: 30, totalOutputTokens: 20 } },
        { done: true }
      ])

      await chatCore(
        usageAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '请提交结果',
          actor: { type: 'system', source: 'bg-session:guard' }
        },
        () => {}
      )

      expect(recordTokenUsage).toHaveBeenCalledWith(
        'chat:guard',
        'default',
        expect.objectContaining({ totalTokens: 50 }),
        expect.any(String),
        'test-session'
      )
    })

    it('actor.source 含 schema-retry 时记录为 chat:guard', async () => {
      const { recordTokenUsage } = await import('../../llm/tokenUsage')
      const usageAdapter = createMockAdapter([
        { text: '重试结果' },
        { usage: { totalTokens: 80, totalInputTokens: 50, totalOutputTokens: 30 } },
        { done: true }
      ])

      await chatCore(
        usageAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '请修正格式',
          actor: { type: 'system', source: 'bg-session:schema-retry' }
        },
        () => {}
      )

      expect(recordTokenUsage).toHaveBeenCalledWith(
        'chat:guard',
        'default',
        expect.objectContaining({ totalTokens: 80 }),
        expect.any(String),
        'test-session'
      )
    })
  })

  describe('A/B 滑动窗口压缩', () => {
    function createAdapterWithHistory(
      roundCount: number,
      chatYields?: LLMStreamChunk[]
    ): IAgentAdapter {
      const sessions = new Map<string, AgentSession>()
      let msgIdCounter = 0

      const messages: AgentMessage[] = []
      for (let i = 0; i < roundCount; i++) {
        messages.push({
          id: `msg-u-${i}`,
          role: 'user',
          parts: [{ type: 'text', content: `用户消息 ${i}` }],
          createdAt: Date.now()
        })
        messages.push({
          id: `msg-a-${i}`,
          role: 'assistant',
          parts: [{ type: 'text', content: `助手回复 ${i}` }],
          createdAt: Date.now()
        })
      }

      const session: AgentSession = {
        id: 'test-session',
        scope: 'default',
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      sessions.set(session.id, session)

      return {
        getSession: vi.fn(async (_scope: string, id: string) => sessions.get(id) ?? null),
        appendMessage: vi.fn(
          async (
            _scope: string,
            _sessionId: string,
            msg: Omit<AgentMessage, 'id' | 'createdAt'>
          ) => {
            const message: AgentMessage = {
              id: `msg-${++msgIdCounter}`,
              ...msg,
              createdAt: Date.now()
            }
            const s = sessions.get(_sessionId)
            if (s) s.messages.push(message)
            return message
          }
        ),
        updateSession: vi.fn(async (_scope: string, id: string, update: Partial<AgentSession>) => {
          const s = sessions.get(id)
          if (!s) throw new Error('not found')
          Object.assign(s, update)
          return { ...s }
        }),
        chat: vi.fn(async function* (): AsyncIterable<LLMStreamChunk> {
          for (const chunk of chatYields ?? [{ text: '回复' }, { done: true }]) yield chunk
        })
      }
    }

    it('当 uncompressedRounds >= fullContextTurns + cachedContextTurns 时触发压缩', async () => {
      const { addSessionMemoryFromRounds } = await import('../../llm/EverMemService')
      const historyAdapter = createAdapterWithHistory(8)

      await chatCore(
        historyAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '新消息',
          fullContextTurns: 2,
          cachedContextTurns: 2
        },
        () => {}
      )

      expect(addSessionMemoryFromRounds).toHaveBeenCalled()
      expect(historyAdapter.updateSession).toHaveBeenCalledWith(
        'default',
        'test-session',
        expect.objectContaining({ compressedThroughRound: 2 })
      )
    })

    it('rounds 不足时不触发压缩', async () => {
      const { addSessionMemoryFromRounds } = await import('../../llm/EverMemService')
      const historyAdapter = createAdapterWithHistory(3)

      await chatCore(
        historyAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '新消息',
          fullContextTurns: 4,
          cachedContextTurns: 3
        },
        () => {}
      )

      expect(addSessionMemoryFromRounds).not.toHaveBeenCalled()
    })

    it('skipNarrativeBatchExtract=true 时跳过记忆抽取但仍更新 compressedThroughRound', async () => {
      const { addSessionMemoryFromRounds } = await import('../../llm/EverMemService')
      const historyAdapter = createAdapterWithHistory(8)

      await chatCore(
        historyAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '新消息',
          fullContextTurns: 2,
          cachedContextTurns: 2,
          skipNarrativeBatchExtract: true
        },
        () => {}
      )

      expect(addSessionMemoryFromRounds).not.toHaveBeenCalled()
      expect(historyAdapter.updateSession).toHaveBeenCalledWith(
        'default',
        'test-session',
        expect.objectContaining({ compressedThroughRound: 2 })
      )
    })
  })

  describe('记忆注入', () => {
    it('记忆启用时 onReady 返回注入的记忆', async () => {
      const { isMemoryEnabled, listAllUserProfiles, searchUserAndScopeMemories } =
        await import('../../llm/EverMemService')
      ;(isMemoryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)
      ;(listAllUserProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'p1', memory: '用户喜欢 TypeScript', memory_type: 'profile' }
      ])
      ;(searchUserAndScopeMemories as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: [],
        scope: [{ id: 's1', memory: '工作区记忆', memory_type: 'narrative' }]
      })

      let readyInfo: unknown = null
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '这是一条足够长的消息来触发记忆注入'
        },
        () => {},
        (info) => {
          readyInfo = info
        }
      )

      expect(readyInfo).toHaveProperty('injectedMemories')
      const memories = (readyInfo as { injectedMemories: { user: unknown[]; scope: unknown[] } })
        .injectedMemories
      expect(memories).not.toBeNull()
      expect(memories!.user.length).toBe(1)
    })

    it('skipMemory=true 时不注入记忆', async () => {
      const { isMemoryEnabled, listAllUserProfiles } = await import('../../llm/EverMemService')
      ;(isMemoryEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)

      let readyInfo: { injectedMemories: unknown } | null = null
      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipMemory: true
        },
        () => {},
        (info) => {
          readyInfo = info as { injectedMemories: unknown }
        }
      )

      expect(listAllUserProfiles).not.toHaveBeenCalled()
      expect(readyInfo?.injectedMemories).toBeNull()
    })
  })

  describe('Abort 后 persist 行为', () => {
    it('abort 后已收到的内容被持久化，result.stopped=true', async () => {
      const ac = new AbortController()
      let chunkCount = 0

      const abortAdapter = createMockAdapter([
        { text: '部分' },
        { text: '内容' },
        { text: '更多' },
        { done: true }
      ])

      ;(abortAdapter.chat as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (): AsyncIterable<LLMStreamChunk> {
          yield { text: '部分' }
          yield { text: '内容' }
          ac.abort()
          yield { text: '更多' }
          yield { done: true }
        }
      )

      const chunks: LLMStreamChunk[] = []
      const result = await chatCore(
        abortAdapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          signal: ac.signal,
          skipCheckpoint: true
        },
        (chunk) => {
          chunks.push(chunk)
          chunkCount++
        }
      )

      expect(result.stopped).toBe(true)
      expect(result.appendedMsg.role).toBe('assistant')
      const textParts = result.parts.filter((p) => p.type === 'text')
      expect(textParts.length).toBeGreaterThan(0)
    })
  })

  describe('Checkpoint 创建与完成', () => {
    it('默认模式下创建并完成 checkpoint', async () => {
      const {
        createCheckpoint: mockCreateCp,
        completeCheckpoint: mockCompleteCp,
        initSnapshotCollector: mockInitSnap,
        flushSnapshotCollector: mockFlushSnap,
        saveFileSnapshots: mockSaveSnap
      } = await import('../../core/checkpointStore')
      const { scopeStore: mockScopeStore } = await import('../../core/ScopeStore')

      const testSession: AgentSession = {
        id: 'test-session',
        scope: 'default',
        messages: [],
        checkpoints: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      ;(mockScopeStore.getScopeData as ReturnType<typeof vi.fn>).mockReturnValue({
        agentSessions: [testSession]
      })

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '测试 checkpoint'
        },
        () => {}
      )

      expect(mockCreateCp).toHaveBeenCalledWith('test-session', 0, '测试 checkpoint')
      expect(mockInitSnap).toHaveBeenCalledWith('test-session')
      expect(mockCompleteCp).toHaveBeenCalled()
      expect(mockFlushSnap).toHaveBeenCalledWith('test-session')
      expect(mockSaveSnap).toHaveBeenCalled()
    })

    it('skipCheckpoint=true 时不创建 checkpoint 也不初始化 snapshot', async () => {
      const { createCheckpoint: mockCreateCp, initSnapshotCollector: mockInitSnap } =
        await import('../../core/checkpointStore')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好',
          skipCheckpoint: true
        },
        () => {}
      )

      expect(mockCreateCp).not.toHaveBeenCalled()
      expect(mockInitSnap).not.toHaveBeenCalled()
    })
  })

  describe('activeChats 并发替换', () => {
    it('同一 session 的第二次调用会 abort 第一次的 AbortController', async () => {
      const { activeChats: mockActiveChats } = await import('./_shared')

      const existingAc = new AbortController()
      const abortSpy = vi.spyOn(existingAc, 'abort')
      mockActiveChats.set('default:test-session', existingAc)

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        () => {}
      )

      expect(abortSpy).toHaveBeenCalled()
    })
  })

  describe('Slash 命令 prompt 模式', () => {
    it('命令返回 prompt 模式 → 通过 options.promptInjection 传递给 adapter.chat', async () => {
      const { tryRunSlashCommand } = await import('../../llm/slashCommands')
      ;(tryRunSlashCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mode: 'prompt',
        text: '请列出所有待办',
        commandName: 'todos'
      })

      const result = await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '/todos'
        },
        () => {}
      )

      expect(adapter.chat).toHaveBeenCalled()
      expect(result.commandResult).toBeUndefined()

      const chatCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0]
      const options = chatCall[3]
      expect(options.promptInjection).toBeDefined()
      expect(options.promptInjection).toContain('命令指令')
      expect(options.promptInjection).toContain('请列出所有待办')
    })
  })

  describe('chatStatus 生命周期', () => {
    it('正常流程：先设置 chatting，结束后设置 idle', async () => {
      const { setSessionChatStatus } = await import('./_shared')

      await chatCore(
        adapter,
        {
          scope: 'default',
          sessionId: 'test-session',
          content: '你好'
        },
        () => {}
      )

      const calls = (setSessionChatStatus as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBe(2)
      expect(calls[0][2]).toBe('chatting')
      expect(calls[1][2]).toBe('idle')
    })

    it('adapter.chat 抛错时仍在 finally 中设置 idle', async () => {
      const { setSessionChatStatus } = await import('./_shared')

      const errorAdapter = createMockAdapter()
      ;(errorAdapter.chat as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (): AsyncIterable<LLMStreamChunk> {
          throw new Error('LLM provider error')
        }
      )

      await expect(
        chatCore(
          errorAdapter,
          {
            scope: 'default',
            sessionId: 'test-session',
            content: '你好'
          },
          () => {}
        )
      ).rejects.toThrow('LLM provider error')

      const calls = (setSessionChatStatus as ReturnType<typeof vi.fn>).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall[2]).toBe('idle')
    })
  })
})
