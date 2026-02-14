/**
 * OpenAI 兼容 API 的 LLM 提供商
 * 环境变量：OPENAI_API_URL、OPENAI_API_KEY
 */

import type { ILLMProvider, LLMStreamChunk } from '../adapters/interfaces'
import { parseUsageFromChunk } from './parseUsage'

function getApiUrl(): string {
  return process.env.OPENAI_API_URL?.trim() ?? 'https://api.openai.com/v1'
}

function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim()
}

export class OpenAILikeLLMProvider implements ILLMProvider {
  async *chat(
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; temperature?: number; signal?: AbortSignal }
  ): AsyncIterable<LLMStreamChunk> {
    const apiKey = getApiKey()
    if (!apiKey) {
      // 无 API Key 时返回占位回复
      yield { text: '（请配置 OPENAI_API_KEY 环境变量以使用 LLM）' }
      yield { done: true }
      return
    }

    const baseUrl = getApiUrl().replace(/\/$/, '')
    const url = `${baseUrl}/chat/completions`
    const model = options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

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
      throw new Error(`LLM API error ${response.status}: ${errText}`)
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
                    role?: string
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
              // 思考链：OpenAI o1/o3 用 reasoning_content，部分提供商用 reasoning
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
}
