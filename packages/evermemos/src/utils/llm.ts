import { ILLMProvider } from '../core/RetrievalManager.js'

export interface CompletionRequest {
  prompt: string
  /** 稳定的系统指令（作为 messages[0] system，可缓存前缀） */
  systemPrompt?: string
  /** 缓存路由 key（透传给 LLM API 的 prompt_cache_key） */
  cacheKey?: string
  temperature?: number
  json?: boolean
  /** 操作标签，用于 token 统计分类（如 'memory:dedup'） */
  operationTag?: string
}

export interface ICompletionProvider extends ILLMProvider {
  generate(request: CompletionRequest): Promise<string>
}

export function parseJSON(text: string): any {
  try {
    // Try parsing directly
    return JSON.parse(text)
  } catch (e) {
    // Try extracting from code blocks
    const jsonMatch = text.match(/```json([\s\S]*?)```/)
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim())
      } catch (e2) {
        // ignore
      }
    }
    // Try finding first { and last }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.substring(start, end + 1))
      } catch (e3) {
        // ignore
      }
    }
    // Array check
    const startArr = text.indexOf('[')
    const endArr = text.lastIndexOf(']')
    if (startArr >= 0 && endArr > startArr) {
      try {
        return JSON.parse(text.substring(startArr, endArr + 1))
      } catch (e4) {
        // ignore
      }
    }
  }
  return null
}
