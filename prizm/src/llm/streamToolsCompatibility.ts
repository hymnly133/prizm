/**
 * 不支持流式 tool_calls 的 Provider 兼容层
 *
 * 当某 Provider 的 API 不支持 stream: true + tools 时，在 Provider 内部用此函数
 * 模拟流式输出：非流式请求获取完整响应后，按小块 yield，对外仍暴露统一的 chat() 流式接口。
 *
 * 使用方式：Provider 在 chat() 内检测到自身不支持流式 tools 时，调用此函数，
 * 传入返回完整响应的 fetcher，不暴露给 Adapter。
 */

import type { LLMStreamChunk } from '../adapters/interfaces'
import type { MessageUsage } from '../types'

/** 非流式完整响应（兼容层内部使用） */
export interface FullLLMResponse {
  content?: string
  reasoning?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  usage?: MessageUsage
}

/** 模拟流式输出的默认块大小（字符数） */
const DEFAULT_CHUNK_SIZE = 32

/**
 * 兼容层：API 不支持流式 tool_calls 时，内部用非流式请求 + 分块 yield 模拟
 *
 * @param fetchFullResponse 返回完整 LLM 响应的异步函数（非流式 API 调用）
 * @param options.chunkSize 模拟流式时每块字符数，默认 32
 * @param options.signal 可选的 AbortSignal
 * @returns 与 chat() 相同的 AsyncIterable<LLMStreamChunk>
 */
export async function* chatWithToolsFallback(
  fetchFullResponse: () => Promise<FullLLMResponse>,
  options?: { chunkSize?: number; signal?: AbortSignal }
): AsyncIterable<LLMStreamChunk> {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE
  const signal = options?.signal

  const result = await fetchFullResponse()

  if (signal?.aborted) return

  // 先流式输出 reasoning（思考链）
  if (result.reasoning) {
    for (let i = 0; i < result.reasoning.length; i += chunkSize) {
      if (signal?.aborted) return
      yield { reasoning: result.reasoning.slice(i, i + chunkSize) }
    }
  }

  // 再流式输出 content
  if (result.content) {
    for (let i = 0; i < result.content.length; i += chunkSize) {
      if (signal?.aborted) return
      yield { text: result.content.slice(i, i + chunkSize) }
    }
  }

  // 最后 yield 结束块，携带 usage 和 toolCalls
  yield {
    done: true,
    usage: result.usage,
    toolCalls: result.toolCalls
  }
}
