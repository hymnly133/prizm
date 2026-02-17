import { MemCell, UnifiedExtractionResult } from '../types.js'
import { ICompletionProvider } from '../utils/llm.js'
import {
  UNIFIED_MEMORY_EXTRACTION_PROMPT,
  DOCUMENT_MEMORY_EXTRACTION_PROMPT,
  DOCUMENT_MIGRATION_PROMPT
} from '../prompts.js'
import { parseUnifiedMemoryText, parseMigrationText } from './unifiedMemoryParser.js'

/**
 * 单次 LLM 调用完成记忆抽取。
 * - 对话场景：episode / event_log / foresight / profile（6→1 合并调用）
 * - 文档场景：overview（→episode）+ facts（→event_log）使用专用 prompt
 * 不负责 embedding 与落库，由 MemoryManager 根据本结果统一写库。
 */
export class UnifiedExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    this.llmProvider = llmProvider
  }

  async extractAll(
    memcell: MemCell,
    existingProfileSummary?: string
  ): Promise<UnifiedExtractionResult | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)

    const isDocument = memcell.scene === 'document'
    const title = (memcell.metadata as Record<string, unknown>)?.title as string | undefined

    let prompt: string
    if (isDocument) {
      prompt = DOCUMENT_MEMORY_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText)
        .replace('{{TIME}}', formattedTime)
        .replace('{{TITLE}}', title || '未命名文档')
    } else {
      prompt = UNIFIED_MEMORY_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
        '{{TIME}}',
        formattedTime
      )
      // 注入已有画像摘要，让 LLM 只抽取增量（避免重复抽取已知信息）
      if (existingProfileSummary) {
        prompt = prompt.replace('{{EXISTING_PROFILE}}', existingProfileSummary)
      } else {
        prompt = prompt.replace('{{EXISTING_PROFILE}}', '无')
      }
    }

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

  /**
   * 抽取文档迁移记忆：从 diff 中提取语义变更条目列表。
   * @param title 文档标题
   * @param diffText 文本 diff
   * @param oldOverview 旧版本总览内容（可选，帮助 LLM 理解上下文）
   * @returns 变更条目字符串数组
   */
  async extractMigration(title: string, diffText: string, oldOverview?: string): Promise<string[]> {
    if (!diffText.trim()) return []

    const formattedTime = this.formatTimestamp(new Date())
    const oldOverviewSection = oldOverview ? `旧版本总览：\n${oldOverview}\n\n` : ''

    const prompt = DOCUMENT_MIGRATION_PROMPT.replace('{{TITLE}}', title)
      .replace('{{DIFF_TEXT}}', diffText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{OLD_OVERVIEW_SECTION}}', oldOverviewSection)

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.2,
        scope: 'document_memory'
      })
      return parseMigrationText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractMigration error:', e)
      return []
    }
  }

  private formatInputText(memcell: MemCell): string {
    if (memcell.text) return memcell.text
    if (Array.isArray(memcell.original_data)) {
      return memcell.original_data
        .map((m: unknown) => {
          const msg = m as Record<string, unknown>
          const ts = msg.timestamp ? `[${msg.timestamp}] ` : ''
          const speaker = msg.role || msg.speaker || msg.speaker_name || 'Unknown'
          return `${ts}${speaker}: ${msg.content}`
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
