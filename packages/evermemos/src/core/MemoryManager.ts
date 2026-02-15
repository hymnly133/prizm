import {
  MemCell,
  BaseMemory,
  MemoryType,
  MemoryRoutingContext,
  RawDataType,
  UnifiedExtractionResult
} from '../types.js'
import { StorageAdapter } from '../storage/interfaces.js'
import { v4 as uuidv4 } from 'uuid'

import { IExtractor } from '../extractors/BaseExtractor.js'
import type { UnifiedExtractor } from '../extractors/UnifiedExtractor.js'
import type { ICompletionProvider } from '../utils/llm.js'
import { DEDUP_CONFIRM_PROMPT } from '../prompts.js'

export interface IEmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>
}

/** 去重日志条目 */
export interface DedupLogEntry {
  id: string
  kept_memory_id: string
  new_memory_content: string
  new_memory_type: string
  new_memory_metadata: string
  kept_memory_content: string
  vector_distance: number
  llm_reasoning: string
  user_id: string | null
  group_id: string | null
  created_at: string
  rolled_back: number
}

export interface MemoryManagerOptions {
  /** 启用时一次 LLM 调用完成四类记忆抽取，替代 6 次分步调用 */
  unifiedExtractor?: UnifiedExtractor
  /** 统一抽取路径下用于生成 embedding（与 unifiedExtractor 配套使用） */
  embeddingProvider?: IEmbeddingProvider
  /** 可选 LLM provider，用于语义去重二次确认；不提供时仅依赖向量距离 */
  llmProvider?: ICompletionProvider
}

/** LanceDB 只能推断简单类型，将 metadata 等复杂字段序列化为字符串 */
function toVectorRow(memory: Record<string, unknown>, vector: number[]): Record<string, unknown> {
  const { embedding: _, ...rest } = memory
  return {
    ...rest,
    vector,
    metadata:
      typeof memory.metadata === 'string' ? memory.metadata : JSON.stringify(memory.metadata ?? {})
  }
}

export class MemoryManager {
  private storage: StorageAdapter
  private extractors: Map<MemoryType, IExtractor>
  private unifiedExtractor?: UnifiedExtractor
  private embeddingProvider?: IEmbeddingProvider
  private llmProvider?: ICompletionProvider

  constructor(storage: StorageAdapter, options?: MemoryManagerOptions) {
    this.storage = storage
    this.extractors = new Map()
    this.unifiedExtractor = options?.unifiedExtractor
    this.embeddingProvider = options?.embeddingProvider
    this.llmProvider = options?.llmProvider
  }

  registerExtractor(type: MemoryType, extractor: IExtractor) {
    this.extractors.set(type, extractor)
  }

  /** 单条创建的记忆，用于按轮次汇总 */
  private createdCollector: Array<{
    id: string
    content: string
    type: string
    group_id?: string
  }> = []

  /**
   * 处理 MemCell 并按三层路由写入记忆。
   * 若配置了 unifiedExtractor，则一次 LLM 调用完成所有抽取；否则走原有分步 extractor。
   * @returns 本轮新创建的记忆列表（用于 RoundMemoryGrowth）
   */
  async processMemCell(
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): Promise<Array<{ id: string; content: string; type: string; group_id?: string }>> {
    this.createdCollector = []
    if (!memcell.event_id) memcell.event_id = uuidv4()
    if (routing) memcell.user_id = routing.userId

    const isDocument = memcell.scene === 'document'
    const isAssistant = memcell.scene !== 'group' && memcell.scene !== 'document'
    const useUnified =
      (isAssistant || isDocument) && this.unifiedExtractor && this.embeddingProvider

    if (useUnified && this.unifiedExtractor && this.embeddingProvider) {
      const unified = this.unifiedExtractor
      try {
        const result = await unified.extractAll(memcell)
        if (result) await this.saveFromUnifiedResult(memcell, result, routing)
      } catch (error) {
        console.error(
          'Unified memory extraction failed, falling back to per-type extractors:',
          error
        )
        await this.runPerTypeExtractors(isAssistant, isDocument, memcell, routing)
      }
    } else {
      await this.runPerTypeExtractors(isAssistant, isDocument, memcell, routing)
    }
    return this.createdCollector
  }

  private pushCreated(id: string, content: string, type: string, groupId?: string | null): void {
    this.createdCollector.push({
      id,
      content,
      type,
      group_id: groupId ?? undefined
    })
  }

