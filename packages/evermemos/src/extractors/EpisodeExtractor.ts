import { BaseExtractor } from './BaseExtractor.js'
import { MemCell, BaseMemory, MemoryType, NarrativeMemory } from '../types.js'
import { ICompletionProvider, parseJSON } from '../utils/llm.js'
import { EPISODE_MEMORY_PROMPT } from '../prompts.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * 叙事记忆抽取器（原 EpisodeExtractor）。
 * 从对话中提取叙事性记忆（narrative memory）。
 */
export class NarrativeExtractor extends BaseExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    super()
    this.llmProvider = llmProvider
  }

  async extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)
    const prompt = EPISODE_MEMORY_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
      '{{TIME}}',
      formattedTime
    )

    try {
      const response = await this.llmProvider.generate({
        prompt: prompt,
        temperature: 0.1,
        json: true,
        operationTag: 'memory:conversation_extract'
      })

      const data = parseJSON(response)
      if (!data || !data.content) {
        return null
      }

      const embedding = await this.llmProvider.getEmbedding(data.summary || data.content)

      const narrative: NarrativeMemory = {
        id: uuidv4(),
        memory_type: MemoryType.NARRATIVE,
        user_id: memcell.user_id,
        group_id: memcell.group_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        timestamp: timestamp,
        deleted: false,
        content: data.content,
        summary: data.summary,
        keywords: data.keywords,
        embedding: embedding,
        metadata: {
          original_data: memcell.original_data
        }
      }

      return [narrative] as unknown as T[]
    } catch (e) {
      console.error('Error extracting narrative:', e)
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
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }
    return new Intl.DateTimeFormat('en-US', options).format(date)
  }
}

/** @deprecated 使用 NarrativeExtractor 代替 */
export const EpisodeExtractor = NarrativeExtractor
