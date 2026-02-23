/**
 * Stagehand 自定义 LLM 客户端：实现官方 createChatCompletion 约定，
 * 与 agent 同路径（provider.chat），供 act/observe/extract 使用。
 * 官方约定：https://docs.stagehand.dev/configuration/models（Extending the AI SDK Client）
 * 约定与实现要点：docs/stagehand-custom-llm-client.md
 */

import type { ILLMProvider, LLMChatMessage, LLMMessageContentPart } from '../adapters/interfaces'
import type { MessageUsage } from '../types'
import { jsonrepair } from 'jsonrepair'

/** Stagehand createChatCompletion 的 options 形状（与官方约定一致，不依赖 stagehand 类型） */
export interface StagehandChatCompletionOptions {
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content:
      | string
      | Array<{
          type: string
          text?: string
          image_url?: { url: string }
          source?: { data: string; media_type?: string }
        }>
  }>
  temperature?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  response_model?: {
    name: string
    schema: { parse: (data: unknown) => unknown }
  }
}

/** 与官方 createChatCompletion 入参一致：options + 可选 logger、retries */
export interface StagehandCreateChatCompletionParams {
  options: StagehandChatCompletionOptions
  logger?: (line: {
    message?: string
    category?: string
    level?: number
    auxiliary?: Record<string, { value?: string; type?: string }>
  }) => void
  retries?: number
}

/** Stagehand 期望的 usage 形状 */
export interface StagehandLLMUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  reasoning_tokens?: number
  cached_input_tokens?: number
}

/** 重试前等待（与官方 Extending the AI SDK Client 示例一致：退避后再重试） */
function delayBeforeRetry(retriesLeft: number): Promise<void> {
  const ms = 1000 * Math.max(1, retriesLeft)
  return new Promise((r) => setTimeout(r, ms))
}

function messageUsageToStagehandUsage(u: MessageUsage | undefined): StagehandLLMUsage {
  const prompt = u?.totalInputTokens ?? 0
  const completion = u?.totalOutputTokens ?? 0
  const total = u?.totalTokens ?? prompt + completion
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cached_input_tokens: u?.cachedInputTokens
  }
}

/**
 * 将 LLM 返回的 raw 规范为 Stagehand 内部 Zod 期望的格式，避免 invalid_type 校验失败。
 * act 期望 { elementId, description, method, arguments, twoStep }（常返回 selector 或缺字段）；
 * observe 期望 { elements: Array<{ elementId, description, method, arguments }> }（常直接返回数组）；
 * extract 期望对象如 { extraction }（常直接返回字符串或 null）。
 */
function normalizeStagehandRaw(raw: unknown, schemaName: string): unknown {
  if (raw === null || raw === undefined) {
    if (schemaName === 'act' || schemaName === 'Observation') return raw
    if (schemaName === 'Metadata') return { progress: '', completed: true }
    return { extraction: '' }
  }
  if (typeof raw === 'string') {
    if (schemaName === 'Metadata') return { progress: raw, completed: true }
    return { extraction: raw }
  }
  if (Array.isArray(raw)) {
    const elements = raw.map((el) => normalizeObserveElement(el))
    return { elements }
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (schemaName === 'act') {
      return {
        elementId: o.elementId ?? o.selector ?? '',
        description: o.description ?? '',
        method: o.method ?? 'click',
        arguments: Array.isArray(o.arguments) ? o.arguments : [],
        twoStep: typeof o.twoStep === 'boolean' ? o.twoStep : false
      }
    }
    if (schemaName === 'Observation' && Array.isArray(o.elements)) {
      return {
        elements: o.elements.map((el: unknown) => normalizeObserveElement(el))
      }
    }
    if (schemaName === 'Observation' && !('elements' in o)) {
      return { elements: [normalizeObserveElement(o)] }
    }
    if (schemaName === 'Extraction') {
      const ext = o.extraction ?? o.value ?? o.pageText ?? ''
      return { extraction: String(ext) }
    }
    if (schemaName === 'Metadata' && (!('progress' in o) || !('completed' in o))) {
      return {
        progress: String(o.progress ?? ''),
        completed: typeof o.completed === 'boolean' ? o.completed : true
      }
    }
  }
  return raw
}

function normalizeObserveElement(el: unknown): Record<string, unknown> {
  const o = el && typeof el === 'object' ? (el as Record<string, unknown>) : {}
  return {
    elementId: o.elementId ?? o.selector ?? '',
    description: o.description ?? '',
    method: o.method ?? 'click',
    arguments: Array.isArray(o.arguments) ? o.arguments : []
  }
}

