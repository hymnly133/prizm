/**
 * DefaultAgentAdapter — 并行工具执行与交互阻塞逻辑
 */

import { createLogger } from '../../logger'
import { extractToolPaths } from '../../utils/toolMatcher'
import type { LLMStreamChunk } from '../interfaces'
import { getMcpClientManager } from '../../mcp-client/McpClientManager'
import { webSearch, webFetch, formatSearchResults, formatFetchResult } from '../../llm/webSearch'
import { BUILTIN_TOOL_NAMES, executeBuiltinTool } from '../../llm/builtinTools'
import {
  getGuardCategory,
  getFirstCallHint,
  isGuideConsulted,
  markGuideConsulted
} from '../../llm/toolInstructions'
import { OUT_OF_BOUNDS_ERROR_CODE } from '../../llm/workspaceResolver'
import { interactManager } from '../../llm/interactManager'
import {
  executePreToolUseHooks,
  executePostToolUseHooks
} from '../../core/agentHooks'
import {
  isTransientError,
  TOOL_PROGRESS_THRESHOLD_MS,
  TOOL_PROGRESS_INTERVAL_MS,
  type ExecResult
} from './chatHelpers'

const log = createLogger('Adapter')

export interface ToolExecContext {
  scope: string
  sessionId: string
  grantedPaths: string[]
  signal?: AbortSignal
}

/**
 * 并行执行一批工具调用，返回执行结果列表。
 * 收集到的 progress 心跳事件写入 progressBuffer。
 */