  // ==================== 语义去重系统 ====================

  /** 需要语义去重的记忆类型 */
  private static readonly DEDUP_TYPES = new Set([
    MemoryType.EPISODIC_MEMORY,
    MemoryType.FORESIGHT
  ])

  /** L2 距离阈值：低于此值进入去重流程（cosine sim ≈ 0.90） */
  private static readonly DEDUP_L2_THRESHOLD = 0.45

  /**
   * 完整去重流程：向量匹配 → LLM 二次确认 → 记录日志 → touch。
   * @returns 已有记忆 id（去重成功），或 null（应正常插入新记忆）
   */
  private async tryDedup(
    type: MemoryType,
    embedding: number[] | undefined,
    newContent: string,
    groupId: string | undefined,
    userId: string | undefined,
    newMemorySnapshot?: Record<string, unknown>
  ): Promise<string | null> {
    if (!MemoryManager.DEDUP_TYPES.has(type)) return null
    if (!embedding || embedding.length === 0) return null

    // 1. 向量搜索候选
    const candidate = await this.findDedupCandidate(type, embedding, groupId, userId)
    if (!candidate) return null

    // 2. LLM 二次确认（若配置了 llmProvider）
    let reasoning = `vector-only (distance=${candidate.distance.toFixed(3)})`
    if (this.llmProvider) {
      try {
        const llmResult = await this.confirmDedupWithLLM(
          candidate.existingContent,
          newContent
        )
        if (!llmResult.isDuplicate) return null
        reasoning = llmResult.reasoning
      } catch (e) {
        console.warn('Dedup LLM confirmation failed, falling back to vector-only:', e)
      }
    }

    // 3. 记录去重日志（支持回退）
    await this.logDedupRecord({
      keptMemoryId: candidate.existingId,
      keptMemoryContent: candidate.existingContent,
      newMemoryContent: newContent,
      newMemoryType: type,
      newMemoryMetadata: newMemorySnapshot,
      vectorDistance: candidate.distance,
      llmReasoning: reasoning,
      userId,
      groupId
    })

    // 4. 刷新已有记忆的 updated_at
    await this.touchExistingMemory(candidate.existingId, groupId)

    return candidate.existingId
  }

  /** 向量搜索去重候选 */
  private async findDedupCandidate(
    type: MemoryType,
    embedding: number[],
    groupId: string | undefined,
    userId: string | undefined
  ): Promise<{ existingId: string; existingContent: string; distance: number } | null> {
    try {
      const filterParts: string[] = []
      if (groupId !== undefined) filterParts.push(`group_id = '${groupId}'`)
      if (userId) filterParts.push(`user_id = '${userId}'`)
      const filter = filterParts.length > 0 ? filterParts.join(' AND ') : undefined

      const results = await this.storage.vector.search(type, embedding, 1, filter)
      if (
        results.length > 0 &&
        results[0]._distance !== undefined &&
        results[0]._distance < MemoryManager.DEDUP_L2_THRESHOLD &&
        results[0].id
      ) {
        const existingContent =
          (results[0].content as string) ?? (results[0].summary as string) ?? ''
        return {
          existingId: results[0].id,
          existingContent,
          distance: results[0]._distance
        }
      }
      return null
    } catch {
      return null
    }
  }

  /** LLM 轻量级二次确认：判断两条记忆是否语义等价 */
  private async confirmDedupWithLLM(
    existingContent: string,
    newContent: string
  ): Promise<{ isDuplicate: boolean; reasoning: string }> {
    const prompt = DEDUP_CONFIRM_PROMPT
      .replace('{{EXISTING}}', existingContent.slice(0, 500))
      .replace('{{NEW}}', newContent.slice(0, 500))

    const response = await this.llmProvider!.generate({
      prompt,
      temperature: 0,
      scope: 'memory'
    })

    const line = response.trim().split('\n')[0].trim()
    const isDuplicate = line.toUpperCase().startsWith('SAME')
    return { isDuplicate, reasoning: line }
  }

