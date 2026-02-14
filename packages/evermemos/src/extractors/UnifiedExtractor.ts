import { MemCell, UnifiedExtractionResult } from '../types.js'
import { ICompletionProvider } from '../utils/llm.js'
import { UNIFIED_MEMORY_EXTRACTION_PROMPT } from '../prompts.js'
import { parseUnifiedMemoryText } from './unifiedMemoryParser.js'

/**
 * 单次 LLM 调用完成 episode / event_log / foresight / profile 抽取，将 6 次调用降为 1 次。
 * 不负责 embedding 与落库，由 MemoryManager 根据本结果统一写库。
 */
export class UnifiedExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    this.llmProvider = llmProvider
  }

  async extractAll(memcell: MemCell): Promise<UnifiedExtractionResult | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)
    const prompt = UNIFIED_MEMORY_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
      '{{TIME}}',
      formattedTime
    )

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.2,
        scope: 'memory'
      })
      return parseUnifiedMemoryText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractAll error:', e)
      return null
    }
  }

  private formatInputText(memcell: MemCell): string {
    if (memcell.text) return memcell.text
    if (Array.isArray(memcell.original_data)) {
      return memcell.original_data
        .map((m: any) => {
          const ts = m.timestamp ? `[${m.timestamp}] ` : ''
          const speaker = m.role || m.speaker || m.speaker_name || 'Unknown'
          return `${ts}${speaker}: ${m.content}`
        })
        .join('\n')
    }
    return ''
  }

  private formatTimestamp(timestamp: string | number | Date): string {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return new Date().toISOString()
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date)
  }
}
