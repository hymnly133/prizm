/**
 * AI SDK streamText → ILLMProvider 桥接
 * 将 fullStream 事件映射为 LLMStreamChunk，含 usage / cachedInputTokens
 */

import { streamText, stepCountIs } from 'ai'
import type { ILLMProvider, LLMStreamChunk, LLMTool, LLMChatMessage } from '../../adapters/interfaces'
import type { MessageUsage } from '../../types'
import type { LLMConfigItem } from '../../settings/serverConfigTypes'
import { mapMessagesToAISDK, mapToolsToAISDK } from './messageTools'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

function aiUsageToMessageUsage(u: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; noCacheTokens?: number }
  cachedInputTokens?: number
}): MessageUsage {
  const cached =
    u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens
  return {
    totalInputTokens: u.inputTokens,
    totalOutputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    cachedInputTokens: cached
  }
}

function getLanguageModel(config: LLMConfigItem, modelId: string): unknown {
  const apiKey = config.apiKey?.trim()
  if (!apiKey) return null

  switch (config.type) {
    case 'openai_compatible': {
      const baseURL = config.baseUrl?.trim() || 'https://api.openai.com/v1'
      const provider = createOpenAICompatible({
        name: config.id,
        apiKey,
        baseURL: baseURL.replace(/\/$/, '')
      })
      return typeof (provider as { chatModel?: (id: string) => unknown }).chatModel === 'function'
        ? (provider as { chatModel: (id: string) => unknown }).chatModel(modelId)
        : (provider as (id: string) => unknown)(modelId)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return (anthropic as (id: string) => unknown)(modelId)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return (google as (id: string) => unknown)(modelId)
    }
    default:
      return null
  }
}

export function createAISDKProvider(config: LLMConfigItem): ILLMProvider {
  return {
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
      const modelId = options?.model?.trim() || config.defaultModel?.trim() || 'gpt-4o-mini'
      const model = getLanguageModel(config, modelId)
      if (!model) {
        yield { text: '（请在该 LLM 配置中填写 API Key）' }
        yield { done: true }
        return
      }

      const sdkMessages = mapMessagesToAISDK(messages)
      const sdkTools = options?.tools?.length ? mapToolsToAISDK(options.tools) : undefined

      const providerOptions: Record<string, Record<string, unknown>> = {}
      if (config.type === 'openai_compatible' && options?.promptCacheKey) {
        providerOptions.openai = { promptCacheKey: options.promptCacheKey }
      }

      const result = streamText({
        model,
        messages: sdkMessages as Parameters<typeof streamText>[0]['messages'],
        temperature: options?.temperature ?? 0.7,
        abortSignal: options?.signal,
        tools: sdkTools,
        stopWhen: stepCountIs(1),
        providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined
      })

      let lastUsage: MessageUsage | undefined
      const toolCallsAccum: Array<{ id: string; name: string; arguments: string }> = []
      const argsSoFar: Record<string, string> = {}
      const streamingNames: Record<string, string> = {}

      for await (const part of result.fullStream) {
        const p = part as {
          type: string
          text?: string
          delta?: string
          id?: string
          toolCallId?: string
          toolName?: string
          input?: unknown
          argsTextDelta?: string
          args?: unknown
          totalUsage?: {
            inputTokens?: number
            outputTokens?: number
            totalTokens?: number
            inputTokenDetails?: { cacheReadTokens?: number }
            cachedInputTokens?: number
          }
          usage?: unknown
          response?: { usage?: unknown }
        }

        switch (p.type) {
          case 'text':
          case 'text-delta': {
            const text = p.text ?? p.delta
            if (text) yield { text }
            break
          }
          case 'reasoning':
          case 'reasoning-delta': {
            const reasoning = p.text ?? p.delta
            if (reasoning) yield { reasoning: reasoning }
            break
          }
          case 'tool-call-streaming-start':
          case 'tool-input-start': {
            const tid = p.toolCallId ?? p.id
            const tname = p.toolName
            if (tid && tname) {
              argsSoFar[tid] = ''
              streamingNames[tid] = tname
              yield { toolCallPreparing: { id: tid, name: tname } }
            }
            break
          }
          case 'tool-call-delta':
          case 'tool-input-delta': {
            const tid = p.toolCallId ?? p.id
            const delta = p.argsTextDelta ?? p.delta
            const tname = tid ? streamingNames[tid] : undefined
            if (tid && tname && delta) {
              argsSoFar[tid] = (argsSoFar[tid] ?? '') + delta
              yield {
                toolCallArgsDelta: {
                  id: tid,
                  name: tname,
                  argumentsDelta: delta,
                  argumentsSoFar: argsSoFar[tid] ?? ''
                }
              }
            }
            break
          }
          case 'tool-call':
            if (p.toolCallId && p.toolName) {
              const args =
                typeof p.input === 'object' && p.input !== null
                  ? JSON.stringify(p.input)
                  : typeof p.args === 'string'
                    ? p.args
                    : '{}'
              toolCallsAccum.push({
                id: p.toolCallId,
                name: p.toolName,
                arguments: args
              })
            }
            break
          case 'finish-step':
            const stepUsage = p.usage ?? (p.response as { usage?: unknown } | undefined)?.usage
            if (stepUsage) {
              lastUsage = aiUsageToMessageUsage(stepUsage as Parameters<typeof aiUsageToMessageUsage>[0])
            }
            break
          case 'finish':
            if (p.totalUsage) {
              lastUsage = aiUsageToMessageUsage(p.totalUsage as Parameters<typeof aiUsageToMessageUsage>[0])
            }
            const finalToolCalls =
              toolCallsAccum.length > 0
                ? toolCallsAccum
                : Object.entries(argsSoFar).map(([id, args]) => ({
                    id,
                    name: streamingNames[id] ?? '',
                    arguments: args || '{}'
                  })).filter((t) => t.name)
            yield {
              done: true,
              usage: lastUsage,
              toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined
            }
            return
          default:
            break
        }
      }

      const finalToolCalls =
        toolCallsAccum.length > 0
          ? toolCallsAccum
          : Object.entries(argsSoFar).map(([id, args]) => ({
              id,
              name: streamingNames[id] ?? '',
              arguments: args || '{}'
            })).filter((t) => t.name)
      yield {
        done: true,
        usage: lastUsage,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined
      }
    }
  }
}
