import { MemCell, UnifiedExtractionResult } from '../types.js'
import { ICompletionProvider } from '../utils/llm.js'
import {
  DOCUMENT_EXTRACT_SYSTEM,
  DOCUMENT_EXTRACT_USER_TEMPLATE,
  DOCUMENT_MIGRATION_SYSTEM,
  DOCUMENT_MIGRATION_USER_TEMPLATE,
  PER_ROUND_SYSTEM,
  PER_ROUND_USER_TEMPLATE,
  NARRATIVE_BATCH_SYSTEM,
  NARRATIVE_BATCH_USER_TEMPLATE
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
 *
 * Prompt Cache 优化：每个管线使用 systemPrompt（稳定指令）+ prompt（动态数据）
 * 两段式调用，使 API 前缀缓存可命中 system 部分。
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

    const userPrompt = DOCUMENT_EXTRACT_USER_TEMPLATE
      .replace('{{INPUT_TEXT}}', inputText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{TITLE}}', title || '未命名文档')

    try {
      const response = await this.llmProvider.generate({
        systemPrompt: DOCUMENT_EXTRACT_SYSTEM,
        prompt: userPrompt,
        temperature: 0.2,
        cacheKey: 'prizm:memory:doc_extract',
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
   */
  async extractMigration(title: string, diffText: string, oldOverview?: string): Promise<string[]> {
    if (!diffText.trim()) return []

    const formattedTime = this.formatTimestamp(new Date())
    const oldOverviewSection = oldOverview ? `旧版本总览：\n${oldOverview}\n\n` : ''

    const userPrompt = DOCUMENT_MIGRATION_USER_TEMPLATE
      .replace('{{TITLE}}', title)
      .replace('{{DIFF_TEXT}}', diffText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{OLD_OVERVIEW_SECTION}}', oldOverviewSection)

    try {
      const response = await this.llmProvider.generate({
        systemPrompt: DOCUMENT_MIGRATION_SYSTEM,
        prompt: userPrompt,
        temperature: 0.2,
        cacheKey: 'prizm:memory:doc_migration',
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

    const userPrompt = PER_ROUND_USER_TEMPLATE
      .replace('{{INPUT_TEXT}}', inputText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{EXISTING_PROFILE}}', existingProfileSummary || '无')

    try {
      const response = await this.llmProvider.generate({
        systemPrompt: PER_ROUND_SYSTEM,
        prompt: userPrompt,
        temperature: 0.2,
        cacheKey: 'prizm:memory:per_round',
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

    const userPrompt = NARRATIVE_BATCH_USER_TEMPLATE
      .replace('{{INPUT_TEXT}}', inputText)
      .replace('{{TIME}}', formattedTime)
      .replace('{{EXISTING_PROFILE}}', existingProfileSummary || '无')
      .replace(
        '{{ALREADY_EXTRACTED}}',
        alreadyExtractedContext || '无（这是首次批量抽取）'
      )

    try {
      const response = await this.llmProvider.generate({
        systemPrompt: NARRATIVE_BATCH_SYSTEM,
        prompt: userPrompt,
        temperature: 0.3,
        cacheKey: 'prizm:memory:narrative_batch',
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
