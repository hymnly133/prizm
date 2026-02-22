/**
 * Prizm Server 默认 Agent 适配器（LLM 流式对话 + 工具调用）
 */

import { createLogger } from '../../logger'
import type {
  IAgentAdapter,
  LLMStreamChunk,
  LLMTool,
  LLMChatMessage,
  LLMMessageContentPart
} from '../interfaces'
import type { AgentSession, AgentMessage } from '../../types'
import type { SessionIOConfig } from '@prizm/shared'
import { scopeStore } from '../../core/ScopeStore'
import { genUniqueId } from '../../id'
import { deleteMemoriesByGroupId } from '../../llm/EverMemService'
import { getProviderForModel, getModelDisplayName } from '../../llm'
import { getMcpClientManager } from '../../mcp-client/McpClientManager'
import {
  getTavilySettings,
  getToolGroupConfig,
  getDynamicContextMode,
  getAgentLLMSettings
} from '../../settings/agentToolsStore'
import { filterToolsByGroups } from '../../llm/builtinTools/toolGroups'
import {
  resolveScenario,
  buildPromptContext,
  buildPromptForScenario
} from '../../llm/promptPipeline'
import { processMessageAtRefs } from '../../llm/atReferenceParser'
import { registerBuiltinAtReferences } from '../../llm/atReferenceRegistry'
import { getBuiltinTools } from '../../llm/builtinTools'
import { clearSessionGuides } from '../../llm/toolInstructions'
import { logLLMCall, buildMessagesSummary, formatUsage } from '../../llm/llmCallLogger'
import { TOOL_RESULT_STREAM_THRESHOLD, TOOL_RESULT_CHUNK_SIZE } from './chatHelpers'
import { executeToolCalls, handleInteractions, type ToolExecContext } from './toolExecution'
import { filterWorkflowBuilderForSession, isWorkflowManagementSession } from './sessionToolFilter'
import {
  WORKFLOW_MANAGEMENT_CREATE_DEF,
  WORKFLOW_MANAGEMENT_UPDATE_DEF
} from '../../llm/toolLLM/workflowSubmitTool'

const log = createLogger('Adapter')

export class DefaultAgentAdapter implements IAgentAdapter {
  async listSessions(scope: string): Promise<AgentSession[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.agentSessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getSession(scope: string, id: string): Promise<AgentSession | null> {
    const data = scopeStore.getScopeData(scope)
    return data.agentSessions.find((s) => s.id === id) ?? null
  }

  async createSession(scope: string): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const session: AgentSession = {
      id: genUniqueId(),
      scope,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    data.agentSessions.push(session)
    scopeStore.saveScope(scope)
    log.info('Agent session created:', session.id, 'scope:', scope)
    return session
  }

  async deleteSession(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.agentSessions.findIndex((s) => s.id === id)
    if (idx >= 0) {
      data.agentSessions.splice(idx, 1)
      scopeStore.saveScope(scope)
      scopeStore.deleteSessionDir(scope, id)
      clearSessionGuides(id)
      try {
        await deleteMemoriesByGroupId(`${scope}:session:${id}`)
      } catch (e) {
        log.warn('Failed to delete session memories:', id, e)
      }
      log.info('Agent session deleted:', id, 'scope:', scope)
    }
  }

  async updateSession(
    scope: string,
    id: string,
    update: {
      llmSummary?: string
      compressedThroughRound?: number
      compressionSummaries?: Array<{ throughRound: number; text: string }>
      grantedPaths?: string[]
      allowedTools?: string[]
      allowedSkills?: string[]
      allowedMcpServerIds?: string[]
      kind?: AgentSession['kind']
      toolMeta?: AgentSession['toolMeta']
      bgMeta?: AgentSession['bgMeta']
      bgStatus?: AgentSession['bgStatus']
      bgResult?: string
      bgStructuredData?: string
      bgArtifacts?: string[]
      startedAt?: number
      finishedAt?: number
    }
  ): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === id)
    if (!session) throw new Error(`Session not found: ${id}`)

