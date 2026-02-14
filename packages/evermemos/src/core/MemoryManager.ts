import { MemCell, BaseMemory, MemoryType, MemoryRoutingContext, RawDataType } from '../types.js'
import { StorageAdapter } from '../storage/interfaces.js'
import { v4 as uuidv4 } from 'uuid'

import { IExtractor } from '../extractors/BaseExtractor.js'

export class MemoryManager {
  private storage: StorageAdapter
  private extractors: Map<MemoryType, IExtractor>

  constructor(storage: StorageAdapter) {
    this.storage = storage
    this.extractors = new Map()
  }

  registerExtractor(type: MemoryType, extractor: IExtractor) {
    this.extractors.set(type, extractor)
  }

  /**
   * 处理 MemCell 并按三层路由写入记忆。
   * @param memcell  原始数据单元
   * @param routing  三层路由上下文（userId / scope / sessionId）
   */
  async processMemCell(memcell: MemCell, routing?: MemoryRoutingContext): Promise<void> {
    // 1. Assign ID if missing
    if (!memcell.event_id) {
      memcell.event_id = uuidv4()
    }

    // 确保 memcell.user_id 使用路由中的真实 userId
    if (routing) {
      memcell.user_id = routing.userId
    }

    const tasks: Promise<void>[] = []
    const isDocument = memcell.scene === 'document'
    const isAssistant = memcell.scene !== 'group' && memcell.scene !== 'document'

    // Episode: assistant 和 document 场景均抽取
    if ((isAssistant || isDocument) && this.extractors.has(MemoryType.EPISODIC_MEMORY)) {
      tasks.push(this.extractAndSave(MemoryType.EPISODIC_MEMORY, memcell, routing))
    }

    // Foresight: 仅 assistant 场景
    if (isAssistant && this.extractors.has(MemoryType.FORESIGHT)) {
      tasks.push(this.extractAndSave(MemoryType.FORESIGHT, memcell, routing))
    }

    // EventLog: assistant 和 document 场景
    if ((isAssistant || isDocument) && this.extractors.has(MemoryType.EVENT_LOG)) {
      tasks.push(this.extractAndSave(MemoryType.EVENT_LOG, memcell, routing))
    }

    // Profile: 仅 assistant 场景
    if (isAssistant && this.extractors.has(MemoryType.PROFILE)) {
      tasks.push(this.extractAndSave(MemoryType.PROFILE, memcell, routing))
    }

    await Promise.all(tasks)
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

          // Save metadata to SQLite
          await this.storage.relational.insert('memories', {
            id: memory.id,
            type: type,
            content: this.getMemoryContent(memory),
            user_id: memory.user_id,
            group_id: memory.group_id ?? null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: JSON.stringify(memory)
          })

          // Save embedding to Vector Store if available
          if (memory.embedding) {
            await this.storage.vector.add(type, [
              {
                id: memory.id,
                vector: memory.embedding,
                ...memory
              }
            ])
          }
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
