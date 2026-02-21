/**
 * chatCore — 统一 Chat 核心逻辑
 *
 * 从 chat.ts SSE 路由中抽取的可复用对话核心，
 * 供 SSE 路由和 BackgroundSessionManager 共用。
 *
 * 包含完整链路：
 * - 对话摘要调度
 * - 上下文窗口 A/B 滑动压缩
 * - 记忆注入（画像 + 工作区 + 会话）
 * - Skill 自动激活 + Rules 加载
 * - Checkpoint 创建与完成
 * - adapter.chat() 流式调用
 * - 消息持久化 + 记忆提取 + 事件发射
 * - Token 使用量记录
 * - Scope 活动记录
 */

import type { IAgentAdapter, LLMStreamChunk } from '../../../adapters/interfaces'
import type {
  AgentMessage,
  AgentSession,
  MemoryIdsByLayer,
  MemoryRefs,
  MessagePart,
  MessagePartTool,
  OperationActor,
  TokenUsageCategory
} from '@prizm/shared'
import {
  getTextContent,
  getMessageContent,
  isWorkflowManagementSession,
  CHAT_CATEGORY_WORKFLOW_MANAGEMENT
} from '@prizm/shared'
import { scopeStore } from '../../../core/ScopeStore'
import { scheduleTurnSummary } from '../../../llm/conversationSummaryService'
import { getAgentLLMSettings, getContextWindowSettings } from '../../../settings/agentToolsStore'
import { tryRunSlashCommand } from '../../../llm/slashCommands'
import {
  loadAllSkillMetadata,
  getSkillsToInject,
  getSkillsMetadataForDiscovery
} from '../../../llm/skillManager'
import { loadRules } from '../../../llm/rulesLoader'
import { loadActiveRules } from '../../../llm/agentRulesManager'
import {
  isMemoryEnabled,
  addMemoryInteraction,
  addSessionMemoryFromRounds
} from '../../../llm/EverMemService'
import { recordTokenUsage } from '../../../llm/tokenUsage'
import { getLLMProviderName } from '../../../llm/index'
import { memLog } from '../../../llm/memoryLogger'
import { deriveScopeActivities } from '../../../llm/scopeInteractionParser'
import { appendSessionActivities } from '../../../core/mdStore'
import { emit } from '../../../core/eventBus'
import * as resumeStore from '../../../core/workflowEngine/resumeStore'
import { getWorkflowRunWorkspace, getSessionWorkspaceDir } from '../../../core/PathProviderCore'
import { createContextBudget, BUDGET_AREAS, TRIM_PRIORITIES } from '../../../llm/contextBudget'
import {
  createCheckpoint,
  completeCheckpoint,
  saveFileSnapshots,
  extractFileChangesFromMessages,
  initSnapshotCollector,
  flushSnapshotCollector
} from '../../../core/checkpointStore'
import { log, persistMemoryRefs, activeChats, chatKey, setSessionChatStatus } from '../_shared'
import { injectMemories } from './memoryInjection'
import type {
  ChatCoreOptions,
  ChatCoreChunkHandler,
  ChatCoreReadyHandler,
  ChatCoreResult
} from './types'

export {
  type ChatCoreOptions,
  type ChatCoreChunkHandler,
  type ChatCoreReadyHandler,
  type ChatCoreResult
}

/**
 * 执行一轮完整的 Chat 对话（不含 SSE 传输层）。
 */