  /** 写入去重日志 */
  private async logDedupRecord(info: {
    keptMemoryId: string
    keptMemoryContent: string
    newMemoryContent: string
    newMemoryType: string
    newMemoryMetadata?: Record<string, unknown>
    vectorDistance: number
    llmReasoning: string
    userId?: string
    groupId?: string
  }): Promise<void> {
    try {
      await this.storage.relational.insert('dedup_log', {
        id: uuidv4(),
        kept_memory_id: info.keptMemoryId,
        new_memory_content: info.newMemoryContent,
        new_memory_type: info.newMemoryType,
        new_memory_metadata: info.newMemoryMetadata
          ? JSON.stringify(info.newMemoryMetadata)
          : null,
        kept_memory_content: info.keptMemoryContent,
        vector_distance: info.vectorDistance,
        llm_reasoning: info.llmReasoning,
        user_id: info.userId ?? null,
        group_id: info.groupId ?? null,
        created_at: new Date().toISOString(),
        rolled_back: 0
      })
    } catch (e) {
      console.warn('Failed to write dedup log:', e)
    }
  }

  /** 刷新已有记忆的 updated_at */
  private async touchExistingMemory(id: string, groupId?: string | null): Promise<void> {
    try {
      const item: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (groupId !== undefined) item.group_id = groupId
      await this.storage.relational.update('memories', id, item)
    } catch {
      // silently ignore
    }
  }

  // ---- 去重日志公开 API ----

  /** 查询去重日志 */
  async listDedupLog(userId: string, limit = 50): Promise<DedupLogEntry[]> {
    try {
      return await this.storage.relational.query(
        'SELECT * FROM dedup_log WHERE user_id = ? AND rolled_back = 0 ORDER BY created_at DESC LIMIT ?',
        [userId, limit]
      )
    } catch {
      return []
    }
  }

  /**
   * 回退一次去重：重新插入被抑制的记忆，并标记日志为已回退。
   * @returns 被恢复的记忆 id，或 null 表示回退失败
   */
  async undoDedup(dedupLogId: string): Promise<string | null> {
    try {
      const rows = await this.storage.relational.query(
        'SELECT * FROM dedup_log WHERE id = ? AND rolled_back = 0',
        [dedupLogId]
      )
      if (rows.length === 0) return null

      const entry = rows[0] as DedupLogEntry
      const newId = uuidv4()
      const now = new Date().toISOString()

      let metadata: Record<string, unknown> = {}
      if (entry.new_memory_metadata) {
        try {
          metadata = JSON.parse(entry.new_memory_metadata)
        } catch {
          // ignore
        }
      }

      // 重新插入被抑制的记忆
      await this.storage.relational.insert('memories', {
        id: newId,
        type: entry.new_memory_type,
        content: entry.new_memory_content,
        user_id: entry.user_id,
        group_id: entry.group_id,
        created_at: now,
        updated_at: now,
        metadata: JSON.stringify({ ...metadata, id: newId, restored_from_dedup: dedupLogId })
      })

      // 恢复向量（如果 metadata 中有 embedding）
      const emb = metadata.embedding as number[] | undefined
      if (emb && Array.isArray(emb)) {
        try {
          const { embedding: _, ...rest } = metadata
          const vecRow: Record<string, unknown> = { ...rest, id: newId, vector: emb }
          vecRow.metadata = JSON.stringify(vecRow.metadata ?? {})
          await this.storage.vector.add(entry.new_memory_type, [vecRow])
        } catch {
          // vector restore is best-effort
        }
      }

      // 标记日志为已回退
      await this.storage.relational.update('dedup_log', dedupLogId, {
        rolled_back: 1,
        group_id: entry.group_id
      })

      return newId
    } catch (e) {
      console.error('Failed to undo dedup:', e)
      return null
    }
  }

  private async runPerTypeExtractors(
    isAssistant: boolean,
    isDocument: boolean,
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): Promise<void> {
    const sessionOnly = routing?.sessionOnly === true
    const skipSession = routing?.skipSessionExtraction === true

    const tasks: Promise<void>[] = []
    if (
      !sessionOnly &&
      (isAssistant || isDocument) &&
      this.extractors.has(MemoryType.EPISODIC_MEMORY)
    ) {
      tasks.push(this.extractAndSave(MemoryType.EPISODIC_MEMORY, memcell, routing))
    }
    if (!sessionOnly && isAssistant && this.extractors.has(MemoryType.FORESIGHT)) {
      tasks.push(this.extractAndSave(MemoryType.FORESIGHT, memcell, routing))
    }
    if (!skipSession && (isAssistant || isDocument) && this.extractors.has(MemoryType.EVENT_LOG)) {
      tasks.push(this.extractAndSave(MemoryType.EVENT_LOG, memcell, routing))
    }
    if (!sessionOnly && isAssistant && this.extractors.has(MemoryType.PROFILE)) {
      tasks.push(this.extractAndSave(MemoryType.PROFILE, memcell, routing))
    }
    await Promise.all(tasks)
  }

