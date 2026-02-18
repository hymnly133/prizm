import { MemCell, UnifiedExtractionResult } from '../types.js'
import { ICompletionProvider } from '../utils/llm.js'
import {
  DOCUMENT_MEMORY_EXTRACTION_PROMPT,
  DOCUMENT_MIGRATION_PROMPT,
  PER_ROUND_EXTRACTION_PROMPT,
  NARRATIVE_BATCH_EXTRACTION_PROMPT
} from '../prompts.js'
import { parseUnifiedMemoryText, parseMigrationText } from './unifiedMemoryParser.js'

/**
 * LLM 记忆抽取器。
 *
 * 三条管线：
 *  - extractDocument：文档记忆（overview + facts）
 *  - extractPerRound（Pipeline 1）：每轮轻量抽取（event_log / profile / foresight）
 *  - extractNarrativeBatch（Pipeline 2）：阈值触发叙述性批量抽取（narrative / profile / foresight）
 *
 * 不负责 embedding 与落库，由 MemoryManager 根据结果统一写库。
 */
export class UnifiedExtractor {
  private llmProvider: ICompletionProvider

  constructor(llmProvider: ICompletionProvider) {
    this.llmProvider = llmProvider
  }

  /**
   * 文档记忆抽取：overview + facts。
   */
  async extractDocument(memcell: MemCell): Promise<UnifiedExtractionResult | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)
    const title = (memcell.metadata as Record<string, unknown>)?.title as string | undefined

    const prompt = DOCUMENT_MEMORY_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{TITLE}}', title || '未命名文档')

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.2,
        operationTag: 'memory:document_extract'
      })
      return parseUnifiedMemoryText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractDocument error:', e)
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
        operationTag: 'memory:document_migration'
      })
      return parseMigrationText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractMigration error:', e)
      return []
    }
  }

  /**
   * Pipeline 1：每轮轻量抽取（event_log / profile / foresight，不含 narrative）。
   */
  async extractPerRound(
    memcell: MemCell,
    existingProfileSummary?: string
  ): Promise<UnifiedExtractionResult | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)

    let prompt = PER_ROUND_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
      '{{TIME}}',
      formattedTime
    )
    prompt = prompt.replace('{{EXISTING_PROFILE}}', existingProfileSummary || '无')

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.2,
        operationTag: 'memory:per_round_extract'
      })
      return parseUnifiedMemoryText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractPerRound error:', e)
      return null
    }
  }

  /**
   * Pipeline 2：阈值触发的叙述性批量抽取（narrative / foresight / profile）。
   * @param memcell 多轮累积的消息合成的 MemCell
   * @param existingProfileSummary 已有画像摘要
   * @param alreadyExtractedContext Pipeline 1 已提取的记忆摘要文本（event_log / profile / foresight）
   */
  async extractNarrativeBatch(
    memcell: MemCell,
    existingProfileSummary?: string,
    alreadyExtractedContext?: string
  ): Promise<UnifiedExtractionResult | null> {
    const inputText = this.formatInputText(memcell)
    if (!inputText) return null

    const timestamp = memcell.timestamp || new Date().toISOString()
    const formattedTime = this.formatTimestamp(timestamp)

    let prompt = NARRATIVE_BATCH_EXTRACTION_PROMPT.replace('{{INPUT_TEXT}}', inputText).replace(
      '{{TIME}}',
      formattedTime
    )
    prompt = prompt.replace('{{EXISTING_PROFILE}}', existingProfileSummary || '无')
    prompt = prompt.replace(
      '{{ALREADY_EXTRACTED}}',
      alreadyExtractedContext || '无（这是首次批量抽取）'
    )

    try {
      const response = await this.llmProvider.generate({
        prompt,
        temperature: 0.3,
        operationTag: 'memory:narrative_batch_extract'
      })
      return parseUnifiedMemoryText(response)
    } catch (e) {
      console.error('UnifiedExtractor extractNarrativeBatch error:', e)
      return null
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
