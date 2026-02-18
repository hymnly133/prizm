/**
 * Prizm Server 默认 Agent 适配器（LLM 流式对话 + 工具调用）
 */

import { createLogger } from '../logger'
import type { IAgentAdapter, LLMStreamChunk, LLMTool, LLMChatMessage } from './interfaces'
import type { AgentSession, AgentMessage } from '../types'
import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'
import { deleteMemoriesByGroupId } from '../llm/EverMemService'
import { getLLMProvider } from '../llm'
import { getMcpClientManager } from '../mcp-client/McpClientManager'
import { getTavilySettings } from '../settings/agentToolsStore'
import { searchTavily } from '../llm/tavilySearch'
import { buildSystemPrompt } from '../llm/systemPrompt'
import { processMessageAtRefs } from '../llm/atReferenceParser'
import { registerBuiltinAtReferences } from '../llm/atReferenceRegistry'
import {
  getBuiltinTools,
  getBackgroundOnlyTools,
  executeBuiltinTool,
  BUILTIN_TOOL_NAMES
} from '../llm/builtinTools'
import {
  getGuardCategory,
  lookupToolGuide,
  getToolTips,
  isGuideConsulted,
  markGuideConsulted,
  clearSessionGuides
} from '../llm/toolInstructions'
import { OUT_OF_BOUNDS_ERROR_CODE } from '../llm/workspaceResolver'
import { interactManager } from '../llm/interactManager'

const log = createLogger('Adapter')

/** 工具 result 超过此长度时先流式下发 tool_result_chunk，再发完整 tool_call */
const TOOL_RESULT_STREAM_THRESHOLD = 500
const TOOL_RESULT_CHUNK_SIZE = 200

/** 从工具参数中提取涉及的文件路径（用于审批请求） */
function extractPathsFromToolArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = []
  if (typeof args.path === 'string' && args.path.trim()) paths.push(args.path.trim())
  if (typeof args.from === 'string' && args.from.trim()) paths.push(args.from.trim())
  if (typeof args.to === 'string' && args.to.trim()) paths.push(args.to.trim())
  return paths
}