export async function chatCore(
  adapter: IAgentAdapter,
  options: ChatCoreOptions,
  onChunk: ChatCoreChunkHandler,
  onReady?: ChatCoreReadyHandler
): Promise<ChatCoreResult> {
  const {
    scope,
    sessionId: id,
    content,
    signal,
    mcpEnabled,
    includeScopeContext,
    systemPreamble,
    workflowEditContext,
    skipMemory = false,
    skipCheckpoint = false,
    skipSummary = false,
    skipPerRoundExtract = false,
    skipNarrativeBatchExtract = false,
    skipSlashCommands = false,
    skipChatStatus = false,
    actor,
    thinking
  } = options

  if (!adapter.chat || !adapter.appendMessage) {
    throw new Error('Agent adapter missing required methods: chat, appendMessage')
  }

  const session = await adapter.getSession?.(scope, id)
  if (!session) {
    throw new Error(`Session ${id} not found`)
  }

  if (options.fileRefPaths?.length) {
    const existing = new Set(session.grantedPaths ?? [])
    let changed = false
    for (const p of options.fileRefPaths) {
      if (!existing.has(p)) {
        existing.add(p)
        changed = true
      }
    }
    if (changed && adapter.updateSession) {
      session.grantedPaths = Array.from(existing)
      await adapter.updateSession(scope, id, { grantedPaths: session.grantedPaths })
    }
  }

  if (
    isWorkflowManagementSession(session) &&
    options.runRefIds?.length &&
    adapter.updateSession
  ) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const toGrant: string[] = []
    for (const runId of options.runRefIds) {
      const run = resumeStore.getRunById(runId)
      if (!run || run.scope !== scope) continue
      toGrant.push(getWorkflowRunWorkspace(scopeRoot, run.workflowName, run.id))
      for (const result of Object.values(run.stepResults)) {
        if (result.sessionId) {
          toGrant.push(getSessionWorkspaceDir(scopeRoot, result.sessionId))
        }
      }
    }
    if (toGrant.length > 0) {
      const existing = new Set(session.grantedPaths ?? [])
      let changed = false
      for (const p of toGrant) {
        if (!existing.has(p)) {
          existing.add(p)
          changed = true
        }
      }
      if (changed) {
        session.grantedPaths = Array.from(existing)
        await adapter.updateSession(scope, id, { grantedPaths: session.grantedPaths })
      }
    }
  }

  const agentSettings = getAgentLLMSettings()
  const model =
    typeof options.model === 'string' && options.model.trim()
      ? options.model.trim()
      : agentSettings.defaultModel?.trim() || undefined
  const ctxWin = getContextWindowSettings()

  // ---- Checkpoint ----
  let turnCheckpoint: ReturnType<typeof createCheckpoint> | null = null
  if (!skipCheckpoint) {
    const checkpointMessageIndex = session.messages.length
    turnCheckpoint = createCheckpoint(id, checkpointMessageIndex, content.trim())
    initSnapshotCollector(id)
  }

  await adapter.appendMessage(scope, id, {
    role: 'user',
    parts: [{ type: 'text', content: content.trim() }]
  })

  if (turnCheckpoint) {
    const scopeData = scopeStore.getScopeData(scope)
    const liveSession = scopeData.agentSessions.find((s) => s.id === id)
    if (liveSession) {
      if (!liveSession.checkpoints) liveSession.checkpoints = []
      liveSession.checkpoints.push(turnCheckpoint)
      scopeStore.saveScope(scope)
    }
  }

  if (!skipSummary) {
    scheduleTurnSummary(scope, id, content.trim())
  }

  // Slash 命令处理
  let promptInjection: string | null = null
  let commandAllowedTools: string[] | undefined
  if (!skipSlashCommands && content.trim().startsWith('/')) {
    const cmdResult = await tryRunSlashCommand(scope, id, content.trim(), {
      allowedSkills: session.allowedSkills
    })
    if (cmdResult != null) {
      if (cmdResult.mode === 'prompt') {
        promptInjection = cmdResult.text
        commandAllowedTools = cmdResult.allowedTools
      } else {
        await adapter.appendMessage(scope, id, {
          role: 'system',
          parts: [{ type: 'text', content: cmdResult.text }]
        })

        // action 模式无 LLM 调用，直接完成 checkpoint（无文件变更）
        if (turnCheckpoint) {
          const completedCp = completeCheckpoint(turnCheckpoint, [])
          const cpScopeData = scopeStore.getScopeData(scope)
          const cpSession = cpScopeData.agentSessions.find((s) => s.id === id)
          if (cpSession?.checkpoints) {
            const cpIdx = cpSession.checkpoints.findIndex((cp) => cp.id === turnCheckpoint!.id)
            if (cpIdx >= 0) {
              cpSession.checkpoints[cpIdx] = completedCp
              scopeStore.saveScope(scope)
            }
          }
        }

        return {
          appendedMsg: {
            id: '',
            role: 'system',
            parts: [{ type: 'text', content: cmdResult.text }],
            createdAt: Date.now()
          },
          parts: [],
          reasoning: '',
          memoryRefs: {
            injected: { user: [], scope: [], session: [] },
            created: { user: [], scope: [], session: [] }
          },
          injectedMemories: null,
          stopped: false,
          commandResult: cmdResult.text
        }
      }
    }
  }

  // A/B 滑动窗口
  const fullContextTurns = Math.max(1, options.fullContextTurns ?? ctxWin.fullContextTurns ?? 4)
  const cachedContextTurns = Math.max(
    1,
    options.cachedContextTurns ?? ctxWin.cachedContextTurns ?? 3
  )

  const chatMessages = session.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const completeRounds = chatMessages.filter((m) => m.role === 'assistant').length
  let compressedThrough = session.compressedThroughRound ?? 0

  const uncompressedRounds = completeRounds - compressedThrough
  const shouldCompress = uncompressedRounds >= fullContextTurns + cachedContextTurns

  // 压缩摘要链（append-only，用于 API 前缀缓存优化）
  let compressionSummaries = session.compressionSummaries ? [...session.compressionSummaries] : []

  if (shouldCompress && adapter.updateSession && !skipNarrativeBatchExtract) {
    const toCompress = cachedContextTurns
    const startIdx = 2 * compressedThrough
    const endIdx = 2 * (compressedThrough + toCompress)
    const slice = chatMessages.slice(startIdx, endIdx)
    if (slice.length >= 2) {
      try {
        await addSessionMemoryFromRounds(
          slice.map((m) => ({ role: m.role, content: getTextContent(m) })),
          scope,
          id
        )
        const newThrough = compressedThrough + toCompress
        const summaryText = buildCompressionSummary(slice, compressedThrough + 1, newThrough)
        compressionSummaries.push({ throughRound: newThrough, text: summaryText })
        compressionSummaries = capSummaryChain(compressionSummaries)
        compressedThrough = newThrough
        await adapter.updateSession(scope, id, {
          compressedThroughRound: compressedThrough,
          compressionSummaries
        })
        emit('agent:session.compressing', { scope, sessionId: id, rounds: slice }).catch(() => {})
      } catch (e) {
        log.warn('Session memory compression failed:', e)
      }
    }
  } else if (shouldCompress && adapter.updateSession && skipNarrativeBatchExtract) {
    const toCompress = cachedContextTurns
    const startIdx = 2 * compressedThrough
    const endIdx = 2 * (compressedThrough + toCompress)
    const slice = chatMessages.slice(startIdx, endIdx)
    const newThrough = compressedThrough + toCompress
    const summaryText = buildCompressionSummary(slice, compressedThrough + 1, newThrough)
    compressionSummaries.push({ throughRound: newThrough, text: summaryText })
    compressionSummaries = capSummaryChain(compressionSummaries)
    compressedThrough = newThrough
    try {
      await adapter.updateSession(scope, id, {
        compressedThroughRound: compressedThrough,
        compressionSummaries
      })
      emit('agent:session.compressing', {
        scope,
        sessionId: id,
        rounds: slice
      }).catch(() => {})
    } catch (e) {
      log.warn('Session memory compression (skip P2) failed:', e)
    }
  }

  // 构建消息历史（对话轮次 + 压缩摘要链）
  // 排列：[压缩摘要链] → [未压缩 user/assistant 轮次] → [当前用户消息]
  const currentUserMsg = { role: 'user' as const, content: content.trim() }
  let history: Array<{ role: string; content: string }>

  const withTools = { includeToolSummary: true }

  // 压缩摘要链注入为 system 消息（只追加不修改，形成稳定缓存前缀）
  const summaryMessages: Array<{ role: string; content: string }> = compressionSummaries.map(
    (s) => ({ role: 'system', content: `[对话回顾 R1-${s.throughRound}]\n${s.text}` })
  )

  if (completeRounds < fullContextTurns + cachedContextTurns) {
    history = [
      ...summaryMessages,
      ...session.messages.map((m) => ({ role: m.role, content: getMessageContent(m, withTools) })),
      currentUserMsg
    ]
  } else {
    const systemMsgs = session.messages.filter((m) => m.role === 'system')
    const systemPrefix =
      systemMsgs.length > 0
        ? systemMsgs.map((m) => ({ role: m.role, content: getTextContent(m) }))
        : []
    const cacheRaw = chatMessages
      .slice(2 * compressedThrough)
      .map((m) => ({ role: m.role, content: getMessageContent(m, withTools) }))
    history = [...summaryMessages, ...systemPrefix, ...cacheRaw, currentUserMsg]
  }

  // ---- 记忆注入（返回文本，不修改 history） ----
  const memInjectPolicy =
    session.bgMeta?.memoryInjectPolicy ?? session.bgMeta?.inlineAgentDef?.memoryInjectPolicy
  const isFirstMessage = session.messages.length === 0

  const {
    injectedMemories: injectedMemoriesForClient,
    injectedIds,
    memorySystemTexts
  } = await injectMemories({
    scope,
    sessionId: id,
    content,
    compressedThrough,
    isFirstMessage,
    skipMemory,
    memInjectPolicy
  })

  // 会话级允许列表（BG 来自 inlineAgentDef，交互会话来自 session 自身）；空/未设置 = 全选
  const sessionAllowedTools =
    session.bgMeta?.inlineAgentDef?.allowedTools ?? session.allowedTools
  const sessionAllowedSkills =
    session.bgMeta?.inlineAgentDef?.allowedSkills ?? session.allowedSkills
  const sessionAllowedMcpServerIds =
    session.bgMeta?.inlineAgentDef?.allowedMcpServerIds ?? session.allowedMcpServerIds
  const resolvedThinking =
    session.bgMeta?.inlineAgentDef?.thinking ?? thinking

  // 渐进式发现：默认仅注入技能元数据，模型按需用 prizm_get_skill_instructions 拉取全文；设 PRIZM_PROGRESSIVE_SKILL_DISCOVERY=0 恢复旧行为（一次性注入全文）
  const useProgressiveSkillDiscovery = process.env.PRIZM_PROGRESSIVE_SKILL_DISCOVERY !== '0'
  const skillMetadataForDiscovery =
    useProgressiveSkillDiscovery ?
      getSkillsMetadataForDiscovery(scope, sessionAllowedSkills)
    : undefined
  const activeSkillInstructions =
    useProgressiveSkillDiscovery
      ? undefined
      : getSkillsToInject(scope, sessionAllowedSkills)
  const activeSkillInstructionsOrUndefined =
    activeSkillInstructions && activeSkillInstructions.length > 0 ? activeSkillInstructions : undefined
  const skillMetadataForDiscoveryOrUndefined =
    skillMetadataForDiscovery && skillMetadataForDiscovery.length > 0
      ? skillMetadataForDiscovery
      : undefined

  // 技能路径自动授权：本会话允许的技能目录加入 grantedPaths，便于 prizm_file 访问 scripts/references/assets
  const allMeta = loadAllSkillMetadata()
  const enabledMeta = allMeta.filter((s) => s.enabled)
  const allowedSkillNames =
    !sessionAllowedSkills || sessionAllowedSkills.length === 0
      ? new Set(enabledMeta.map((s) => s.name))
      : new Set(sessionAllowedSkills)
  const skillPathsToGrant = enabledMeta
    .filter((s) => allowedSkillNames.has(s.name))
    .map((s) => s.path)
  if (skillPathsToGrant.length > 0 && adapter.updateSession) {
    const existing = new Set(session.grantedPaths ?? [])
    let changed = false
    for (const p of skillPathsToGrant) {
      if (!existing.has(p)) {
        existing.add(p)
        changed = true
      }
    }
    if (changed) {
      session.grantedPaths = Array.from(existing)
      await adapter.updateSession(scope, id, { grantedPaths: session.grantedPaths })
    }
  }

  let finalAllowedTools: string[] | undefined
  if (commandAllowedTools != null) {
    if (sessionAllowedTools?.length) {
      const sessionSet = new Set(sessionAllowedTools)
      finalAllowedTools = commandAllowedTools.filter((t) => sessionSet.has(t))
    } else {
      finalAllowedTools = commandAllowedTools
    }
  } else {
    finalAllowedTools = sessionAllowedTools
  }

  let rulesContent: string | undefined
  try {
    rulesContent = loadRules() || undefined
  } catch (rulesErr) {
    log.warn('Rules loading failed:', rulesErr)
  }

  let customRulesContent: string | undefined
  try {
    customRulesContent = loadActiveRules(scope) || undefined
  } catch (customRulesErr) {
    log.warn('Custom rules loading failed:', customRulesErr)
  }

  const key = chatKey(scope, id)
  activeChats.get(key)?.abort()
  const ac = new AbortController()
  activeChats.set(key, ac)
  if (signal) {
    signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  if (!skipChatStatus) {
    setSessionChatStatus(scope, id, 'chatting', actor)
  }

  onReady?.({
    injectedMemories: injectedMemoriesForClient
  })

  // ---- 流式调用 + 持久化 ----
  let fullReasoning = ''
  let segmentContent = ''
  const parts: MessagePart[] = []

  function flushSegment(): void {
    if (segmentContent) {
      parts.push({ type: 'text', content: segmentContent })
      segmentContent = ''
    }
  }

  let lastUsage: ChatCoreResult['usage']
  let chatCompletedAt = 0
  let doneFired = false
  let stopped = false

  async function persistAndFinalize(isStopped: boolean): Promise<AgentMessage> {
    flushSegment()
    chatCompletedAt = Date.now()
    stopped = isStopped
    const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
    const appendedMsg = await adapter.appendMessage!(scope, id, {
      role: 'assistant',
      parts: [...parts],
      model: usedModel,
      usage: lastUsage,
      ...(fullReasoning && { reasoning: fullReasoning })
    })
    const fullContent = getTextContent({ parts })
    let createdByLayer: MemoryIdsByLayer | null = null
    const memEnabled = isMemoryEnabled()
    memLog('conv_memory:chat_trigger', {
      scope,
      sessionId: id,
      detail: {
        memoryEnabled: memEnabled,
        hasFullContent: !!fullContent,
        userContentLen: content.trim().length,
        assistantContentLen: fullContent?.length ?? 0,
        messageId: appendedMsg.id
      }
    })
    if (memEnabled && fullContent && !skipPerRoundExtract) {
      try {
        createdByLayer = await addMemoryInteraction(
          [
            { role: 'user', content: content.trim() },
            { role: 'assistant', content: fullContent }
          ],
          scope,
          id,
          appendedMsg.id
        )
        memLog('conv_memory:chat_trigger', {
          scope,
          sessionId: id,
          detail: {
            phase: 'result',
            createdByLayer: createdByLayer
              ? {
                  user: createdByLayer.user.length,
                  scope: createdByLayer.scope.length,
                  session: createdByLayer.session.length
                }
              : null
          }
        })
      } catch (e) {
        memLog('conv_memory:flush_error', {
          scope,
          sessionId: id,
          detail: { phase: 'chat_addMemoryInteraction' },
          error: e
        })
        log.warn('Memory storage failed:', e)
      }
    }
    const memRefs: MemoryRefs = {
      injected: injectedIds,
      created: createdByLayer ?? { user: [], scope: [], session: [] }
    }
    const hasRefs =
      memRefs.injected.user.length +
        memRefs.injected.scope.length +
        memRefs.injected.session.length +
        memRefs.created.user.length +
        memRefs.created.scope.length +
        memRefs.created.session.length >
      0
    if (hasRefs) {
      persistMemoryRefs(scope, id, appendedMsg.id, memRefs)
    }

    if (turnCheckpoint) {
      try {
        const toolParts = parts.filter((p): p is MessagePartTool => p.type === 'tool')
        const fileChanges = extractFileChangesFromMessages([
          {
            parts: toolParts.map((p) => ({
              type: p.type,
              name: p.name,
              arguments: p.arguments,
              result: p.result,
              isError: p.isError
            }))
          }
        ])
        const completedCp = completeCheckpoint(turnCheckpoint, fileChanges)
        const snapshots = flushSnapshotCollector(id)
        const scopeRootForCp = scopeStore.getScopeRootPath(scope)
        saveFileSnapshots(scopeRootForCp, id, turnCheckpoint.id, snapshots)

        const cpScopeData = scopeStore.getScopeData(scope)
        const cpSession = cpScopeData.agentSessions.find((s) => s.id === id)
        if (cpSession?.checkpoints) {
          const cpIdx = cpSession.checkpoints.findIndex((cp) => cp.id === turnCheckpoint!.id)
          if (cpIdx >= 0) {
            cpSession.checkpoints[cpIdx] = completedCp
            scopeStore.saveScope(scope)
          }
        }
      } catch (cpErr) {
        log.warn('Failed to complete checkpoint:', cpErr)
      }
    }

    emit('agent:message.completed', {
      scope,
      sessionId: id,
      messages: [
        {
          id: '',
          role: 'user',
          parts: [{ type: 'text', content: content.trim() }],
          createdAt: Date.now()
        },
        appendedMsg
      ],
      roundMessageId: appendedMsg.id,
      actor: actor ?? { type: 'system', source: 'chatCore' }
    }).catch(() => {})

    return appendedMsg
  }

  let appendedMsg: AgentMessage | null = null

  const budget = createContextBudget()
  const historyText = history.map((m) => m.content).join('\n')
  budget.register(
    BUDGET_AREAS.CONVERSATION_HISTORY,
    historyText,
    TRIM_PRIORITIES.CONVERSATION_HISTORY
  )
  const budgetSnapshot = budget.trim()
  if (budgetSnapshot.trimmed) {
    log.info('Context budget trimmed: %s', JSON.stringify(budgetSnapshot.trimDetails))
  }

  try {
    for await (const chunk of adapter.chat(scope, id, history, {
      model,
      signal: ac.signal,
      mcpEnabled: mcpEnabled !== false,
      includeScopeContext: includeScopeContext !== false,
      skillMetadataForDiscovery: skillMetadataForDiscoveryOrUndefined,
      activeSkillInstructions: activeSkillInstructionsOrUndefined,
      rulesContent,
      customRulesContent,
      grantedPaths: session.grantedPaths,
      allowedTools: finalAllowedTools,
      allowedMcpServerIds: sessionAllowedMcpServerIds,
      thinking: resolvedThinking,
      memoryTexts: memorySystemTexts.length > 0 ? memorySystemTexts : undefined,
      systemPreamble: systemPreamble || undefined,
      promptInjection: promptInjection ? `[命令指令]\n${promptInjection}` : undefined,
      workflowEditContext: workflowEditContext ?? undefined
    })) {
      if (ac.signal.aborted) break
      if (chunk.usage) lastUsage = chunk.usage
      if (chunk.text) segmentContent += chunk.text
      if (chunk.reasoning) fullReasoning += chunk.reasoning
      if (chunk.toolCallArgsDelta) {
        const existing = parts.find(
          (p) => p.type === 'tool' && p.id === chunk.toolCallArgsDelta!.id
        )
        if (existing && existing.type === 'tool') {
          ;(existing as MessagePartTool).arguments = chunk.toolCallArgsDelta.argumentsSoFar
        }
      }
      if (chunk.toolResultChunk) flushSegment()
      if (chunk.toolCall) {
        flushSegment()
        const tc = chunk.toolCall
        const toolPart: MessagePartTool = {
          type: 'tool',
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
          ...(tc.isError && { isError: true }),
          ...(tc.status && { status: tc.status })
        }
        const existingIdx = parts.findIndex((p) => p.type === 'tool' && p.id === tc.id)
        if (existingIdx >= 0) {
          parts[existingIdx] = toolPart
        } else {
          parts.push(toolPart)
        }
      }
      if (chunk.done) {
        doneFired = true
        appendedMsg = await persistAndFinalize(false)
      }
      onChunk(chunk)
    }

    if (ac.signal.aborted && !doneFired && (segmentContent || parts.length > 0)) {
      appendedMsg = await persistAndFinalize(true)
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (!isAbort) {
      log.error('chatCore stream error:', err)
      throw err
    }
    if (!doneFired && (segmentContent || parts.length > 0)) {
      appendedMsg = await persistAndFinalize(true)
    }
  } finally {
    if (!skipChatStatus) {
      setSessionChatStatus(scope, id, 'idle', actor)
    }
    const usedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined
    if (lastUsage) {
      const chatCategory = deriveChatCategory(actor, session)
      recordTokenUsage(chatCategory, scope, lastUsage, usedModel ?? getLLMProviderName(), id)
    }
    if (chatCompletedAt && lastUsage) {
      const toolCallParts = parts.filter((p): p is MessagePartTool => p.type === 'tool')
      if (toolCallParts.length > 0) {
        try {
          const activities = deriveScopeActivities(toolCallParts, chatCompletedAt)
          if (activities.length > 0) {
            const scopeRoot = scopeStore.getScopeRootPath(scope)
            appendSessionActivities(scopeRoot, id, activities)
          }
        } catch (e) {
          log.warn('Failed to write session activities:', id, e)
        }
      }
    }
    activeChats.delete(key)
  }

  if (!appendedMsg) {
    flushSegment()
    appendedMsg = {
      id: '',
      role: 'assistant',
      parts: [...parts],
      createdAt: Date.now()
    }
  }

  const memRefs: MemoryRefs = {
    injected: injectedIds,
    created: appendedMsg.memoryRefs?.created ?? { user: [], scope: [], session: [] }
  }

  return {
    appendedMsg,
    parts,
    reasoning: fullReasoning,
    usage: lastUsage,
    memoryRefs: memRefs,
    injectedMemories: injectedMemoriesForClient,
    stopped
  }
}

const SUMMARY_MAX_CHARS_PER_MSG = 80
const SUMMARY_CHAIN_MAX_SEGMENTS = 4

/**
 * 从被压缩的轮次中提取简短摘要文本。
 * 采用提取式摘要（无需 LLM 调用），截取每条消息的前 80 字符。
 */
function buildCompressionSummary(
  roundMessages: import('@prizm/shared').AgentMessage[],
  fromRound: number,
  toRound: number
): string {
  const lines: string[] = []
  let roundIdx = fromRound
  for (let i = 0; i < roundMessages.length; i += 2) {
    const userMsg = roundMessages[i]
    const assistantMsg = roundMessages[i + 1]
    const userText = getTextContent(userMsg)?.slice(0, SUMMARY_MAX_CHARS_PER_MSG) ?? ''
    const asstText = assistantMsg
      ? (getTextContent(assistantMsg)?.slice(0, SUMMARY_MAX_CHARS_PER_MSG) ?? '')
      : ''
    lines.push(
      `R${roundIdx}: ${userText}${userText.length >= SUMMARY_MAX_CHARS_PER_MSG ? '…' : ''} → ${asstText}${asstText.length >= SUMMARY_MAX_CHARS_PER_MSG ? '…' : ''}`
    )
    roundIdx++
  }
  return lines.join('\n')
}

/**
 * 封顶策略：最多保留 SUMMARY_CHAIN_MAX_SEGMENTS 段摘要。
 * 超出时合并最老的两段为一段。
 */
function capSummaryChain(
  summaries: Array<{ throughRound: number; text: string }>
): Array<{ throughRound: number; text: string }> {
  while (summaries.length > SUMMARY_CHAIN_MAX_SEGMENTS) {
    const [a, b, ...rest] = summaries
    const merged = {
      throughRound: b.throughRound,
      text: a.text + '\n' + b.text
    }
    summaries = [merged, ...rest]
  }
  return summaries
}

/**
 * 根据 actor 和 session 上下文推导 chat token 使用的子类别。
 */
function deriveChatCategory(actor?: OperationActor, session?: AgentSession): TokenUsageCategory {
  if (actor?.source?.includes('guard') || actor?.source?.includes('schema-retry')) {
    return 'chat:guard'
  }
  if (session && isWorkflowManagementSession(session)) return CHAT_CATEGORY_WORKFLOW_MANAGEMENT
  if (session?.kind === 'background' && session.bgMeta) {
    if (session.bgMeta.source === 'workflow') return 'chat:workflow'
    if (session.bgMeta.source === 'task') return 'chat:task'
    if (session.bgMeta.triggerType === 'cron') return 'chat:task'
    // 未能识别 source 的后台 session，归为"后台系统"而非误报为"任务"
    return 'chat:background'
  }
  return 'chat:user'
}
