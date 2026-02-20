/**
 * OpenAI 兼容 API 的 LLM 提供商
 * 环境变量：OPENAI_API_URL、OPENAI_API_KEY
 */

import type { ILLMProvider, LLMStreamChunk, LLMTool, LLMChatMessage } from '../adapters/interfaces'
import type { MessageUsage } from '../types'
import { parseUsageFromChunk } from './parseUsage'
import {
  createInitialAccumulator,
  reduceStreamDelta,
  type AccumulatedMessage
} from './streamToolCallsReducer'

function getApiUrl(): string {
  return process.env.OPENAI_API_URL?.trim() ?? 'https://api.openai.com/v1'
}

function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim()
}

function mapMessageToApi(m: LLMChatMessage): Record<string, unknown> {
  if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls) {
    return {
      role: 'assistant',
      content: m.content ?? '',
      tool_calls: m.tool_calls
    }
  }
  if (m.role === 'tool' && 'tool_call_id' in m) {
    return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
  }
  return { role: m.role, content: m.content }
}

export class OpenAILikeLLMProvider implements ILLMProvider {
  async *chat(
    messages: LLMChatMessage[],
    options?: {
      model?: string
      temperature?: number
      signal?: AbortSignal
      tools?: LLMTool[]
      thinking?: boolean
      promptCacheKey?: string
    }
  ): AsyncIterable<LLMStreamChunk> {
    const apiKey = getApiKey()
    if (!apiKey) {
      yield { text: '（请配置 OPENAI_API_KEY 环境变量以使用 LLM）' }
      yield { done: true }
      return
    }

    const baseUrl = getApiUrl().replace(/\/$/, '')
    const url = `${baseUrl}/chat/completions`
    const model = options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(mapMessageToApi),
      stream: true,
      stream_options: { include_usage: true },
      temperature: options?.temperature ?? 0.7
    }
    if (options?.tools?.length) {
      body.tools = options.tools
      body.tool_choice = 'auto'
    }
    if (options?.promptCacheKey) {
      body.prompt_cache_key = options.promptCacheKey
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: options?.signal
    })

    if (!response.ok) {
      const errText = await response.text()
      try {
        const parsed = JSON.parse(errText) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        const errUsage = parseUsageFromChunk(parsed)
        if (errUsage) yield { done: true, usage: errUsage }
      } catch {
        /* ignore parse */
      }
      throw new Error(`LLM API error ${response.status}: ${errText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let accumulated: AccumulatedMessage = createInitialAccumulator()
    let lastUsage: MessageUsage | undefined = undefined
    const announcedToolIndices = new Set<number>()

    try {
      while (true) {
        if (options?.signal?.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              const toolCalls = accumulated.toolCalls.filter((tc) => tc.id && tc.name)
              yield toolCalls.length
                ? { done: true, usage: lastUsage, toolCalls }
                : { done: true, usage: lastUsage }
              return
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string
                    role?: string
                    reasoning_content?: string
                    reasoning?: string
                    tool_calls?: Array<{
                      index?: number
                      id?: string
                      function?: { name?: string; arguments?: string }
                      type?: string
                    }>
                  }
                  finish_reason?: string
                }>
                usage?: {
                  prompt_tokens?: number
                  completion_tokens?: number
                  total_tokens?: number
                }
              }
              const usageFromChunk = parseUsageFromChunk(parsed)
              if (usageFromChunk) lastUsage = usageFromChunk
              const choice = parsed.choices?.[0]
              const delta = choice?.delta
              if (delta) {
                accumulated = reduceStreamDelta(accumulated, delta)
                if (delta.content) yield { text: delta.content }
                const reasoning = delta.reasoning_content ?? delta.reasoning
                if (reasoning) yield { reasoning }
                for (let i = 0; i < accumulated.toolCalls.length; i++) {
                  const tc = accumulated.toolCalls[i]
                  if (tc.id && tc.name && !announcedToolIndices.has(i)) {
                    announcedToolIndices.add(i)
                    yield { toolCallPreparing: { id: tc.id, name: tc.name } }
                  }
                }
                if (delta.tool_calls) {
                  for (const d of delta.tool_calls) {
                    if (d.function?.arguments) {
                      const idx = d.index ?? 0
                      const tc = accumulated.toolCalls[idx]
                      if (tc?.id && tc?.name) {
                        yield {
                          toolCallArgsDelta: {
                            id: tc.id,
                            name: tc.name,
                            argumentsDelta: d.function.arguments,
                            argumentsSoFar: tc.arguments
                          }
                        }
                      }
                    }
                  }
                }
              }
              // 部分 API 在 finish_reason 之后还有单独的 usage chunk（含 cached_tokens），
              // 因此不在此处 return，由 [DONE] 统一终结以确保捕获完整 usage。
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      if (buffer.trim()) {
        const line = buffer.trim()
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>
            const usageFromBuf = parseUsageFromChunk(
              parsed as Parameters<typeof parseUsageFromChunk>[0]
            )
            if (usageFromBuf) lastUsage = usageFromBuf
            const delta = (parsed as { choices?: Array<{ delta?: { content?: string } }> })
              .choices?.[0]?.delta?.content
            if (delta) yield { text: delta }
          } catch {
            // ignore
          }
        }
      }

      const toolCalls = accumulated.toolCalls.filter((tc) => tc.id && tc.name)
      yield toolCalls.length
        ? { done: true, usage: lastUsage, toolCalls }
        : { done: true, usage: lastUsage }
    } catch (e) {
      if (lastUsage) {
        yield { done: true, usage: lastUsage }
      }
      throw e
    } finally {
      reader.releaseLock()
    }
  }
}
