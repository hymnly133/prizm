/**
 * 小米 MiMo LLM 提供商
 * 环境变量：XIAOMIMIMO_API_KEY
 * API 文档：https://platform.xiaomimimo.com/
 */

import type {
  ILLMProvider,
  LLMStreamChunk,
  LLMChatResult,
  LLMTool
} from '../adapters/interfaces'
import { parseUsageFromChunk } from './parseUsage'

const BASE_URL = 'https://api.xiaomimimo.com/v1'

function getApiKey(): string | undefined {
  return process.env.XIAOMIMIMO_API_KEY?.trim()
}

export class XiaomiMiMoLLMProvider implements ILLMProvider {
  async *chat(
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; temperature?: number; signal?: AbortSignal }
  ): AsyncIterable<LLMStreamChunk> {
    const apiKey = getApiKey()
    if (!apiKey) {
      yield { text: '（请配置 XIAOMIMIMO_API_KEY 环境变量以使用小米 MiMo）' }
      yield { done: true }
      return
    }

    const model = options?.model ?? process.env.XIAOMIMIMO_MODEL ?? 'mimo-v2-flash'
    const url = `${BASE_URL}/chat/completions`

    const body = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content
      })),
      stream: true,
      temperature: options?.temperature ?? 0.7
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
      throw new Error(`小米 MiMo API 错误 ${response.status}: ${errText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

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
              yield { done: true }
              return
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string
                    reasoning_content?: string
                    reasoning?: string
                  }
                  finish_reason?: string
                }>
                usage?: {
                  prompt_tokens?: number
                  completion_tokens?: number
                  total_tokens?: number
                }
              }
              const delta = parsed.choices?.[0]?.delta
              if (delta?.content) {
                yield { text: delta.content }
              }
              const reasoning = delta?.reasoning_content ?? delta?.reasoning
              if (reasoning) {
                yield { reasoning }
              }
              if (parsed.choices?.[0]?.finish_reason) {
                const usage = parseUsageFromChunk(parsed)
                yield usage ? { done: true, usage } : { done: true }
                return
              }
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
            const parsed = JSON.parse(line.slice(6)) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) yield { text: delta }
          } catch {
            // ignore
          }
        }
      }

      yield { done: true }
    } finally {
      reader.releaseLock()
    }
  }

  async chatNonStreaming(
    messages: Array<
      | { role: string; content: string }
      | {
          role: 'assistant'
          content: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      | { role: 'tool'; tool_call_id: string; content: string }
    >,
    options?: { model?: string; temperature?: number; signal?: AbortSignal; tools?: LLMTool[] }
  ): Promise<LLMChatResult> {
    const apiKey = getApiKey()
    if (!apiKey) {
      return {
        content: '（请配置 XIAOMIMIMO_API_KEY 环境变量以使用小米 MiMo）'
      }
    }

    const model = options?.model ?? process.env.XIAOMIMIMO_MODEL ?? 'mimo-v2-flash'
    const url = `${BASE_URL}/chat/completions`

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls) {
          return { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls }
        }
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
        }
        return { role: m.role, content: m.content }
      }),
      stream: false,
      temperature: options?.temperature ?? 0.7
    }
    if (options?.tools?.length) {
      body.tools = options.tools
      body.tool_choice = 'auto'
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
      throw new Error(`小米 MiMo API 错误 ${response.status}: ${errText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string
          reasoning_content?: string
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }

    const msg = data.choices?.[0]?.message
    if (!msg) {
      return { content: '' }
    }

    const toolCalls = msg.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments
    }))

    return {
      content: msg.content ?? '',
      reasoning: msg.reasoning_content,
      toolCalls,
      usage: data.usage
        ? {
            totalTokens: data.usage.total_tokens,
            totalInputTokens: data.usage.prompt_tokens,
            totalOutputTokens: data.usage.completion_tokens
          }
        : undefined
    }
  }
}