/** 将 Stagehand 的 messages 转为 Prizm LLMChatMessage[]（与 agent 同格式） */
function stagehandMessagesToPrizm(
  messages: StagehandChatCompletionOptions['messages']
): LLMChatMessage[] {
  return messages.map((m) => {
    const role = m.role as 'system' | 'user' | 'assistant'
    if (typeof m.content === 'string') {
      return { role, content: m.content }
    }
    const parts: LLMMessageContentPart[] = []
    for (const p of m.content) {
      if (p.text !== undefined) {
        parts.push({ type: 'text', text: p.text })
      } else if (p.image_url?.url) {
        parts.push({ type: 'image', image: p.image_url.url })
      } else if (p.source?.data) {
        const dataUrl = p.source.media_type
          ? `data:${p.source.media_type};base64,${p.source.data}`
          : `data:image/png;base64,${p.source.data}`
        parts.push({ type: 'image', image: dataUrl })
      }
    }
    const content =
      parts.length === 0
        ? ''
        : parts.length === 1 && parts[0].type === 'text'
        ? parts[0].text
        : parts
    return { role, content }
  }) as LLMChatMessage[]
}

/**
 * 满足 Stagehand opts.llmClient 约定的客户端：
 * 使用与 agent 相同的 provider.chat 路径，消费流后返回 { data, usage }。
 */
export class PrizmStagehandLLMClient {
  readonly type = 'openai' as const
  /** Stagehand 用于日志/显示；与 agent 同路径时实际调用用 modelId */
  readonly modelName: string
  readonly hasVision = true
  readonly clientOptions = {}

  constructor(
    private readonly provider: ILLMProvider,
    /** 实际传给 provider.chat 的模型 ID */
    private readonly modelId: string,
    modelDisplayName?: string
  ) {
    this.modelName = modelDisplayName ?? modelId
  }

  async createChatCompletion<T = { data: string; usage?: StagehandLLMUsage }>(
    params: StagehandCreateChatCompletionParams
  ): Promise<T> {
    const { options, logger, retries = 0 } = params
    return this.runCreateChatCompletion(options, logger, retries) as Promise<T>
  }

  private async runCreateChatCompletion(
    options: StagehandChatCompletionOptions,
    logger: StagehandCreateChatCompletionParams['logger'],
    retriesLeft: number
  ): Promise<{ data: unknown; usage: StagehandLLMUsage }> {
    const messages: LLMChatMessage[] = stagehandMessagesToPrizm(options.messages)
    const temperature = options.temperature ?? 0.1

    logger?.({
      category: 'stagehand',
      message: 'creating chat completion',
      level: 1,
      auxiliary: { modelName: { value: this.modelName, type: 'string' } }
    })

    let text = ''
    let lastUsage: MessageUsage | undefined

    const stream = this.provider.chat(messages, {
      model: this.modelId,
      temperature
    })

    for await (const chunk of stream) {
      if (chunk.text) text += chunk.text
      if (chunk.usage) lastUsage = chunk.usage
      if (chunk.done) break
    }

    const usage = messageUsageToStagehandUsage(lastUsage)

    if (options.response_model) {
      const schemaName = options.response_model.name ?? ''
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        try {
          raw = JSON.parse(jsonrepair(text))
        } catch (e) {
          // Extraction：模型常直接返回纯文本（如中文说明），非 JSON。将整段文本视为 extraction 内容。
          if (schemaName === 'Extraction' && text.trim().length > 0) {
            raw = { extraction: text.trim() }
            logger?.({
              category: 'stagehand',
              message: 'response_model: treat non-JSON response as plain-text extraction',
              level: 1
            })
          } else {
            logger?.({
              category: 'stagehand',
              message: `response_model: failed to parse JSON: ${
                e instanceof Error ? e.message : String(e)
              }`,
              level: 0
            })
            if (retriesLeft > 0) {
              await delayBeforeRetry(retriesLeft)
              return this.runCreateChatCompletion(options, logger, retriesLeft - 1)
            }
            throw e
          }
        }
      }
      const normalized = normalizeStagehandRaw(raw, schemaName)
      try {
        const parsed = options.response_model.schema.parse(normalized)
        logger?.({
          category: 'stagehand',
          message: 'response',
          level: 1,
          auxiliary: { schemaName: { value: schemaName, type: 'string' } }
        })
        return { data: parsed, usage }
      } catch (e) {
        logger?.({
          category: 'stagehand',
          message: `response_model: Zod schema validation failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
          level: 0
        })
        if (retriesLeft > 0) {
          await delayBeforeRetry(retriesLeft)
          return this.runCreateChatCompletion(options, logger, retriesLeft - 1)
        }
        throw e
      }
    }

    return { data: text, usage }
  }
}