    if (update.llmSummary !== undefined) session.llmSummary = update.llmSummary
    if (update.compressedThroughRound !== undefined)
      session.compressedThroughRound = update.compressedThroughRound
    if (update.compressionSummaries !== undefined)
      session.compressionSummaries = update.compressionSummaries
    if (update.grantedPaths !== undefined) session.grantedPaths = update.grantedPaths
    if (update.allowedTools !== undefined) session.allowedTools = update.allowedTools
    if (update.allowedSkills !== undefined) session.allowedSkills = update.allowedSkills
    if (update.allowedMcpServerIds !== undefined)
      session.allowedMcpServerIds = update.allowedMcpServerIds
    if (update.kind !== undefined) session.kind = update.kind
    if (update.toolMeta !== undefined) session.toolMeta = update.toolMeta
    if (update.bgMeta !== undefined) session.bgMeta = update.bgMeta
    if (update.bgStatus !== undefined) session.bgStatus = update.bgStatus
    if (update.bgResult !== undefined) session.bgResult = update.bgResult
    if (update.bgStructuredData !== undefined) session.bgStructuredData = update.bgStructuredData
    if (update.bgArtifacts !== undefined) session.bgArtifacts = update.bgArtifacts
    if (update.startedAt !== undefined) session.startedAt = update.startedAt
    if (update.finishedAt !== undefined) session.finishedAt = update.finishedAt

