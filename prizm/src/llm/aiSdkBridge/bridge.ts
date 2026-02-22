/**
 * AI SDK streamText → ILLMProvider 桥接
 * 将 fullStream 事件映射为 LLMStreamChunk，含 usage / cachedInputTokens
 */

import { streamText, stepCountIs } from 'ai'
import type {
  ILLMProvider,
  LLMStreamChunk,
  LLMTool,
  LLMChatMessage
} from '../../adapters/interfaces'
import type { MessageUsage } from '../../types'
import type { LLMConfigItem } from '../../settings/serverConfigTypes'
import { mapMessagesToAISDK, mapToolsToAISDK } from './messageTools'
import { getDefaultModelForType } from './resolveModel'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createLogger } from '../../logger'

const log = createLogger('AISdkBridge')

function aiUsageToMessageUsage(u: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; noCacheTokens?: number }
  cachedInputTokens?: number
}): MessageUsage {
  const cached = u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens
  return {
    totalInputTokens: u.inputTokens,
    totalOutputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    cachedInputTokens: cached
  }
}

function getLanguageModel(
  config: LLMConfigItem,
  modelId: string,
  options?: { thinking?: boolean }
): unknown {
  const apiKey = config.apiKey?.trim()
  if (!apiKey) return null

  switch (config.type) {
    case 'openai_compatible': {
      let baseURL = config.baseUrl?.trim() || 'https://api.openai.com/v1'
      baseURL = baseURL.replace(/\/$/, '')
      // SDK 会自行追加 /chat/completions，避免用户填了完整路径导致重复
      baseURL = baseURL.replace(/\/chat\/completions\/?$/i, '')
      const provider = createOpenAICompatible({
        name: config.id,
        apiKey,
        baseURL,
        transformRequestBody: (body: any) => {
          if (options?.thinking) {
            // 兼容 MiMo 的深度思考参数配置
            body.thinking = { type: 'enabled' }
            // 兼容部分其他开源/大模型服务
            body.reasoning_enabled = true
          }
          return body
        }
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
      const modelId = options?.model?.trim() || getDefaultModelForType(config.type)
      const thinkingEnabled = options?.thinking === true
      log.info(
        `[reasoning] chat request: 深度思考(thinking)=${thinkingEnabled} model=${modelId} provider=${config.type}`
      )

      const model = getLanguageModel(config, modelId, { thinking: options?.thinking })
      if (!model) {
        yield { text: '（请在该 LLM 配置中填写 API Key）' }
        yield { done: true }
        return
      }

      const sdkMessages = mapMessagesToAISDK(messages)
      const sdkTools = options?.tools?.length ? mapToolsToAISDK(options.tools) : undefined

      const providerOptions: Record<string, Record<string, unknown>> = {}
      if (config.type === 'openai_compatible') {
        const providerId = config.id // Vercel AI SDK 使用 name 作为 keys
        if (options?.promptCacheKey) {
          // providerOptions[providerId] 可能需要特定的 provider options，这里保留之前的假设
          // 但由于我们使用了 transformRequestBody，大部分可以通过 extra options 处理。
          // OpenAIProvider 默认支持 openai 命名空间，但 openai_compatible 可能只支持根据其 name 的 namespace
          providerOptions.openai = { promptCacheKey: options.promptCacheKey }
        }
        if (options?.thinking) {
          providerOptions[providerId] = {
            ...(providerOptions[providerId] || {}),
            reasoningEffort: 'medium'
          }
        }
      }

      const result = streamText({
        model: model as Parameters<typeof streamText>[0]['model'],
        messages: sdkMessages as any,
        temperature: options?.temperature ?? 0.7,
        abortSignal: options?.signal,
        tools: sdkTools,
        stopWhen: stepCountIs(1),
        providerOptions: Object.keys(providerOptions).length ? (providerOptions as any) : undefined,
        includeRawChunks: options?.thinking === true
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
          rawValue?: unknown
          validatedChunk?: {
            choices?: Array<{ delta?: { reasoning_content?: string; reasoning?: string } }>
          }
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
          // We no longer manually yield from raw, as Vercel AI SDK natively captures reasoning-delta now.
          case 'reasoning-start':
          case 'reasoning-end':
            break
          case 'reasoning':
          case 'reasoning-delta': {
            // AI SDK v6: reasoning-delta 使用 .text；部分 provider 可能用 .delta
            const reasoning = p.text ?? p.delta
            if (reasoning) {
              yield { reasoning }
            }
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
              lastUsage = aiUsageToMessageUsage(
                stepUsage as Parameters<typeof aiUsageToMessageUsage>[0]
              )
            }
            break
          case 'finish':
            if (p.totalUsage) {
              lastUsage = aiUsageToMessageUsage(
                p.totalUsage as Parameters<typeof aiUsageToMessageUsage>[0]
              )
            }
            const finalToolCalls =
              toolCallsAccum.length > 0
                ? toolCallsAccum
                : Object.entries(argsSoFar)
                    .map(([id, args]) => ({
                      id,
                      name: streamingNames[id] ?? '',
                      arguments: args || '{}'
                    }))
                    .filter((t) => t.name)
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
          : Object.entries(argsSoFar)
              .map(([id, args]) => ({
                id,
                name: streamingNames[id] ?? '',
                arguments: args || '{}'
              }))
              .filter((t) => t.name)
      yield {
        done: true,
        usage: lastUsage,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined
      }
    }
  }
}
