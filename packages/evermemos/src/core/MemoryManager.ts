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

export interface IEmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>
}

export interface MemoryManagerOptions {
  /** 启用时一次 LLM 调用完成四类记忆抽取，替代 6 次分步调用 */
  unifiedExtractor?: UnifiedExtractor
  /** 统一抽取路径下用于生成 embedding（与 unifiedExtractor 配套使用） */
  embeddingProvider?: IEmbeddingProvider
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

  constructor(storage: StorageAdapter, options?: MemoryManagerOptions) {
    this.storage = storage
    this.extractors = new Map()
    this.unifiedExtractor = options?.unifiedExtractor
    this.embeddingProvider = options?.embeddingProvider
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

  private async runPerTypeExtractors(
    isAssistant: boolean,
    isDocument: boolean,
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): Promise<void> {
    const tasks: Promise<void>[] = []
    if ((isAssistant || isDocument) && this.extractors.has(MemoryType.EPISODIC_MEMORY)) {
      tasks.push(this.extractAndSave(MemoryType.EPISODIC_MEMORY, memcell, routing))
    }
    if (isAssistant && this.extractors.has(MemoryType.FORESIGHT)) {
      tasks.push(this.extractAndSave(MemoryType.FORESIGHT, memcell, routing))
    }
    if ((isAssistant || isDocument) && this.extractors.has(MemoryType.EVENT_LOG)) {
      tasks.push(this.extractAndSave(MemoryType.EVENT_LOG, memcell, routing))
    }
    if (isAssistant && this.extractors.has(MemoryType.PROFILE)) {
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

    const roundMsgId = routing?.roundMessageId

    if (result.episode?.content) {
      const id = uuidv4()
      const content = result.episode.content
      const summary = result.episode.summary || content.slice(0, 200)
      let embedding: number[] | undefined
      try {
        embedding = await this.embeddingProvider!.getEmbedding(summary || content)
      } catch (e) {
        console.warn('Episode embedding failed:', e)
      }
      const groupId = memcell.scene === 'document' ? `${routing!.scope}:docs` : routing?.scope
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

    if (result.event_log?.atomic_fact?.length) {
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

    if (isAssistantScene && result.foresight?.length) {
      const groupId = routing?.scope
      const limited = result.foresight.slice(0, 10)
      for (const item of limited) {
        if (!item.content?.trim()) continue
        const id = uuidv4()
        let embedding: number[] | undefined
        try {
          embedding = await this.embeddingProvider!.getEmbedding(item.content)
        } catch (e) {
          console.warn('Foresight embedding failed:', e)
        }
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

    if (isAssistantScene && result.profile?.user_profiles?.length) {
      for (const p of result.profile.user_profiles) {
        if (!p.user_id) continue
        const id = uuidv4()
        const content = 'Profile update for ' + (p.user_name || p.user_id)
        const memory = {
          id,
          memory_type: MemoryType.PROFILE,
          user_id: p.user_id,
          group_id: undefined,
          created_at: now,
          updated_at: now,
          timestamp,
          deleted: false,
          content,
          ...p
        }
        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.PROFILE,
          content,
          user_id: p.user_id,
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
          // 设置路由后的 user_id / group_id
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
