import { BaseExtractor } from './BaseExtractor.js'
import { MemCell, BaseMemory, MemoryType, Foresight } from '../types.js'
import { ICompletionProvider, CompletionRequest, parseJSON } from '../utils/llm.js'
import { FORESIGHT_GENERATION_PROMPT } from '../prompts.js'
import { v4 as uuidv4 } from 'uuid'

export class ForesightExtractor extends BaseExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    super()
    this.llmProvider = llmProvider
  }

  async extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const prompt = FORESIGHT_GENERATION_PROMPT.replace('{{CONVERSATION_TEXT}}', inputText)

    try {
      const response = await this.llmProvider.generate({
        prompt: prompt,
        temperature: 0.3,
        json: true,
        operationTag: 'memory:conversation_extract'
      })

      const foresightsData = parseJSON(response)
      if (!Array.isArray(foresightsData) || foresightsData.length === 0) {
        return null
      }

      const results: Foresight[] = []
      const limitedData = foresightsData.slice(0, 10)

      for (const item of limitedData) {
        // Process dates
        let startTime = this.cleanDateString(item.start_time || item.item_start_time)
        let endTime = this.cleanDateString(item.end_time || item.item_end_time)
        let durationDays = item.duration_days

        // Smart fill logic
        if (startTime) {
          if (durationDays && !endTime) {
            endTime = this.calculateEndTimeFromDuration(startTime, durationDays)
          } else if (endTime && !durationDays) {
            durationDays = this.calculateDurationDays(startTime, endTime)
          }
        }

        const embedding = await this.llmProvider.getEmbedding(item.content)
        const foresight: Foresight = {
          id: uuidv4(),
          memory_type: MemoryType.FORESIGHT,
          user_id: memcell.user_id,
          group_id: memcell.group_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          timestamp: timestamp,
          deleted: false,
          content: item.content,
          valid_start: startTime,
          valid_end: endTime,
          embedding: embedding,
          metadata: {
            evidence: item.evidence,
            duration_days: durationDays,
            full_prediction: item
          }
        }
        results.push(foresight)
      }

      return results as unknown as T[]
    } catch (e) {
      console.error('Error extracting foresight:', e)
      return null
    }
  }

  private cleanDateString(dateStr: string | undefined): string | undefined {
    if (!dateStr || typeof dateStr !== 'string') return undefined
    const cleaned = dateStr.replace(/[^\d\-]/g, '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined

    // Validate date parts
    const [year, month, day] = cleaned.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return undefined
    }
    return cleaned
  }

  private calculateEndTimeFromDuration(
    startTime: string,
    durationDays: number
  ): string | undefined {
    try {
      const start = new Date(startTime)
      const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000)
      return end.toISOString().split('T')[0]
    } catch {
      return undefined
    }
  }

  private calculateDurationDays(startTime: string, endTime: string): number | undefined {
    try {
      const start = new Date(startTime)
      const end = new Date(endTime)
      const diff = end.getTime() - start.getTime()
      return Math.floor(diff / (24 * 60 * 60 * 1000))
    } catch {
      return undefined
    }
  }

  private formatInputText(memcell: MemCell): string {
    if (memcell.text) return memcell.text
    if (Array.isArray(memcell.original_data)) {
      return memcell.original_data
        .map((m: any) => `[${m.timestamp || ''}] ${m.role || m.speaker}: ${m.content}`)
        .join('\n')
    }
    return ''
  }
}
