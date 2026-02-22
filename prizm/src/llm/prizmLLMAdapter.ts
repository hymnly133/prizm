/**
 * 共享 LLM 适配器基类
 *
 * 统一 EverMemService.PrizmLLMAdapter 和 documentMemoryService.MigrationLLMAdapter 的重复实现。
 * 封装 getLLMProvider() → stream → collect text + usage → recordTokenUsage 的通用流程。
 */

import { getLLMProvider, getLLMProviderName } from './index'
import type { LLMChatMessage } from '../adapters/interfaces'
import type { ICompletionProvider, CompletionRequest } from '@prizm/evermemos'
import { recordTokenUsage } from './tokenUsage'
import { logLLMCall, buildMessagesSummary, formatUsage } from './llmCallLogger'

export type LocalEmbeddingFn = (text: string) => Promise<number[]>

export interface BasePrizmLLMAdapterOptions {
  scope: string
  defaultCategory?: string
  localEmbeddingProvider?: () => LocalEmbeddingFn | null
}

/**
 * 通用 Prizm LLM Provider ↔ EverMemOS ICompletionProvider 桥接。
 *
 * - `scope` 和 `sessionId` 用于 token usage 记账
 * - `defaultCategory` 用于 usage 分类（默认 memory:conversation_extract）
 * - `localEmbeddingProvider` 返回当前本地 embedding 函数（可选）
 */
export class BasePrizmLLMAdapter implements ICompletionProvider {
  private _sessionId: string | undefined
  private _lastUsage: {
    totalInputTokens?: number
    totalOutputTokens?: number
    totalTokens?: number
  } | null = null
  private _mockEmbeddingWarned = false

  private readonly _scope: string
  private readonly _defaultCategory: string
  private readonly _getLocalEmbedding: (() => LocalEmbeddingFn | null) | undefined

  constructor(options: BasePrizmLLMAdapterOptions) {
    this._scope = options.scope
    this._defaultCategory = options.defaultCategory ?? 'memory:conversation_extract'
    this._getLocalEmbedding = options.localEmbeddingProvider
  }

  get scope(): string {
    return this._scope
  }

  get lastUsage() {
    return this._lastUsage
  }

  setSessionId(sessionId: string | undefined): void {
    this._sessionId = sessionId
  }

  async generate(request: CompletionRequest): Promise<string> {
    const provider = getLLMProvider()
    if (!provider) {
      throw new Error('No LLM provider configured. Please add and configure at least one LLM in settings.')
    }
    const messages: LLMChatMessage[] = request.systemPrompt
      ? [
          { role: 'system' as const, content: request.systemPrompt },
          { role: 'user' as const, content: request.prompt }
        ]
      : [{ role: 'user' as const, content: request.prompt }]
    const model = getLLMProviderName()
    const category = (request.operationTag ?? this._defaultCategory) as string

    const stream = provider.chat(messages, {
      temperature: request.temperature,
      promptCacheKey: request.cacheKey
    })

    let fullText = ''
    this._lastUsage = null
    let recordedInCatch = false
    const startTime = Date.now()

    try {
      for await (const chunk of stream) {
        if (chunk.text) fullText += chunk.text
        if (chunk.usage) this._lastUsage = chunk.usage
      }
    } catch (err) {
      recordTokenUsage(
        category as Parameters<typeof recordTokenUsage>[0],
        this._scope,
        this._lastUsage ?? { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 },
        model,
        this._sessionId,
        !this._lastUsage
      )
      recordedInCatch = true
      logLLMCall({
        ts: new Date().toISOString(),
        category,
        sessionId: this._sessionId,
        scope: this._scope,
        model,
        promptCacheKey: request.cacheKey,
        messages: buildMessagesSummary(messages),
        usage: formatUsage(this._lastUsage ?? undefined),
        durationMs: Date.now() - startTime,
        error: String(err)
      })
      throw err
    } finally {
      if (this._lastUsage && !recordedInCatch) {
        recordTokenUsage(
          category as Parameters<typeof recordTokenUsage>[0],
          this._scope,
          this._lastUsage,
          model,
          this._sessionId
        )
        logLLMCall({
          ts: new Date().toISOString(),
          category,
          sessionId: this._sessionId,
          scope: this._scope,
          model,
          promptCacheKey: request.cacheKey,
          messages: buildMessagesSummary(messages),
          usage: formatUsage(this._lastUsage),
          durationMs: Date.now() - startTime
        })
      }
    }

    return fullText
  }

  async getEmbedding(text: string): Promise<number[]> {
    const localFn = this._getLocalEmbedding?.()
    if (localFn) {
      return localFn(text)
    }

    const provider = getLLMProvider()
    if (!provider || !('embed' in provider)) {
      if (!this._mockEmbeddingWarned) {
        this._mockEmbeddingWarned = true
      }
      return []
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (provider as any).embed([text])
    return resp[0]
  }
}