  private async saveFromUnifiedResult(
    memcell: MemCell,
    result: UnifiedExtractionResult,
    routing?: MemoryRoutingContext
  ): Promise<void> {
    const userId = routing?.userId ?? memcell.user_id
    const timestamp = memcell.timestamp || new Date().toISOString()
    const now = new Date().toISOString()
    const isAssistantScene = memcell.scene !== 'group' && memcell.scene !== 'document'
    const sessionOnly = routing?.sessionOnly === true
    const skipSession = routing?.skipSessionExtraction === true

    const roundMsgId = routing?.roundMessageId

    if (!sessionOnly && result.episode?.content) {
      const content = result.episode.content
      const summary = result.episode.summary || content.slice(0, 200)
      let embedding: number[] | undefined
      try {
        embedding = await this.embeddingProvider!.getEmbedding(summary || content)
      } catch (e) {
        console.warn('Episode embedding failed:', e)
      }
      const groupId = memcell.scene === 'document' ? `${routing!.scope}:docs` : routing?.scope

      const id = uuidv4()
      const memory = {
        id,
        memory_type: MemoryType.EPISODIC_MEMORY,
        user_id: userId,
        group_id: groupId,
        created_at: now,
        updated_at: now,
        timestamp,
        deleted: false,
        content,
        summary: result.episode.summary,
        keywords: result.episode.keywords,
        embedding,
        metadata: {
          original_data: memcell.original_data,
          ...(roundMsgId && { round_message_id: roundMsgId })
        }
      }

      // 语义去重：向量匹配 + LLM 二次确认
      const dedupId = await this.tryDedup(
        MemoryType.EPISODIC_MEMORY, embedding, content, groupId, userId, memory
      )
      if (!dedupId) {
        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.EPISODIC_MEMORY,
          content: content,
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(memory)
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.EPISODIC_MEMORY, [toVectorRow(memory, embedding)])
        }
        this.pushCreated(id, content, MemoryType.EPISODIC_MEMORY, groupId)
      }
    }

    if (!skipSession && result.event_log?.atomic_fact?.length) {
      const groupId =
        memcell.scene === 'document'
          ? `${routing!.scope}:docs`
          : routing?.sessionId
          ? `${routing.scope}:session:${routing.sessionId}`
          : routing?.scope
      for (const fact of result.event_log.atomic_fact) {
        if (typeof fact !== 'string' || !fact.trim()) continue
        const id = uuidv4()
        let embedding: number[] | undefined
        try {
          embedding = await this.embeddingProvider!.getEmbedding(fact)
        } catch (e) {
          console.warn('EventLog embedding failed:', e)
        }
        const memory = {
          id,
          memory_type: MemoryType.EVENT_LOG,
          user_id: userId,
          group_id: groupId,
          created_at: now,
          updated_at: now,
          timestamp,
          deleted: false,
          content: fact.trim(),
          event_type: 'atomic',
          embedding,
          metadata: {
            time: result.event_log.time,
            parent_type: 'memcell',
            parent_id: memcell.event_id,
            ...(roundMsgId && { round_message_id: roundMsgId })
          }
        }
        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.EVENT_LOG,
          content: fact.trim(),
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(memory)
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.EVENT_LOG, [toVectorRow(memory, embedding)])
        }
        this.pushCreated(id, fact.trim(), MemoryType.EVENT_LOG, groupId)
      }
    }

    if (!sessionOnly && isAssistantScene && result.foresight?.length) {
      const groupId = routing?.scope
      const limited = result.foresight.slice(0, 10)
      for (const item of limited) {
        if (!item.content?.trim()) continue
        let embedding: number[] | undefined
        try {
          embedding = await this.embeddingProvider!.getEmbedding(item.content)
        } catch (e) {
          console.warn('Foresight embedding failed:', e)
        }

        const id = uuidv4()
        const memory = {
          id,
          memory_type: MemoryType.FORESIGHT,
          user_id: userId,
          group_id: groupId,
          created_at: now,
          updated_at: now,
          timestamp,
          deleted: false,
          content: item.content,
          valid_start: item.start_time,
          valid_end: item.end_time,
          embedding,
          metadata: {
            evidence: item.evidence,
            duration_days: item.duration_days,
            ...(roundMsgId && { round_message_id: roundMsgId })
          }
        }

        // 语义去重：向量匹配 + LLM 二次确认
        const dedupId = await this.tryDedup(
          MemoryType.FORESIGHT, embedding, item.content, groupId, userId, memory
        )
        if (dedupId) continue

        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.FORESIGHT,
          content: item.content,
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(memory)
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.FORESIGHT, [toVectorRow(memory, embedding)])
        }
        this.pushCreated(id, item.content, MemoryType.FORESIGHT, groupId)
      }
    }

    if (!sessionOnly && isAssistantScene && result.profile?.user_profiles?.length) {
      for (const p of result.profile.user_profiles) {
        const id = uuidv4()
        const content = this.buildProfileContent(p)
        if (!content) continue
        const { user_id: _llmUserId, ...profileData } = p as Record<string, unknown>
        const memory = {
          ...profileData,
          id,
          memory_type: MemoryType.PROFILE,
          user_id: userId,
          group_id: undefined,
          created_at: now,
          updated_at: now,
          timestamp,
          deleted: false,
          content
        }
        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.PROFILE,
          content,
          user_id: userId,
          group_id: null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify({
            ...memory,
            ...(roundMsgId && { round_message_id: roundMsgId })
          })
        })
        this.pushCreated(id, content, MemoryType.PROFILE, null)
      }
    }
  }

  /**
   * 根据 memory_type 和路由上下文计算 group_id：
   * - Profile       → null（User 层，仅按 user_id 检索）
   * - Episodic      → scope（Scope 层）；document 场景 → scope:docs
   * - Foresight     → scope（Scope 层）
   * - EventLog      → scope:session:sessionId（Session 层）；document 场景 → scope:docs
   * - 其他          → memcell 原始 group_id
   */
  private resolveGroupId(
    type: MemoryType,
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): string | undefined {
    if (!routing) return memcell.group_id ?? undefined

    const isDocument = memcell.scene === 'document'

    switch (type) {
      case MemoryType.PROFILE:
        // User 层：不设 group_id
        return undefined

      case MemoryType.EPISODIC_MEMORY:
        return isDocument ? `${routing.scope}:docs` : routing.scope

      case MemoryType.FORESIGHT:
        return routing.scope

      case MemoryType.EVENT_LOG:
        if (isDocument) return `${routing.scope}:docs`
        return routing.sessionId ? `${routing.scope}:session:${routing.sessionId}` : routing.scope

      default:
        return memcell.group_id ?? routing.scope
    }
  }

  private async extractAndSave(type: MemoryType, memcell: MemCell, routing?: MemoryRoutingContext) {
    const extractor = this.extractors.get(type)
    if (!extractor) return

    const groupId = this.resolveGroupId(type, memcell, routing)

    try {
      const memories = await extractor.extract(memcell)
      if (memories && memories.length > 0) {
        for (const memory of memories) {
          if (!memory) continue
          memory.id = memory.id || uuidv4()
          memory.memory_type = type
          if (routing) {
            memory.user_id = routing.userId
          }
          memory.group_id = groupId ?? undefined
          if (routing?.roundMessageId) {
            memory.metadata = {
              ...(memory.metadata ?? {}),
              round_message_id: routing.roundMessageId
            }
          }

          const contentStr = this.getMemoryContent(memory)

          // 语义去重（仅对 Episode/Foresight，需要 embedding）
          if (memory.embedding?.length) {
            const dedupId = await this.tryDedup(
              type, memory.embedding, contentStr,
              memory.group_id, memory.user_id,
              memory as Record<string, unknown>
            )
            if (dedupId) continue
          }
          await this.storage.relational.insert('memories', {
            id: memory.id,
            type: type,
            content: contentStr,
            user_id: memory.user_id,
            group_id: memory.group_id ?? null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: JSON.stringify(memory)
          })

          if (memory.embedding) {
            await this.storage.vector.add(type, [
              toVectorRow(memory as Record<string, unknown>, memory.embedding)
            ])
          }
          this.pushCreated(memory.id, contentStr, type, memory.group_id)
        }
      }
    } catch (error) {
      console.error(`Failed to extract ${type}:`, error)
    }
  }

  /**
   * 从 profile 字段生成描述性 content（替代泛化的 "Profile update for X"）。
   * 优先使用 LLM 生成的摘要，其次从各字段拼接，确保记忆可读可搜索。
   */
  private buildProfileContent(profile: Record<string, unknown>): string {
    // 优先使用 summary（新 prompt）或 output_reasoning（旧 prompt）
    const summary = (profile.summary ?? profile.output_reasoning) as string | undefined
    if (summary?.trim()) return summary.trim()

    // 回退：从各字段拼接
    const parts: string[] = []
    const name = profile.user_name as string | undefined
    if (name) parts.push(`用户称呼: ${name}`)
    const fields: Array<[string, string]> = [
      ['hard_skills', '技能'],
      ['soft_skills', '软技能'],
      ['work_responsibility', '职责'],
      ['interests', '兴趣'],
      ['tendency', '倾向']
    ]
    for (const [key, label] of fields) {
      const val = profile[key]
      if (!val) continue
      if (Array.isArray(val) && val.length > 0) {
        const strs = val.map((v: unknown) =>
          typeof v === 'string' ? v : (v as any)?.value ?? String(v)
        )
        parts.push(`${label}: ${strs.join(', ')}`)
      } else if (typeof val === 'string' && val.trim()) {
        parts.push(`${label}: ${val}`)
      }
    }
    if (parts.length > 0) return parts.join('；')
    return ''
  }

  private getMemoryContent(memory: any): string {
    if (memory.content) return memory.content
    if (memory.summary) return memory.summary
    if (memory.foresight) return memory.foresight
    if (memory.atomic_fact)
      return Array.isArray(memory.atomic_fact) ? memory.atomic_fact.join(' ') : memory.atomic_fact
    return ''
  }

  /** 按用户列出记忆（用于管理/可视化） */
  async listMemories(user_id: string, limit = 200): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [user_id, limit]
    )
    return rows
  }

  /** 按 round_message_id 列出该轮对话新创建的记忆 */
  async listMemoriesByRoundMessageId(
    user_id: string,
    round_message_id: string,
    limit = 50
  ): Promise<any[]> {
    const rows = await this.storage.relational.query(
      `SELECT * FROM memories WHERE user_id = ? AND json_extract(metadata, '$.round_message_id') = ? ORDER BY created_at DESC LIMIT ?`,
      [user_id, round_message_id, limit]
    )
    return rows
  }

  /** 按 group_id 列出记忆 */
  async listMemoriesByGroup(user_id: string, group_id: string, limit = 200): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND group_id = ? ORDER BY created_at DESC LIMIT ?',
      [user_id, group_id, limit]
    )
    return rows
  }

  /** 按 group_id 前缀列出记忆（如 "online:" 列出 scope 下所有层级） */
  async listMemoriesByGroupPrefix(
    user_id: string,
    group_prefix: string,
    limit = 200
  ): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND (group_id = ? OR group_id LIKE ?) ORDER BY created_at DESC LIMIT ?',
      [user_id, group_prefix, `${group_prefix}:%`, limit]
    )
    return rows
  }

  /** 删除单条记忆 */
  async deleteMemory(id: string): Promise<boolean> {
    try {
      await this.storage.relational.delete('memories', id)
      return true
    } catch {
      return false
    }
  }

  /** 按 group_id 批量删除记忆（用于 session/scope 生命周期管理） */
  async deleteMemoriesByGroupId(group_id: string): Promise<number> {
    try {
      const rows = await this.storage.relational.query(
        'SELECT id FROM memories WHERE group_id = ?',
        [group_id]
      )
      for (const row of rows) {
        await this.storage.relational.delete('memories', row.id)
      }
      return rows.length
    } catch {
      return 0
    }
  }

  /** 按 group_id 前缀批量删除（用于删除 scope 下所有层级记忆） */
  async deleteMemoriesByGroupPrefix(group_prefix: string): Promise<number> {
    try {
      const rows = await this.storage.relational.query(
        'SELECT id FROM memories WHERE group_id = ? OR group_id LIKE ?',
        [group_prefix, `${group_prefix}:%`]
      )
      for (const row of rows) {
        await this.storage.relational.delete('memories', row.id)
      }
      return rows.length
    } catch {
      return 0
    }
  }
}
