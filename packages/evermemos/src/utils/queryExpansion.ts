import type { IQueryExpansionProvider } from '../types.js'
import type { ICompletionProvider } from './llm.js'
import { parseJSON } from './llm.js'
import { QUERY_EXPANSION_PROMPT } from '../prompts.js'

/**
 * 使用 LLM 将单条 query 扩展为多条子查询，供 agentic 检索使用。
 * 仅在需要处理复杂/多意图查询时使用（会多一次 LLM 调用）。
 */
export class DefaultQueryExpansionProvider implements IQueryExpansionProvider {
  constructor(private completion: ICompletionProvider) {}

  async expandQuery(query: string): Promise<string[]> {
    const prompt = QUERY_EXPANSION_PROMPT.replace('{{QUERY}}', query)
    const out = await this.completion.generate({
      prompt,
      temperature: 0.3,
      json: true,
      operationTag: 'memory:query_expansion'
    })
    const parsed = parseJSON(out)
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((x: unknown) => typeof x === 'string' && x.trim().length > 0)
      if (strings.length > 0) return strings.slice(0, 5)
    }
    return [query]
  }
}