/** 判断是否为瞬态网络错误（可重试） */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('socket hang up') ||
    msg.includes('network timeout')
  )
}

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
      grantedPaths?: string[]
      kind?: AgentSession['kind']
      bgMeta?: AgentSession['bgMeta']
      bgStatus?: AgentSession['bgStatus']
      bgResult?: string
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
    if (update.grantedPaths !== undefined) session.grantedPaths = update.grantedPaths
    if (update.kind !== undefined) session.kind = update.kind
    if (update.bgMeta !== undefined) session.bgMeta = update.bgMeta
    if (update.bgStatus !== undefined) session.bgStatus = update.bgStatus
    if (update.bgResult !== undefined) session.bgResult = update.bgResult
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

  async *chat(
    scope: string,
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string
      signal?: AbortSignal
      mcpEnabled?: boolean
      includeScopeContext?: boolean
      activeSkillInstructions?: Array<{ name: string; instructions: string }>
      rulesContent?: string
      customRulesContent?: string
      grantedPaths?: string[]
    }
  ): AsyncIterable<LLMStreamChunk> {
    const provider = getLLMProvider()
    const mcpEnabled = options?.mcpEnabled !== false
    const includeScopeContext = options?.includeScopeContext !== false

    registerBuiltinAtReferences()
    const systemContent = await buildSystemPrompt({
      scope,
      sessionId,
      includeScopeContext,
      activeSkillInstructions: options?.activeSkillInstructions,
      rulesContent: options?.rulesContent,
      customRulesContent: options?.customRulesContent
    })
    const baseMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemContent }
    ]

    if (messages.length > 0) {
      const last = messages[messages.length - 1]
      const rest = messages.slice(0, -1)
      if (last.role === 'user' && typeof last.content === 'string') {
        const fileRefPaths = options?.grantedPaths
        const { injectedPrefix, message } = await processMessageAtRefs(
          scope,
          sessionId,
          last.content,
          { fileRefPaths, grantedPaths: options?.grantedPaths }
        )
        if (injectedPrefix) {
          baseMessages.push({ role: 'system', content: injectedPrefix })
        }
        baseMessages.push(...rest, { role: 'user', content: message })
      } else {
        baseMessages.push(...messages)
      }
    }

    const session = await this.getSession(scope, sessionId)
    let llmTools: LLMTool[] = getBuiltinTools()
    if (session?.kind === 'background') {
      llmTools = [...llmTools, ...getBackgroundOnlyTools()]
    }
    if (mcpEnabled) {
      const manager = getMcpClientManager()
      await manager.connectAll()
      const mcpTools = await manager.listAllTools()

      const tavilySettings = getTavilySettings()
      const tavilyEnabled =
        tavilySettings &&
        tavilySettings.enabled !== false &&
        (tavilySettings.apiKey?.trim() || process.env.TAVILY_API_KEY?.trim())

      const builtinTavilyTool: LLMTool = {
        type: 'function',
        function: {
          name: 'tavily_web_search',
          description:
            '在互联网上搜索实时信息。当用户询问最新新闻、事实、数据或需要联网查询时使用。',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词或问题' } },
            required: ['query']
          }
        }
      }

      llmTools = [
        ...llmTools,
        ...(tavilyEnabled ? [builtinTavilyTool] : []),
        ...mcpTools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.fullName,
            description: t.description,
            parameters: t.inputSchema
          }
        }))
      ]
    }

    let currentMessages: LLMChatMessage[] = [...baseMessages]
    let lastUsage: LLMStreamChunk['usage'] | undefined

    while (true) {
      if (options?.signal?.aborted) break

      const stream = provider.chat(currentMessages, {
        model: options?.model,
        temperature: 0.7,
        signal: options?.signal,
        tools: llmTools.length > 0 ? llmTools : undefined
      })

      let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined
      let assistantContent = ''
      /** 已经发出 preparing 事件的工具 ID 集合 */
      const announcedPreparing = new Set<string>()

      for await (const chunk of stream) {
        if (chunk.text) {
          assistantContent += chunk.text
          yield { text: chunk.text }
        }
        if (chunk.reasoning) yield { reasoning: chunk.reasoning }
        if (chunk.usage) lastUsage = chunk.usage
        // LLM 流式生成阶段检测到工具名，立即通知客户端显示 preparing 卡片
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
        if (chunk.done && chunk.toolCalls?.length) {
          toolCalls = chunk.toolCalls
        }
        if (chunk.done && !chunk.toolCalls?.length) {
          yield { done: true, usage: chunk.usage ?? lastUsage }
          return
        }
      }

      if (!toolCalls?.length) {
        yield { done: true, usage: lastUsage }
        return
      }

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

      const manager = getMcpClientManager()

      // 对于未曾发出 preparing 的工具，补发 preparing 事件
      // 某些 LLM API 不增量流式 tool_call，直接在 finish_reason 中返回完整工具调用
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

      // 确保 preparing 事件到达客户端并渲染后再发送 running。
      // 当 LLM API 不增量流式 tool_call 时，preparing 和 running 几乎同时产出，
      // 如果不加延迟，二者可能在同一 TCP 包到达客户端被 React 批处理合并。
      // 300ms 足以让客户端完成至少一帧渲染，用户可以看到「准备调用…」卡片。
      if (announcedPreparing.size > 0) {
        await new Promise((r) => setTimeout(r, 300))
      }

      // 发出所有 running 状态
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

      // 并行执行所有工具调用（第一轮，可能触发 OUT_OF_BOUNDS 需要审批）
      interface ExecResult {
        tc: { id: string; name: string; arguments: string }
        text: string
        isError: boolean
        /** 需要用户审批（OUT_OF_BOUNDS 错误） */
        needsInteract?: boolean
        /** 需要授权的路径列表 */
        interactPaths?: string[]
        /** 解析后的参数（审批通过后重试用） */
        parsedArgs?: Record<string, unknown>
      }

      /** 运行时 grantedPaths，审批通过后动态追加 */
      let runtimeGrantedPaths = [...(options?.grantedPaths ?? [])]

      const execResults: ExecResult[] = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
            let text: string
            let isError = false
            if (BUILTIN_TOOL_NAMES.has(tc.name)) {
              const guardCat = getGuardCategory(tc.name)

              // 先执行工具（不阻断）
              const result = await executeBuiltinTool(
                scope,
                tc.name,
                args,
                sessionId,
                undefined,
                runtimeGrantedPaths
              )
              text = result.text
              isError = result.isError ?? false

              // ── 守卫机制（透传模式：首次附完整指南，后续附精简 tips） ──
              if (guardCat && !isGuideConsulted(sessionId, guardCat)) {
                markGuideConsulted(sessionId, guardCat)
                const guide = lookupToolGuide(tc.name)
                if (guide) text += `\n\n---\n[首次使用指南]\n${guide.content}`
              } else if (guardCat && !isError) {
                const tips = getToolTips(tc.name)
                if (tips) text += `\n\n${tips}`
              }

              // prizm_tool_guide 主动查阅后记录类别
              if (tc.name === 'prizm_tool_guide' && !isError) {
                const toolArg = typeof args.tool === 'string' ? args.tool.trim() : ''
                if (toolArg) {
                  const guide = lookupToolGuide(toolArg)
                  if (guide) markGuideConsulted(sessionId, guide.category)
                }
              }

              // 检测 OUT_OF_BOUNDS：需要用户授权
              if (isError && text.includes(OUT_OF_BOUNDS_ERROR_CODE)) {
                const paths = extractPathsFromToolArgs(args)
                if (paths.length > 0) {
                  return {
                    tc,
                    text,
                    isError,
                    needsInteract: true,
                    interactPaths: paths,
                    parsedArgs: args
                  }
                }
              }
            } else if (tc.name === 'tavily_web_search') {
              const query = typeof args.query === 'string' ? args.query : ''
              const results = await searchTavily(query)
              text =
                results.length > 0
                  ? results
                      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
                      .join('\n\n---\n\n')
                  : '未找到相关结果'
            } else {
              const toolResult = await manager.callTool(tc.name, args)
              text =
                toolResult.content
                  ?.map((c) => ('text' in c ? c.text : JSON.stringify(c)))
                  .join('\n') ?? ''
              if (toolResult.isError) {
                isError = true
                text = `Error: ${text}`
              }
            }
            return { tc, text, isError }
          } catch (err) {
            if (isTransientError(err)) {
              await new Promise((r) => setTimeout(r, 500))
              try {
                const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
                let text: string
                let isError = false
                if (BUILTIN_TOOL_NAMES.has(tc.name)) {
                  const result = await executeBuiltinTool(
                    scope,
                    tc.name,
                    args,
                    sessionId,
                    undefined,
                    runtimeGrantedPaths
                  )
                  text = result.text
                  isError = result.isError ?? false
                } else {
                  const toolResult = await manager.callTool(tc.name, args)
                  text =
                    toolResult.content
                      ?.map((c) => ('text' in c ? c.text : JSON.stringify(c)))
                      .join('\n') ?? ''
                  if (toolResult.isError) {
                    isError = true
                    text = `Error: ${text}`
                  }
                }
                return { tc, text, isError }
              } catch (retryErr) {
                const errText = retryErr instanceof Error ? retryErr.message : String(retryErr)
                return { tc, text: `Error: ${errText}`, isError: true }
              }
            }
            const errText = err instanceof Error ? err.message : String(err)
            return { tc, text: `Error: ${errText}`, isError: true }
          }
        })
      )

      // ---- 交互阻塞流程 ----
      // 对需要用户交互的工具逐个处理：yield 交互请求 → 阻塞等待 → 用户确认后重试
      for (let i = 0; i < execResults.length; i++) {
        const r = execResults[i]
        if (!r.needsInteract || !r.interactPaths?.length) continue
        if (options?.signal?.aborted) break

        // 检查路径是否已在之前的交互中被授权（同一批次中多个工具访问同一路径）
        const uncoveredPaths = r.interactPaths.filter((p) => !runtimeGrantedPaths.includes(p))
        if (uncoveredPaths.length === 0) {
          // 路径已被授权，直接重试
          try {
            const retryResult = await executeBuiltinTool(
              scope,
              r.tc.name,
              r.parsedArgs ?? {},
              sessionId,
              undefined,
              runtimeGrantedPaths
            )
            execResults[i] = {
              tc: r.tc,
              text: retryResult.text,
              isError: retryResult.isError ?? false
            }
          } catch (retryErr) {
            log.warn('Auto-retry after batch interact failed:', retryErr)
          }
          continue
        }

        // 通知客户端：工具进入等待用户交互状态
        yield {
          toolCall: {
            type: 'tool',
            id: r.tc.id,
            name: r.tc.name,
            arguments: r.tc.arguments,
            result: '',
            status: 'awaiting_interact' as const
          }
        }

        // 创建交互请求并 yield（SSE 发送到客户端）
        const { request, promise } = interactManager.createRequest(
          sessionId ?? '',
          scope,
          r.tc.id,
          r.tc.name,
          uncoveredPaths
        )

        yield {
          interactRequest: {
            requestId: request.requestId,
            toolCallId: r.tc.id,
            toolName: r.tc.name,
            paths: uncoveredPaths
          }
        }

        log.info(
          '[Interact] Blocking for tool=%s paths=%s requestId=%s',
          r.tc.name,
          uncoveredPaths.join(', '),
          request.requestId
        )

        // 阻塞等待用户确认/拒绝（Promise 由 interactManager.resolveRequest 解除）
        const response = await promise

        if (response.approved && response.grantedPaths?.length) {
          // 更新运行时授权路径
          for (const p of response.grantedPaths) {
            if (!runtimeGrantedPaths.includes(p)) runtimeGrantedPaths.push(p)
          }

          // 通知客户端：工具恢复执行
          yield {
            toolCall: {
              type: 'tool',
              id: r.tc.id,
              name: r.tc.name,
              arguments: r.tc.arguments,
              result: '',
              status: 'running' as const
            }
          }

          // 用更新后的路径重试工具执行
          try {
            const retryResult = await executeBuiltinTool(
              scope,
              r.tc.name,
              r.parsedArgs ?? {},
              sessionId,
              undefined,
              runtimeGrantedPaths
            )
            execResults[i] = {
              tc: r.tc,
              text: retryResult.text,
              isError: retryResult.isError ?? false
            }
          } catch (retryErr) {
            const errText = retryErr instanceof Error ? retryErr.message : String(retryErr)
            execResults[i] = { tc: r.tc, text: `Error: ${errText}`, isError: true }
          }
        } else {
          // 拒绝：保持原始 OUT_OF_BOUNDS 错误，LLM 将看到并做出反应
        }
      }

      // 按原始顺序 yield 最终结果（保持消息顺序一致性）
      for (const { tc, text, isError } of execResults) {
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
            isError,
            status: 'done' as const
          }
        }
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: text
        })
      }
    }
  }
}