    session.updatedAt = Date.now()
    scopeStore.saveScope(scope)
    log.info('Agent session updated:', id, 'scope:', scope)
    return { ...session }
  }

  async appendMessage(
    scope: string,
    sessionId: string,
    message: Omit<AgentMessage, 'id' | 'createdAt'>
  ): Promise<AgentMessage> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const now = Date.now()
    const msg: AgentMessage = {
      id: genUniqueId(),
      ...message,
      createdAt: now
    }
    session.messages.push(msg)
    session.updatedAt = now
    scopeStore.saveScope(scope)
    log.info('Agent message appended:', msg.id, 'session:', sessionId)
    return msg
  }

  async getMessages(scope: string, sessionId: string): Promise<AgentMessage[]> {
    const session = await this.getSession(scope, sessionId)
    return session ? [...session.messages] : []
  }

  async truncateMessages(
    scope: string,
    sessionId: string,
    messageIndex: number
  ): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const clampedIndex = Math.max(0, Math.min(messageIndex, session.messages.length))
    session.messages = session.messages.slice(0, clampedIndex)

    if (session.checkpoints) {
      session.checkpoints = session.checkpoints.filter((cp) => cp.messageIndex < clampedIndex)
    }

    session.updatedAt = Date.now()
    scopeStore.saveScope(scope)
    log.info(
      'Session truncated: %s to messageIndex=%d (remaining=%d)',
      sessionId,
      clampedIndex,
      session.messages.length
    )
    return { ...session }
  }

  async forkSession(
    scope: string,
    sourceSessionId: string,
    checkpointId?: string
  ): Promise<AgentSession> {
    const data = scopeStore.getScopeData(scope)
    const source = data.agentSessions.find((s) => s.id === sourceSessionId)
    if (!source) throw new Error(`Source session not found: ${sourceSessionId}`)

    let messageLimit = source.messages.length
    if (checkpointId && source.checkpoints) {
      const cp = source.checkpoints.find((c) => c.id === checkpointId)
      if (cp) messageLimit = cp.messageIndex
    }

    const now = Date.now()
    const forkedSession: AgentSession = {
      id: genUniqueId(),
      scope,
      messages: source.messages.slice(0, messageLimit).map((m) => ({
        ...m,
        id: genUniqueId(),
        createdAt: now
      })),
      llmSummary: source.llmSummary,
      grantedPaths: source.grantedPaths ? [...source.grantedPaths] : undefined,
      createdAt: now,
      updatedAt: now
    }

    data.agentSessions.push(forkedSession)
    scopeStore.saveScope(scope)
    log.info(
      'Session forked: %s -> %s (messages: %d, checkpoint: %s)',
      sourceSessionId,
      forkedSession.id,
      messageLimit,
      checkpointId ?? 'all'
    )
    return forkedSession
  }

  async *chat(
    scope: string,
    sessionId: string,
    messages: LLMChatMessage[],
    options?: {
      model?: string
      signal?: AbortSignal
      mcpEnabled?: boolean
      includeScopeContext?: boolean
      skillMetadataForDiscovery?: Array<{ name: string; description: string }>
      activeSkillInstructions?: Array<{ name: string; instructions: string }>
      rulesContent?: string
      customRulesContent?: string
      grantedPaths?: string[]
      allowedTools?: string[]
      allowedMcpServerIds?: string[]
      thinking?: boolean
      memoryTexts?: string[]
      systemPreamble?: string
      promptInjection?: string
      workflowEditContext?: string
      /** 当前请求的客户端 ID（用于浏览器 Relay 与 Electron provider 匹配） */
      clientId?: string
    }
  ): AsyncIterable<LLMStreamChunk> {
    const defaultModel = getAgentLLMSettings().defaultModel
    const modelStr = options?.model ?? defaultModel
    const resolved = getProviderForModel(modelStr)
    if (!resolved) {
      yield {
        text: '（请先在设置中添加并配置至少一个 LLM 提供商，并选择默认模型）'
      }
      yield { done: true }
      return
    }
    const { provider, config, modelId } = resolved
    const mcpEnabled = options?.mcpEnabled !== false
    const includeScopeContext = options?.includeScopeContext !== false

    registerBuiltinAtReferences()

    const sessionData = scopeStore.getScopeData(scope).agentSessions.find((s) => s.id === sessionId)
    const session = sessionData ?? null
    const scenario = resolveScenario(scope, sessionId, session)
    const ctx = buildPromptContext({
      scope,
      sessionId,
      session,
      includeScopeContext,
      rulesContent: options?.rulesContent,
      customRulesContent: options?.customRulesContent,
      skillMetadataForDiscovery: options?.skillMetadataForDiscovery,
      activeSkillInstructions: options?.activeSkillInstructions,
      memoryTexts: options?.memoryTexts,
      promptInjection: options?.promptInjection,
      grantedPaths: options?.grantedPaths,
      callerPreamble: options?.systemPreamble,
      workflowEditContext: options?.workflowEditContext
    })
    const { sessionStatic, perTurnDynamic } = await buildPromptForScenario(scenario, ctx)

    // Cache-optimized message ordering (arXiv:2601.06007):
    // [0]     system: SESSION-STATIC (stable prefix, ~2000-3500 tokens)
    // [1..n]  conversation history (incremental growth)
    // [n+1]   system: PER-TURN DYNAMIC (workspace_context, locks, memories, @refs)
    // [n+2]   user: current message

    const staticContent = sessionStatic

    const baseMessages: LLMChatMessage[] = [{ role: 'system', content: staticContent }]

    const dynamicMode = getDynamicContextMode()

    const collectDynamic = (injectedPrefix?: string): string[] => {
      const parts: string[] = []
      if (perTurnDynamic) parts.push(perTurnDynamic)
      if (injectedPrefix) parts.push(injectedPrefix)
      return parts
    }

    function getTextFromUserContent(content: string | LLMMessageContentPart[]): string {
      if (typeof content === 'string') return content
      return content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
    }

    if (messages.length > 0) {
      const last = messages[messages.length - 1]
      const rest = messages.slice(0, -1)
      if (last.role === 'user' && (typeof last.content === 'string' || Array.isArray(last.content))) {
        const lastText = getTextFromUserContent(last.content)
        const fileRefPaths = options?.grantedPaths
        const { injectedPrefix, message } = await processMessageAtRefs(
          scope,
          sessionId,
          lastText,
          { fileRefPaths, grantedPaths: options?.grantedPaths }
        )

        baseMessages.push(...rest)
        const dynamicParts = collectDynamic(injectedPrefix)

        if (dynamicMode === 'user_prefix' && dynamicParts.length > 0) {
          const prefix = '<context>\n' + dynamicParts.join('\n\n') + '\n</context>\n\n'
          if (typeof last.content === 'string') {
            baseMessages.push({ role: 'user', content: prefix + message })
          } else {
            const newParts: LLMMessageContentPart[] = [
              { type: 'text', text: prefix + message },
              ...last.content.filter((p): p is { type: 'image'; image: string; mimeType?: string } => p.type === 'image')
            ]
            baseMessages.push({ role: 'user', content: newParts })
          }
        } else {
          if (dynamicParts.length > 0) {
            baseMessages.push({ role: 'system', content: dynamicParts.join('\n\n') })
          }
          if (typeof last.content === 'string') {
            baseMessages.push({ role: 'user', content: message })
          } else {
            const newParts: LLMMessageContentPart[] = [
              { type: 'text', text: message },
              ...last.content.filter((p): p is { type: 'image'; image: string; mimeType?: string } => p.type === 'image')
            ]
            baseMessages.push({ role: 'user', content: newParts })
          }
        }
      } else {
        baseMessages.push(...messages)
        const dynamicParts = collectDynamic()
        if (dynamicParts.length > 0) {
          const lastMsg = baseMessages.pop()!
          baseMessages.push({ role: 'system', content: dynamicParts.join('\n\n') })
          baseMessages.push(lastMsg)
        }
      }
    } else {
      const dynamicParts = collectDynamic()
      if (dynamicParts.length > 0) {
        baseMessages.push({ role: 'system', content: dynamicParts.join('\n\n') })
      }
    }

    let llmTools: LLMTool[] = getBuiltinTools()

    // 按分组配置过滤工具（全局配置 + 会话级覆盖）
    const globalGroupConfig = getToolGroupConfig()
    const sessionToolGroups = sessionData?.bgMeta?.toolGroups
    const groupConfig = sessionToolGroups
      ? { ...globalGroupConfig, ...sessionToolGroups }
      : globalGroupConfig
    llmTools = filterToolsByGroups(llmTools, groupConfig, sessionData?.kind)

    // prizm_set_result 仅对后台任务会话有意义，交互会话中移除以减少工具噪声
    if (sessionData?.kind !== 'background') {
      llmTools = llmTools.filter((t) => t.function.name !== 'prizm_set_result')
    } else if (sessionData.bgMeta?.ioConfig?.outputParams) {
      const dynamicTool = buildDynamicSetResult(sessionData.bgMeta.ioConfig.outputParams)
      llmTools = llmTools.map((t) => (t.function.name === 'prizm_set_result' ? dynamicTool : t))
    }

    llmTools = filterWorkflowBuilderForSession(llmTools, sessionData)

    if (isWorkflowManagementSession(sessionData)) {
      const boundId =
        (
          sessionData as {
            toolMeta?: { workflowDefId?: string }
            bgMeta?: { workflowDefId?: string }
          }
        ).toolMeta?.workflowDefId ??
        (sessionData as { bgMeta?: { workflowDefId?: string } }).bgMeta?.workflowDefId
      if (boundId) {
        llmTools = [...llmTools, WORKFLOW_MANAGEMENT_UPDATE_DEF]
      } else {
        llmTools = [...llmTools, WORKFLOW_MANAGEMENT_CREATE_DEF]
      }
    }

    if (mcpEnabled) {
      const manager = getMcpClientManager()
      await manager.connectAll()
      let mcpTools = await manager.listAllTools()
      if (options?.allowedMcpServerIds && options.allowedMcpServerIds.length > 0) {
        const allowSet = new Set(options.allowedMcpServerIds)
        mcpTools = mcpTools.filter((t) => allowSet.has(t.serverId))
      }

      const tavilySettings = getTavilySettings()
      const webSearchEnabled =
        tavilySettings &&
        tavilySettings.enabled !== false &&
        (tavilySettings.apiKey?.trim() || process.env.TAVILY_API_KEY?.trim())

      const webSearchTools: LLMTool[] = [
        {
          type: 'function',
          function: {
            name: 'prizm_web_search',
            description:
              '在互联网上搜索实时信息。当需要查询最新新闻、事实、数据、技术文档或任何需要联网获取的信息时使用。',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '搜索关键词或问题' },
                search_depth: {
                  type: 'string',
                  description: '"basic"（快速）或 "advanced"（深度，更多结果）',
                  enum: ['basic', 'advanced']
                },
                max_results: {
                  type: 'number',
                  description: '返回结果数量 (1-10，默认 5)'
                },
                include_domains: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '仅搜索这些域名（如 ["github.com", "stackoverflow.com"]）'
                },
                exclude_domains: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '排除这些域名'
                }
              },
              required: ['query']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'prizm_web_fetch',
            description:
              '抓取指定 URL 的网页内容并提取正文。用于深入阅读搜索结果中的某个页面，获取完整信息。',
            parameters: {
              type: 'object',
              properties: {
                url: { type: 'string', description: '要抓取的网页 URL' },
                max_chars: {
                  type: 'number',
                  description: '最大返回字数（默认 8000）'
                }
              },
              required: ['url']
            }
          }
        }
      ]

      // MCP 工具按 fullName 排序，保证工具数组确定性（缓存友好）
      const sortedMcpTools = [...mcpTools].sort((a, b) => a.fullName.localeCompare(b.fullName))

      llmTools = [
        ...llmTools,
        ...(webSearchEnabled ? webSearchTools : []),
        ...sortedMcpTools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.fullName,
            description: t.description,
            parameters: t.inputSchema
          }
        }))
      ]
    }

    if (options?.allowedTools && options.allowedTools.length > 0) {
      const allowed = new Set(options.allowedTools)
      llmTools = llmTools.filter((t) => allowed.has(t.function.name))
      log.info(
        'Tool isolation active: %d/%d tools allowed for session %s',
        llmTools.length,
        options.allowedTools.length,
        sessionId
      )
    }

    // 工具集 hash 用于 prompt_cache_key 路由
    const toolNames = llmTools.map((t) => t.function.name).join(',')
    const toolsHash = simpleHash(toolNames)
    const promptCacheKey = `prizm:${scope}:${toolsHash}`

    let currentMessages: LLMChatMessage[] = [...baseMessages]
    let lastUsage: LLMStreamChunk['usage'] | undefined
    let chatRoundIdx = 0

    const logCategory =
      sessionData?.kind === 'background' && sessionData.bgMeta
        ? sessionData.bgMeta.source === 'workflow'
          ? 'chat:workflow'
          : 'chat:task'
        : 'chat:user'
    const logModel = `${config.name}:${modelId}`

    while (true) {
      if (options?.signal?.aborted) break

      const roundStartTime = Date.now()

      const stream = provider.chat(currentMessages, {
        model: modelId,
        temperature: 0.7,
        signal: options?.signal,
        tools: llmTools.length > 0 ? llmTools : undefined,
        thinking: options?.thinking,
        promptCacheKey
      })

      let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined
      let assistantContent = ''
      const announcedPreparing = new Set<string>()

      for await (const chunk of stream) {
        if (chunk.text) {
          assistantContent += chunk.text
          yield { text: chunk.text }
        }
        if (chunk.reasoning) yield { reasoning: chunk.reasoning }
        if (chunk.usage) lastUsage = chunk.usage
        if (chunk.toolCallPreparing) {
          log.info(
            '[ToolCall] preparing: id=%s name=%s',
            chunk.toolCallPreparing.id,
            chunk.toolCallPreparing.name
          )
          announcedPreparing.add(chunk.toolCallPreparing.id)
          yield {
            toolCall: {
              type: 'tool',
              id: chunk.toolCallPreparing.id,
              name: chunk.toolCallPreparing.name,
              arguments: '',
              result: '',
              status: 'preparing' as const
            }
          }
        }
        if (chunk.toolCallArgsDelta) {
          yield { toolCallArgsDelta: chunk.toolCallArgsDelta }
        }
        if (chunk.done && chunk.toolCalls?.length) {
          toolCalls = chunk.toolCalls
        }
        if (chunk.done && !chunk.toolCalls?.length) {
          const finalUsage = chunk.usage ?? lastUsage
          logLLMCall({
            ts: new Date().toISOString(),
            category: logCategory,
            sessionId,
            scope,
            model: logModel,
            promptCacheKey,
            messages: buildMessagesSummary(currentMessages),
            toolCount: llmTools.length,
            usage: formatUsage(finalUsage),
            durationMs: Date.now() - roundStartTime
          })
          yield { done: true, usage: finalUsage }
          return
        }
      }

      if (!toolCalls?.length) {
        logLLMCall({
          ts: new Date().toISOString(),
          category: logCategory,
          sessionId,
          scope,
          model: logModel,
          promptCacheKey,
          messages: buildMessagesSummary(currentMessages),
          toolCount: llmTools.length,
          usage: formatUsage(lastUsage),
          durationMs: Date.now() - roundStartTime
        })
        yield { done: true, usage: lastUsage }
        return
      }

      logLLMCall({
        ts: new Date().toISOString(),
        category: logCategory,
        sessionId,
        scope,
        model: logModel,
        promptCacheKey,
        messages: buildMessagesSummary(currentMessages),
        toolCount: llmTools.length,
        usage: formatUsage(lastUsage),
        durationMs: Date.now() - roundStartTime
      })

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant' as const,
          content: assistantContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.arguments }
          }))
        }
      ]

      for (const tc of toolCalls) {
        if (!announcedPreparing.has(tc.id)) {
          log.info('[ToolCall] late preparing (not streamed): id=%s name=%s', tc.id, tc.name)
          announcedPreparing.add(tc.id)
          yield {
            toolCall: {
              type: 'tool',
              id: tc.id,
              name: tc.name,
              arguments: '',
              result: '',
              status: 'preparing' as const
            }
          }
        }
      }

      if (announcedPreparing.size > 0) {
        await new Promise((r) => setTimeout(r, 300))
      }

      for (const tc of toolCalls) {
        log.info(
          '[ToolCall] running: id=%s name=%s args_len=%d',
          tc.id,
          tc.name,
          tc.arguments.length
        )
        yield {
          toolCall: {
            type: 'tool',
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: '',
            status: 'running' as const
          }
        }
      }

      let runtimeGrantedPaths = [...(options?.grantedPaths ?? [])]
      const progressBuffer: LLMStreamChunk[] = []

      const ctx: ToolExecContext = {
        scope,
        sessionId,
        grantedPaths: runtimeGrantedPaths,
        signal: options?.signal,
        clientId: options?.clientId
      }

      const execResults = await executeToolCalls(toolCalls, ctx, progressBuffer, this)

      for (const progress of progressBuffer) {
        yield progress
      }

      const { chunks: interactChunks, updatedGrantedPaths } = await handleInteractions(
        execResults,
        ctx,
        this
      )
      runtimeGrantedPaths = updatedGrantedPaths

      for (const chunk of interactChunks) {
        yield chunk
      }

      for (const { tc, text } of execResults) {
        if (text.length >= TOOL_RESULT_STREAM_THRESHOLD) {
          for (let i = 0; i < text.length; i += TOOL_RESULT_CHUNK_SIZE) {
            yield {
              toolResultChunk: {
                id: tc.id,
                chunk: text.slice(i, i + TOOL_RESULT_CHUNK_SIZE)
              }
            }
          }
        }
        yield {
          toolCall: {
            type: 'tool',
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: text,
            isError: execResults.find((r) => r.tc.id === tc.id)?.isError,
            status: 'done' as const
          }
        }
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: text
        })
      }

      // 后台会话中一旦成功调用 prizm_set_result 即结束对话，避免模型继续回复或重复调用
      const setResultCall = toolCalls.find((tc) => tc.name === 'prizm_set_result')
      const setResultExec = setResultCall
        ? execResults.find((r) => r.tc.id === setResultCall.id)
        : null
      if (sessionData?.kind === 'background' && setResultExec && !setResultExec.isError) {
        yield { done: true, usage: lastUsage }
        return
      }
    }
  }
}

/**
 * 根据 outputParams schema 动态构建 prizm_set_result 工具定义，
 * 使 LLM 输出字段与工作流/任务的期望输出结构精确匹配。
 */
function buildDynamicSetResult(
  outputParams: NonNullable<SessionIOConfig['outputParams']>
): LLMTool {
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {}

  for (const [name, def] of Object.entries(outputParams.schema)) {
    properties[name] = {
      type: def.type ?? 'string',
      ...(def.description ? { description: def.description } : {})
    }
  }

  properties.status = {
    type: 'string',
    description: '结果状态',
    enum: ['success', 'partial', 'failed']
  }

  const required = outputParams.required?.length
    ? [...outputParams.required]
    : Object.keys(outputParams.schema)

  return {
    type: 'function',
    function: {
      name: 'prizm_set_result',
      description: '提交本次任务的执行结果。必须填写所有必需字段。仅在后台任务会话中有效。',
      parameters: {
        type: 'object',
        properties,
        required
      }
    }
  }
}

/** DJB2 hash — fast, deterministic, 8-char hex */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
