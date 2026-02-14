import { BaseExtractor } from './BaseExtractor.js'
import { MemCell, BaseMemory, MemoryType, EventLog } from '../types.js'
import { ICompletionProvider, CompletionRequest, parseJSON } from '../utils/llm.js'
import { EVENT_LOG_PROMPT } from '../prompts.js'
import { v4 as uuidv4 } from 'uuid'

export class EventLogExtractor extends BaseExtractor {
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

    const prompt = EVENT_LOG_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
      '{{TIME}}',
      formattedTime
    )

    try {
      const response = await this.llmProvider.generate({
        prompt: prompt,
        temperature: 0.1,
        json: true,
        scope: 'memory'
      })

      const data = parseJSON(response)
      if (!data || !data.event_log) {
        console.warn('Failed to parse event log response')
        return null
      }

      const eventLogData = data.event_log
      if (
        !eventLogData.atomic_fact ||
        !Array.isArray(eventLogData.atomic_fact) ||
        eventLogData.atomic_fact.length === 0
      ) {
        return null
      }

      // One EventLog record per atomic_fact (doc-aligned granular retrieval)
      const results: EventLog[] = []
      for (let i = 0; i < eventLogData.atomic_fact.length; i++) {
        const fact = eventLogData.atomic_fact[i]
        if (typeof fact !== 'string' || !fact.trim()) continue
        let embedding: number[] | undefined
        try {
          embedding = await this.llmProvider.getEmbedding(fact)
        } catch (e) {
          console.warn('Failed to get embedding for fact:', fact)
        }
        const eventLog: EventLog = {
          id: uuidv4(),
          memory_type: MemoryType.EVENT_LOG,
          user_id: memcell.user_id,
          group_id: memcell.group_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          timestamp,
          deleted: false,
          content: fact.trim(),
          event_type: 'atomic',
          embedding,
          metadata: {
            time: eventLogData.time,
            parent_type: 'memcell',
            parent_id: memcell.event_id
          }
        }
        results.push(eventLog)
      }
      return (results.length ? results : null) as unknown as T[] | null
    } catch (e) {
      console.error('Error extracting event log:', e)
      return null
    }
  }

  private formatInputText(memcell: MemCell): string {
    if (memcell.text) return memcell.text
    if (Array.isArray(memcell.original_data)) {
      return memcell.original_data
        .map((m: any) => `[${m.timestamp || ''}] ${m.role || m.speaker || 'User'}: ${m.content}`)
        .join('\n')
    }
    return ''
  }

  private formatTimestamp(timestamp: string | number | Date): string {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return new Date().toISOString() // Fallback

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }
    // Expected: "March 10, 2024(Sunday) at 2:00 PM"
    // JS Intl format is slightly different but sufficient for LLM understanding:
    // "Sunday, March 10, 2024 at 2:00 PM"
    return new Intl.DateTimeFormat('en-US', options).format(date)
  }
}