export async function executeToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  ctx: ToolExecContext,
  progressBuffer: LLMStreamChunk[]
): Promise<ExecResult[]> {
  const { scope, sessionId, grantedPaths } = ctx
  const manager = getMcpClientManager()

  return Promise.all(
    toolCalls.map(async (tc) => {
      const startMs = Date.now()
      const heartbeat = setInterval(() => {
        const elapsed = Date.now() - startMs
        if (elapsed >= TOOL_PROGRESS_THRESHOLD_MS) {
          progressBuffer.push({
            toolProgress: { id: tc.id, name: tc.name, elapsedMs: elapsed }
          })
        }
      }, TOOL_PROGRESS_INTERVAL_MS)
      try {
        let args: Record<string, unknown>
        try {
          args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>
        } catch (parseErr) {
          const preview = (tc.arguments || '').slice(0, 200)
          return {
            tc,
            text:
              `工具参数 JSON 解析失败，请检查参数格式后重试。\n` +
              `错误: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n` +
              `原始参数: ${preview}`,
            isError: true
          }
        }

        const preDecision = await executePreToolUseHooks({
          scope,
          sessionId,
          toolName: tc.name,
          toolCallId: tc.id,
          arguments: args,
          grantedPaths
        })

        if (preDecision.decision === 'deny') {
          return {
            tc,
            text: preDecision.denyMessage ?? `Tool ${tc.name} denied by hook`,
            isError: true
          }
        }

        if (preDecision.decision === 'ask' && preDecision.interactPaths?.length) {
          return {
            tc,
            text: `OUT_OF_BOUNDS: ${OUT_OF_BOUNDS_ERROR_CODE}`,
            isError: true,
            needsInteract: true,
            interactPaths: preDecision.interactPaths,
            parsedArgs: preDecision.updatedArguments ?? args
          }
        }

        if (preDecision.updatedArguments) args = preDecision.updatedArguments

        let text: string
        let isError = false
        if (BUILTIN_TOOL_NAMES.has(tc.name)) {
          const result = await executeBuiltinTool(
            scope,
            tc.name,
            args,
            sessionId,
            undefined,
            grantedPaths
          )
          text = result.text
          isError = result.isError ?? false

          // 首次调用受保护工具组时，在结果末尾注入注意事项（不拦截、不重试）
          const guardCat = getGuardCategory(tc.name)
          if (guardCat && !isGuideConsulted(sessionId, guardCat)) {
            markGuideConsulted(sessionId, guardCat)
            const hint = getFirstCallHint(tc.name)
            if (hint) text += `\n\n${hint}`
          }

          if (isError && text.includes(OUT_OF_BOUNDS_ERROR_CODE)) {
            const paths = extractToolPaths(args)
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
        } else if (tc.name === 'prizm_web_search' || tc.name === 'tavily_web_search') {
          const query = typeof args.query === 'string' ? args.query : ''
          const results = await webSearch(query, {
            searchDepth: args.search_depth as 'basic' | 'advanced' | undefined,
            maxResults: typeof args.max_results === 'number' ? args.max_results : undefined,
            includeDomains: Array.isArray(args.include_domains) ? args.include_domains as string[] : undefined,
            excludeDomains: Array.isArray(args.exclude_domains) ? args.exclude_domains as string[] : undefined
          })
          text = formatSearchResults(results)
        } else if (tc.name === 'prizm_web_fetch') {
          const url = typeof args.url === 'string' ? args.url : ''
          if (!url) {
            text = '请提供要抓取的 URL。'
            isError = true
          } else {
            const result = await webFetch(url, {
              extractMode: args.extract_mode as 'full' | 'summary' | undefined,
              maxChars: typeof args.max_chars === 'number' ? args.max_chars : undefined
            })
            text = formatFetchResult(result)
          }
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

        const postDecision = await executePostToolUseHooks({
          scope,
          sessionId,
          toolName: tc.name,
          toolCallId: tc.id,
          arguments: args,
          result: text,
          isError,
          durationMs: Date.now() - startMs
        })
        if (postDecision.updatedResult !== undefined) text = postDecision.updatedResult
        if (postDecision.additionalContext) text += `\n\n${postDecision.additionalContext}`

        return { tc, text, isError, durationMs: Date.now() - startMs }
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
                grantedPaths
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
      } finally {
        clearInterval(heartbeat)
      }
    })
  )
}

export interface InteractionYield {
  chunk: LLMStreamChunk
}

/**
 * 处理需要用户交互确认的工具执行结果。
 * 返回需要 yield 的 chunks 列表和更新后的 execResults。
 */
export async function handleInteractions(
  execResults: ExecResult[],
  ctx: ToolExecContext
): Promise<{ chunks: LLMStreamChunk[]; updatedGrantedPaths: string[] }> {
  const { scope, sessionId, signal } = ctx
  const chunks: LLMStreamChunk[] = []
  const runtimeGrantedPaths = [...ctx.grantedPaths]

  for (let i = 0; i < execResults.length; i++) {
    const r = execResults[i]
    if (!r.needsInteract || !r.interactPaths?.length) continue
    if (signal?.aborted) break

    const uncoveredPaths = r.interactPaths.filter((p) => !runtimeGrantedPaths.includes(p))
    if (uncoveredPaths.length === 0) {
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

    chunks.push({
      toolCall: {
        type: 'tool',
        id: r.tc.id,
        name: r.tc.name,
        arguments: r.tc.arguments,
        result: '',
        status: 'awaiting_interact' as const
      }
    })

    const { request, promise } = interactManager.createRequest(
      sessionId ?? '',
      scope,
      r.tc.id,
      r.tc.name,
      uncoveredPaths
    )

    chunks.push({
      interactRequest: {
        requestId: request.requestId,
        toolCallId: r.tc.id,
        toolName: r.tc.name,
        paths: uncoveredPaths
      }
    })

    log.info(
      '[Interact] Blocking for tool=%s paths=%s requestId=%s',
      r.tc.name,
      uncoveredPaths.join(', '),
      request.requestId
    )

    const response = await promise

    if (response.approved && response.grantedPaths?.length) {
      for (const p of response.grantedPaths) {
        if (!runtimeGrantedPaths.includes(p)) runtimeGrantedPaths.push(p)
      }

      chunks.push({
        toolCall: {
          type: 'tool',
          id: r.tc.id,
          name: r.tc.name,
          arguments: r.tc.arguments,
          result: '',
          status: 'running' as const
        }
      })

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
    }
  }

  return { chunks, updatedGrantedPaths: runtimeGrantedPaths }
}
