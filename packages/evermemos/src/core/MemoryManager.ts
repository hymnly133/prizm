import {
  MemCell,
  BaseMemory,
  MemoryType,
  MemoryLayer,
  MemoryRoutingContext,
  MemorySourceType,
  DocumentSubType,
  RawDataType,
  UnifiedExtractionResult,
  NarrativeItem,
  ScopeMemoryType,
  UserMemoryType,
  SessionMemoryType,
  getLayerForType,
  USER_GROUP_ID,
  DEFAULT_USER_ID
} from '../types.js'
import { StorageAdapter } from '../storage/interfaces.js'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'node:crypto'

import type { UnifiedExtractor } from '../extractors/UnifiedExtractor.js'
import type { ICompletionProvider } from '../utils/llm.js'
import { DEDUP_CONFIRM_PROMPT } from '../prompts.js'
import { mergeProfilesSimple, mergeProfilesWithLLM } from '../utils/profileMerger.js'
import { Jieba } from '@node-rs/jieba'

const jieba = new Jieba()

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
  /** 文本相似度分数 (0~1)，-1 表示未使用文本匹配 */
  text_similarity: number
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

/**
 * 构造 LanceDB 向量行。
 * 只存搜索/过滤所需的最小字段集，不冗余存储 SQLite 已有的元信息。
 * LanceDB 列：id, content, user_id, group_id, vector
 */
function toVectorRow(
  id: string,
  content: string,
  userId: string | undefined | null,
  groupId: string | undefined | null,
  vector: number[]
): Record<string, unknown> {
  return {
    id,
    content: content ?? '',
    user_id: userId ?? null,
    group_id: groupId ?? null,
    vector
  }
}

export class MemoryManager {
  /** 存储适配器（SQLite + LanceDB），暴露为 public 以便外部直接写入已抽取的记忆 */
  public readonly storage: StorageAdapter
  private unifiedExtractor?: UnifiedExtractor
  private embeddingProvider?: IEmbeddingProvider
  private llmProvider?: ICompletionProvider

  constructor(storage: StorageAdapter, options?: MemoryManagerOptions) {
    this.storage = storage
    this.unifiedExtractor = options?.unifiedExtractor
    this.embeddingProvider = options?.embeddingProvider
    this.llmProvider = options?.llmProvider
  }

  /** 单条创建的记忆，用于按轮次汇总 */
  private createdCollector: Array<{
    id: string
    content: string
    type: string
    group_id?: string
  }> = []

  /** Content hash 去重缓存：hash → timestamp，防止相同内容短时间内重复提取 */
  private _recentContentHashes = new Map<string, number>()
  private static readonly CONTENT_HASH_TTL = 5 * 60 * 1000

  /** 计算 MemCell 的内容摘要 hash（用于幂等性检查） */
  private computeContentHash(memcell: MemCell): string {
    let raw: string
    if (memcell.text) {
      raw = memcell.text
    } else if (Array.isArray(memcell.original_data)) {
      raw = memcell.original_data
        .map((m: unknown) => {
          const msg = m as Record<string, unknown>
          return `${msg.role}:${msg.content}`
        })
        .join('\n')
    } else if (typeof memcell.original_data === 'object' && memcell.original_data) {
      raw = JSON.stringify(memcell.original_data)
    } else {
      raw = String(memcell.original_data ?? '')
    }
    return createHash('sha256').update(raw).digest('hex').slice(0, 16)
  }

  /**
   * 处理文档 MemCell：一次 LLM 调用抽取 overview + facts。
   * 对话场景请使用 processPerRound / processNarrativeBatch。
   * @returns 本轮新创建的记忆列表
   */
  async processDocumentMemCell(
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): Promise<Array<{ id: string; content: string; type: string; group_id?: string }>> {
    this.createdCollector = []
    if (!memcell.event_id) memcell.event_id = uuidv4()
    if (routing) memcell.user_id = routing.userId ?? DEFAULT_USER_ID
    if (!memcell.user_id) memcell.user_id = DEFAULT_USER_ID

    const contentHash = this.computeContentHash(memcell)
    const now = Date.now()
    for (const [k, t] of this._recentContentHashes) {
      if (now - t > MemoryManager.CONTENT_HASH_TTL) this._recentContentHashes.delete(k)
    }
    if (this._recentContentHashes.has(contentHash)) {
      console.warn('[MemoryManager] Skipping duplicate content extraction, hash:', contentHash)
      return []
    }
    this._recentContentHashes.set(contentHash, now)

    if (!this.unifiedExtractor || !this.embeddingProvider) {
      console.warn(
        '[MemoryManager] processDocumentMemCell requires unifiedExtractor + embeddingProvider'
      )
      return []
    }

    try {
      const result = await this.unifiedExtractor.extractDocument(memcell)
      if (result) await this.saveFromUnifiedResult(memcell, result, routing)
    } catch (error) {
      console.error('Document memory extraction failed:', error)
    }
    return this.createdCollector
  }

  /**
   * Pipeline 1：每轮轻量抽取（event_log / profile / foresight）。
   * 使用 extractPerRound prompt，仅提取轻量记忆，不含 narrative。
   * @returns 本轮新创建的记忆列表
   */
  async processPerRound(
    memcell: MemCell,
    routing: MemoryRoutingContext
  ): Promise<Array<{ id: string; content: string; type: string; group_id?: string }>> {
    this.createdCollector = []
    if (!memcell.event_id) memcell.event_id = uuidv4()
    memcell.user_id = routing.userId ?? DEFAULT_USER_ID

    if (!this.unifiedExtractor || !this.embeddingProvider) {
      console.warn('[MemoryManager] processPerRound requires unifiedExtractor + embeddingProvider')
      return []
    }

    try {
      let existingProfileSummary: string | undefined
      try {
        existingProfileSummary = await this.getExistingProfileSummary(memcell.user_id!)
      } catch {
        // 查询失败不阻塞抽取
      }

      const result = await this.unifiedExtractor.extractPerRound(memcell, existingProfileSummary)
      if (result) {
        // Pipeline 1 使用 source_round_id（单轮引用）
        await this.saveFromUnifiedResult(memcell, result, routing)
      }
    } catch (error) {
      console.error('Pipeline 1 (per-round) extraction failed:', error)
    }

    return this.createdCollector
  }

  /**
   * Pipeline 2：阈值触发的叙述性批量抽取（narrative / foresight / profile）。
   * @param memcell 多轮累积消息合成的 MemCell
   * @param routing 路由上下文（roundMessageIds 包含所有累积轮次的 ID）
   * @param alreadyExtractedContext Pipeline 1 已提取的记忆摘要文本
   * @returns 本轮新创建的记忆列表
   */
  async processNarrativeBatch(
    memcell: MemCell,
    routing: MemoryRoutingContext,
    alreadyExtractedContext?: string
  ): Promise<Array<{ id: string; content: string; type: string; group_id?: string }>> {
    this.createdCollector = []
    if (!memcell.event_id) memcell.event_id = uuidv4()
    memcell.user_id = routing.userId ?? DEFAULT_USER_ID

    if (!this.unifiedExtractor || !this.embeddingProvider) {
      console.warn(
        '[MemoryManager] processNarrativeBatch requires unifiedExtractor + embeddingProvider'
      )
      return []
    }

    const userId = routing.userId ?? memcell.user_id ?? DEFAULT_USER_ID
    const now = new Date().toISOString()
    const sourceType = routing.sourceType ?? MemorySourceType.CONVERSATION
    const sourceSessionId = routing.sessionId
    const sourceRoundIds = routing.roundMessageIds

    try {
      let existingProfileSummary: string | undefined
      try {
        existingProfileSummary = await this.getExistingProfileSummary(userId)
      } catch {
        // 查询失败不阻塞抽取
      }

      const result = await this.unifiedExtractor.extractNarrativeBatch(
        memcell,
        existingProfileSummary,
        alreadyExtractedContext
      )
      if (!result) return []

      // 序列化 source_round_ids 为 JSON 字符串
      const sourceRoundIdsJson = sourceRoundIds?.length ? JSON.stringify(sourceRoundIds) : null

      // ── 存储多条 narrative ──
      const narrativeItems: NarrativeItem[] = result.narratives?.length
        ? result.narratives
        : result.narrative
        ? [result.narrative]
        : []

      for (const narrative of narrativeItems) {
        if (!narrative.content?.trim()) continue
        const content = narrative.content
        const summary = narrative.summary || content.slice(0, 200)
        const groupId = routing.scope

        let embedding: number[] | undefined
        try {
          embedding = await this.embeddingProvider!.getEmbedding(summary || content)
        } catch (e) {
          console.warn('Narrative (batch) embedding failed:', e)
        }

        const narrativeMeta: Record<string, unknown> = {
          summary: narrative.summary
        }

        const dedupId = await this.tryDedup(
          MemoryType.NARRATIVE,
          embedding,
          content,
          groupId,
          userId,
          narrativeMeta
        )
        if (dedupId) continue

        const id = uuidv4()
        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.NARRATIVE,
          content,
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(narrativeMeta),
          source_type: sourceType,
          source_session_id: sourceSessionId ?? null,
          source_round_id: null,
          source_round_ids: sourceRoundIdsJson
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.NARRATIVE, [
            toVectorRow(id, content, userId, groupId, embedding)
          ])
        }
        this.pushCreated(id, content, MemoryType.NARRATIVE, groupId)
      }

      // ── 存储 foresight（Pipeline 2 的更深层前瞻） ──
      if (result.foresight?.length) {
        const groupId = routing.scope
        for (const item of result.foresight.slice(0, 10)) {
          if (!item.content?.trim()) continue
          let embedding: number[] | undefined
          try {
            embedding = await this.embeddingProvider!.getEmbedding(item.content)
          } catch (e) {
            console.warn('Foresight (batch) embedding failed:', e)
          }

          const foresightMeta: Record<string, unknown> = {
            evidence: item.evidence
          }

          const dedupId = await this.tryDedup(
            MemoryType.FORESIGHT,
            embedding,
            item.content,
            groupId,
            userId,
            foresightMeta
          )
          if (dedupId) continue

          const id = uuidv4()
          await this.storage.relational.insert('memories', {
            id,
            type: MemoryType.FORESIGHT,
            content: item.content,
            user_id: userId,
            group_id: groupId ?? null,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify(foresightMeta),
            source_type: sourceType,
            source_session_id: sourceSessionId ?? null,
            source_round_id: null,
            source_round_ids: sourceRoundIdsJson
          })
          if (embedding?.length) {
            await this.storage.vector.add(MemoryType.FORESIGHT, [
              toVectorRow(id, item.content, userId, groupId, embedding)
            ])
          }
          this.pushCreated(id, item.content, MemoryType.FORESIGHT, groupId)
        }
      }

      // ── 存储 profile（Pipeline 2 的深层画像） ──
      if (result.profile?.user_profiles?.length) {
        for (const p of result.profile.user_profiles) {
          const profileData = p as Record<string, unknown>
          const incomingContent = this.buildProfileContent(profileData)
          if (!incomingContent) continue

          const existingRows = await this.storage.relational.query(
            'SELECT * FROM memories WHERE type = ? AND user_id = ? AND group_id = ? ORDER BY updated_at DESC LIMIT 1',
            [MemoryType.PROFILE, userId, USER_GROUP_ID]
          )

          if (existingRows.length > 0) {
            const existing = existingRows[0]
            let existingMeta: Record<string, unknown> = {}
            try {
              existingMeta =
                typeof existing.metadata === 'string'
                  ? JSON.parse(existing.metadata)
                  : existing.metadata ?? {}
            } catch {
              existingMeta = {}
            }

            const quickCheck = mergeProfilesSimple(existingMeta, profileData)
            if (!quickCheck.hasChanges) continue

            let mergeResult = quickCheck
            if (this.llmProvider) {
              try {
                mergeResult = await mergeProfilesWithLLM(
                  existingMeta,
                  profileData,
                  this.llmProvider
                )
              } catch {
                // fallback to simple merge
              }
            }
            if (!mergeResult.hasChanges) continue

            const mergedContent = this.buildProfileContent(mergeResult.merged)
            const finalContent = mergedContent || incomingContent

            let embedding: number[] | undefined
            try {
              embedding = await this.embeddingProvider!.getEmbedding(finalContent)
            } catch (e) {
              console.warn('Profile (batch) embedding failed:', e)
            }

            const updatedMeta: Record<string, unknown> = {
              items: mergeResult.merged.items,
              merge_history: [
                ...((existingMeta.merge_history as string[]) ?? []),
                `${now}: ${mergeResult.changesSummary}`
              ].slice(-20)
            }

            await this.storage.relational.update('memories', existing.id, {
              content: finalContent,
              updated_at: now,
              metadata: JSON.stringify(updatedMeta),
              source_type: sourceType,
              source_session_id: sourceSessionId ?? null,
              source_round_ids: sourceRoundIdsJson
            })

            if (embedding?.length) {
              try {
                await this.storage.vector.delete(MemoryType.PROFILE, existing.id)
              } catch {
                /* 可能不存在 */
              }
              await this.storage.vector.add(MemoryType.PROFILE, [
                toVectorRow(existing.id, finalContent, userId, null, embedding)
              ])
            }
            this.pushCreated(existing.id, finalContent, MemoryType.PROFILE, null)
          } else {
            const id = uuidv4()
            let embedding: number[] | undefined
            try {
              embedding = await this.embeddingProvider!.getEmbedding(incomingContent)
            } catch (e) {
              console.warn('Profile (batch) embedding failed:', e)
            }

            const meta: Record<string, unknown> = { items: profileData.items }
            await this.storage.relational.insert('memories', {
              id,
              type: MemoryType.PROFILE,
              content: incomingContent,
              user_id: userId,
              group_id: USER_GROUP_ID,
              created_at: now,
              updated_at: now,
              metadata: JSON.stringify(meta),
              source_type: sourceType,
              source_session_id: sourceSessionId ?? null,
              source_round_ids: sourceRoundIdsJson
            })
            if (embedding?.length) {
              await this.storage.vector.add(MemoryType.PROFILE, [
                toVectorRow(id, incomingContent, userId, USER_GROUP_ID, embedding)
              ])
            }
            this.pushCreated(id, incomingContent, MemoryType.PROFILE, USER_GROUP_ID)
          }
        }
      }
    } catch (error) {
      console.error('Pipeline 2 (narrative-batch) extraction failed:', error)
    }

    return this.createdCollector
  }

  /**
   * 按 source_round_ids（JSON 数组列）查找关联记忆，用于反向查询（轮次 → 记忆）。
   * 查询条件：source_round_id = roundId OR source_round_ids LIKE '%"roundId"%'
   */
  async listMemoriesByRoundId(
    roundId: string,
    userId = DEFAULT_USER_ID,
    limit = 50
  ): Promise<any[]> {
    return this.storage.relational.query(
      `SELECT * FROM memories WHERE user_id = ? AND (source_round_id = ? OR source_round_ids LIKE ?) ORDER BY created_at DESC LIMIT ?`,
      [userId, roundId, `%"${roundId}"%`, limit]
    )
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

  /** 需要语义去重的记忆类型（Profile 使用增量合并而非去重） */
  private static readonly DEDUP_TYPES = new Set([MemoryType.NARRATIVE, MemoryType.FORESIGHT])

  /** L2 距离阈值：低于此值进入去重流程（cosine sim ≈ 0.90） */
  private static readonly DEDUP_L2_THRESHOLD = 0.45

  /** 文本相似度阈值：高于此值进入 LLM 确认流程（LLM 不可用时作为自动去重阈值） */
  private static readonly TEXT_DEDUP_THRESHOLD = 0.5

  /**
   * 完整去重流程：文本匹配 → 向量匹配 → LLM 二次确认 → 记录日志 → touch。
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
    if (!MemoryManager.DEDUP_TYPES.has(type)) {
      console.log(`[Dedup] Skipped: type=${type} not in DEDUP_TYPES`)
      return null
    }

    console.log(`[Dedup] Checking type=${type}, content="${newContent.slice(0, 80)}"`)

    // ── 阶段 0：并行收集文本候选 + 向量候选 ──
    const [textCandidate, vectorCandidate] = await Promise.all([
      this.findDedupCandidateByText(type, newContent, groupId, userId),
      embedding?.length
        ? this.findDedupCandidate(type, embedding, groupId, userId)
        : Promise.resolve(null)
    ])

    // 保留双分数原始值
    const textSim = textCandidate?.similarity ?? -1
    const vectorDist = vectorCandidate?.distance ?? -1

    // 将向量 L2 距离归一化为 0~1 相似度分数（距离越小 → 分数越高）
    const vectorSimNorm = vectorCandidate
      ? 1 - vectorCandidate.distance / MemoryManager.DEDUP_L2_THRESHOLD
      : -1

    // 选择归一化分数最高的候选
    const useText = textCandidate != null && (vectorSimNorm <= 0 || textSim >= vectorSimNorm)
    const candidate = useText
      ? {
          existingId: textCandidate!.existingId,
          existingContent: textCandidate!.existingContent,
          source: 'text' as const
        }
      : vectorCandidate
      ? {
          existingId: vectorCandidate.existingId,
          existingContent: vectorCandidate.existingContent,
          source: 'vector' as const
        }
      : null

    if (!candidate) {
      console.log(`[Dedup] No candidate found, will insert new memory`)
      return null
    }

    const detail = `text-sim=${textSim >= 0 ? textSim.toFixed(3) : 'N/A'}, vector-dist=${
      vectorDist >= 0 ? vectorDist.toFixed(3) : 'N/A'
    }, chosen=${candidate.source}`
    console.log(`[Dedup] Best candidate: ${detail}`)

    // ── 阶段 1：LLM 确认（必须） ──
    let reasoning = detail
    if (this.llmProvider) {
      try {
        const llmResult = await this.confirmDedupWithLLM(candidate.existingContent, newContent)
        if (!llmResult.isDuplicate) {
          console.log(`[Dedup] Candidate (${detail}) rejected by LLM: ${llmResult.reasoning}`)
          return null
        }
        reasoning = `${detail}, ${llmResult.reasoning}`
      } catch (e) {
        console.warn('[Dedup] LLM confirmation failed, falling back to similarity-only:', e)
        reasoning = `${detail}, llm-fallback`
      }
    } else {
      reasoning = `${detail}, no-llm`
    }

    console.log(
      `[Dedup] ✓ Deduped! kept="${candidate.existingContent.slice(0, 60)}" (id=${
        candidate.existingId
      }), suppressed="${newContent.slice(0, 60)}", reason="${reasoning}"`
    )
    await this.logDedupRecord({
      keptMemoryId: candidate.existingId,
      keptMemoryContent: candidate.existingContent,
      newMemoryContent: newContent,
      newMemoryType: type,
      newMemoryMetadata: newMemorySnapshot,
      vectorDistance: vectorDist,
      textSimilarity: textSim,
      llmReasoning: reasoning,
      userId,
      groupId
    })
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
      if (results.length > 0 && results[0]._distance !== undefined) {
        console.log(
          `[Dedup] Vector search for ${type}: top1 distance=${results[0]._distance.toFixed(
            4
          )}, threshold=${MemoryManager.DEDUP_L2_THRESHOLD}, id=${results[0].id}, content="${
            (results[0].content as string)?.slice(0, 60) ?? ''
          }"`
        )
      } else {
        console.log(`[Dedup] Vector search for ${type}: no results (filter=${filter ?? 'none'})`)
      }
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
    } catch (e) {
      console.warn(`[Dedup] Vector search failed for ${type}:`, e)
      return null
    }
  }

  /**
   * 基于文本相似度的去重候选搜索（语言无关 + 中文增强）。
   * 从关系型 DB 中查询同类型记忆，用 max(Dice 系数, jieba Jaccard) 匹配。
   * - Dice 系数（字符 bigram）：语言无关，保序，对任意语言有效
   * - jieba Jaccard（分词 token）：中文语义增强
   * 对 mock embedding（所有值相同）场景下的去重尤为关键。
   */
  private async findDedupCandidateByText(
    type: MemoryType,
    newContent: string,
    groupId: string | undefined,
    userId: string | undefined
  ): Promise<{
    existingId: string
    existingContent: string
    similarity: number
  } | null> {
    try {
      const conditions: string[] = ['type = ?']
      const params: (string | number)[] = [type]

      if (userId) {
        conditions.push('user_id = ?')
        params.push(userId)
      }
      if (groupId !== undefined) {
        conditions.push('group_id = ?')
        params.push(groupId)
      } else if (type === MemoryType.PROFILE) {
        conditions.push('group_id = ?')
        params.push(USER_GROUP_ID)
      }

      const sql = `SELECT id, content FROM memories WHERE ${conditions.join(
        ' AND '
      )} ORDER BY updated_at DESC LIMIT 100`
      const rows: Array<{ id: string; content: string }> = await this.storage.relational.query(
        sql,
        params
      )
      if (rows.length === 0) return null

      const newNorm = normalizeForDedup(newContent)
      if (newNorm.length === 0) return null

      const newBigrams = buildBigrams(newNorm)
      const newTokens = tokenizeForDedup(newContent)

      let bestMatch: { existingId: string; existingContent: string; similarity: number } | null =
        null

      for (const row of rows) {
        const existingContent = row.content ?? ''
        if (!existingContent) continue

        const existingNorm = normalizeForDedup(existingContent)
        if (existingNorm.length === 0) continue

        // 语言无关：Dice coefficient（字符 bigram）
        const dice = diceCoefficientFromBigrams(newBigrams, buildBigrams(existingNorm))

        // 中文增强：jieba token Jaccard（非中文场景 token 数可能为 0，此时退化为纯 Dice）
        const existingTokens = tokenizeForDedup(existingContent)
        const jaccard =
          newTokens.size > 0 && existingTokens.size > 0
            ? jaccardSimilarity(newTokens, existingTokens)
            : 0

        const sim = Math.max(dice, jaccard)
        if (
          sim >= MemoryManager.TEXT_DEDUP_THRESHOLD &&
          (!bestMatch || sim > bestMatch.similarity)
        ) {
          bestMatch = { existingId: row.id, existingContent, similarity: sim }
        }
      }

      if (bestMatch) {
        console.log(
          `[Dedup] Text search for ${type}: best match sim=${bestMatch.similarity.toFixed(3)}, id=${
            bestMatch.existingId
          }, content="${bestMatch.existingContent.slice(0, 60)}"`
        )
      } else {
        console.log(`[Dedup] Text search for ${type}: no match above threshold`)
      }

      return bestMatch
    } catch (e) {
      console.warn(`[Dedup] Text search failed for ${type}:`, e)
      return null
    }
  }

  /** LLM 轻量级二次确认：判断两条记忆是否语义等价 */
  private async confirmDedupWithLLM(
    existingContent: string,
    newContent: string
  ): Promise<{ isDuplicate: boolean; reasoning: string }> {
    const prompt = DEDUP_CONFIRM_PROMPT.replace(
      '{{EXISTING}}',
      existingContent.slice(0, 500)
    ).replace('{{NEW}}', newContent.slice(0, 500))

    const response = await this.llmProvider!.generate({
      prompt,
      temperature: 0,
      operationTag: 'memory:dedup'
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
    textSimilarity: number
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
        new_memory_metadata: info.newMemoryMetadata ? JSON.stringify(info.newMemoryMetadata) : null,
        kept_memory_content: info.keptMemoryContent,
        vector_distance: info.vectorDistance,
        text_similarity: info.textSimilarity,
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
  async listDedupLog(userId = DEFAULT_USER_ID, limit = 50): Promise<DedupLogEntry[]> {
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
   * 向量需调用方后续通过 backfillVector 补全。
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

      // 重新插入被抑制的记忆（仅 SQLite，向量由 backfill 流程补全）
      await this.storage.relational.insert('memories', {
        id: newId,
        type: entry.new_memory_type,
        content: entry.new_memory_content,
        user_id: entry.user_id,
        group_id: entry.group_id,
        created_at: now,
        updated_at: now,
        metadata: JSON.stringify({ ...metadata, restored_from_dedup: dedupLogId })
      })

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

  private async saveFromUnifiedResult(
    memcell: MemCell,
    result: UnifiedExtractionResult,
    routing?: MemoryRoutingContext
  ): Promise<void> {
    const userId = routing?.userId ?? memcell.user_id ?? DEFAULT_USER_ID
    const timestamp = memcell.timestamp || new Date().toISOString()
    const now = new Date().toISOString()
    const isAssistantScene = memcell.scene !== 'group' && memcell.scene !== 'document'
    const sessionOnly = routing?.sessionOnly === true
    const skipSession = routing?.skipSessionExtraction === true

    const roundMsgId = routing?.roundMessageId
    const sourceType = routing?.sourceType ?? MemorySourceType.CONVERSATION
    const sourceSessionId = routing?.sessionId
    const sourceRoundId = roundMsgId
    const sourceDocumentId = routing?.sourceDocumentId

    if (!sessionOnly && result.narrative?.content) {
      const content = result.narrative.content
      const summary = result.narrative.summary || content.slice(0, 200)
      const isDocument = memcell.scene === 'document'
      let embedding: number[] | undefined
      try {
        embedding = await this.embeddingProvider!.getEmbedding(summary || content)
      } catch (e) {
        console.warn('Narrative embedding failed:', e)
      }
      const groupId = routing?.scope

      const id = uuidv4()

      // 文档场景：OVERVIEW → DOCUMENT + sub_type=overview；对话场景：→ NARRATIVE
      const memType = isDocument ? MemoryType.DOCUMENT : MemoryType.NARRATIVE
      const subType = isDocument ? DocumentSubType.OVERVIEW : undefined

      // metadata: 文档场景提升 documentId/title 到顶层（与 migration 对齐）
      const cellMeta = (memcell.metadata ?? {}) as Record<string, unknown>
      const narrativeMeta: Record<string, unknown> = {
        summary: result.narrative.summary,
        ...(isDocument && cellMeta.documentId ? { documentId: cellMeta.documentId } : {}),
        ...(isDocument && cellMeta.title ? { title: cellMeta.title } : {})
      }

      const dedupId = await this.tryDedup(
        memType,
        embedding,
        content,
        groupId,
        userId,
        narrativeMeta
      )
      if (!dedupId) {
        await this.storage.relational.insert('memories', {
          id,
          type: memType,
          content: content,
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(narrativeMeta),
          source_type: sourceType,
          source_session_id: sourceSessionId ?? null,
          source_round_id: sourceRoundId ?? null,
          source_document_id: sourceDocumentId ?? null,
          sub_type: subType ?? null
        })
        if (embedding?.length) {
          await this.storage.vector.add(memType, [
            toVectorRow(id, content, userId, groupId, embedding)
          ])
        }
        this.pushCreated(id, content, memType, groupId)
      }
    }

    // 对话事件日志 — 仅对话场景写入 EVENT_LOG（Session 层）
    const isDocument = memcell.scene === 'document'
    if (!skipSession && !isDocument && result.event_log?.atomic_fact?.length) {
      const groupId = routing?.sessionId
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
        const eventLogMeta: Record<string, unknown> = {
          event_type: 'atomic',
          parent_type: 'memcell',
          parent_id: memcell.event_id
        }

        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.EVENT_LOG,
          content: fact.trim(),
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(eventLogMeta),
          source_type: sourceType,
          source_session_id: sourceSessionId ?? null,
          source_round_id: sourceRoundId ?? null
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.EVENT_LOG, [
            toVectorRow(id, fact.trim(), userId, groupId, embedding)
          ])
        }
        this.pushCreated(id, fact.trim(), MemoryType.EVENT_LOG, groupId)
      }
    }

    // 文档原子事实 — DOCUMENT + sub_type=fact（Scope 层）
    if (!sessionOnly && result.document_facts?.facts?.length) {
      const groupId = routing?.scope
      const factCellMeta = (memcell.metadata ?? {}) as Record<string, unknown>
      const factMeta: Record<string, unknown> = {
        ...(factCellMeta.documentId ? { documentId: factCellMeta.documentId } : {}),
        ...(factCellMeta.title ? { title: factCellMeta.title } : {})
      }
      for (const fact of result.document_facts.facts) {
        if (typeof fact !== 'string' || !fact.trim()) continue
        const id = uuidv4()
        let embedding: number[] | undefined
        try {
          embedding = await this.embeddingProvider!.getEmbedding(fact)
        } catch (e) {
          console.warn('DocumentFact embedding failed:', e)
        }

        await this.storage.relational.insert('memories', {
          id,
          type: MemoryType.DOCUMENT,
          content: fact.trim(),
          user_id: userId,
          group_id: groupId ?? null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify(factMeta),
          source_type: sourceType,
          source_session_id: sourceSessionId ?? null,
          source_round_id: sourceRoundId ?? null,
          source_document_id: sourceDocumentId ?? null,
          sub_type: DocumentSubType.FACT
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.DOCUMENT, [
            toVectorRow(id, fact.trim(), userId, groupId, embedding)
          ])
        }
        this.pushCreated(id, fact.trim(), MemoryType.DOCUMENT, groupId)
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

        const foresightMeta: Record<string, unknown> = {
          evidence: item.evidence
        }

        const dedupId = await this.tryDedup(
          MemoryType.FORESIGHT,
          embedding,
          item.content,
          groupId,
          userId,
          foresightMeta
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
          metadata: JSON.stringify(foresightMeta),
          source_type: sourceType,
          source_session_id: sourceSessionId ?? null,
          source_round_id: sourceRoundId ?? null
        })
        if (embedding?.length) {
          await this.storage.vector.add(MemoryType.FORESIGHT, [
            toVectorRow(id, item.content, userId, groupId, embedding)
          ])
        }
        this.pushCreated(id, item.content, MemoryType.FORESIGHT, groupId)
      }
    }

    if (!sessionOnly && isAssistantScene && result.profile?.user_profiles?.length) {
      // Profile 增量合并 — 先查已有 profile，合并后更新；无已有则插入新记录
      // parser 输出: { items: string[], user_name? } — 每个 user_profiles 条目
      for (const p of result.profile.user_profiles) {
        const profileData = p as Record<string, unknown>
        const incomingContent = this.buildProfileContent(profileData)
        if (!incomingContent) continue

        // 查找该用户的已有 PROFILE 记忆（最新一条）
        const existingRows = await this.storage.relational.query(
          'SELECT * FROM memories WHERE type = ? AND user_id = ? AND group_id = ? ORDER BY updated_at DESC LIMIT 1',
          [MemoryType.PROFILE, userId, USER_GROUP_ID]
        )

        if (existingRows.length > 0) {
          // ===== 增量合并到已有 Profile =====
          const existing = existingRows[0]
          let existingMeta: Record<string, unknown> = {}
          try {
            existingMeta =
              typeof existing.metadata === 'string'
                ? JSON.parse(existing.metadata)
                : existing.metadata ?? {}
          } catch {
            existingMeta = {}
          }

          // 先用零 token 的 simple merge 检测是否有实质变化
          const quickCheck = mergeProfilesSimple(existingMeta, profileData)
          if (!quickCheck.hasChanges) {
            console.log(`[Profile] No changes (simple check) for user=${userId}, skipping`)
            continue
          }

          // 有变化 → 用 LLM 做高质量合并（语义去重、冲突解决）
          let mergeResult = quickCheck
          if (this.llmProvider) {
            try {
              mergeResult = await mergeProfilesWithLLM(existingMeta, profileData, this.llmProvider)
            } catch {
              // LLM 失败回退到 simple merge 结果（已计算好）
            }
          }

          if (!mergeResult.hasChanges) {
            console.log(`[Profile] No changes (LLM confirmed) for user=${userId}, skipping update`)
            continue
          }

          const mergedContent = this.buildProfileContent(mergeResult.merged)
          const finalContent = mergedContent || incomingContent

          // 更新 embedding
          let embedding: number[] | undefined
          try {
            embedding = await this.embeddingProvider!.getEmbedding(finalContent)
          } catch (e) {
            console.warn('Profile embedding failed:', e)
          }

          const updatedMeta: Record<string, unknown> = {
            items: mergeResult.merged.items,
            merge_history: [
              ...((existingMeta.merge_history as string[]) ?? []),
              `${now}: ${mergeResult.changesSummary}`
            ].slice(-20)
          }

          await this.storage.relational.update('memories', existing.id, {
            content: finalContent,
            updated_at: now,
            metadata: JSON.stringify(updatedMeta),
            source_type: sourceType,
            source_session_id: sourceSessionId ?? null,
            source_round_id: sourceRoundId ?? null
          })

          // 更新向量索引：删旧加新
          if (embedding?.length) {
            try {
              await this.storage.vector.delete(MemoryType.PROFILE, existing.id)
            } catch {
              /* 可能不存在 */
            }
            await this.storage.vector.add(MemoryType.PROFILE, [
              toVectorRow(existing.id, finalContent, userId, null, embedding)
            ])
          }

          console.log(
            `[Profile] Merged into existing id=${existing.id}: ${mergeResult.changesSummary}`
          )
          this.pushCreated(existing.id, finalContent, MemoryType.PROFILE, null)
        } else {
          // ===== 无已有 Profile → 新建记录 =====
          const id = uuidv4()

          let embedding: number[] | undefined
          try {
            embedding = await this.embeddingProvider!.getEmbedding(incomingContent)
          } catch (e) {
            console.warn('Profile embedding failed:', e)
          }

          const meta: Record<string, unknown> = {
            items: profileData.items
          }

          await this.storage.relational.insert('memories', {
            id,
            type: MemoryType.PROFILE,
            content: incomingContent,
            user_id: userId,
            group_id: USER_GROUP_ID,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify(meta),
            source_type: sourceType,
            source_session_id: sourceSessionId ?? null,
            source_round_id: sourceRoundId ?? null
          })
          if (embedding?.length) {
            await this.storage.vector.add(MemoryType.PROFILE, [
              toVectorRow(id, incomingContent, userId, USER_GROUP_ID, embedding)
            ])
          }
          this.pushCreated(id, incomingContent, MemoryType.PROFILE, USER_GROUP_ID)
        }
      }
    }
  }

  /**
   * 根据 memory_type 和路由上下文计算 group_id：
   * - Profile    → "user"（User 层）
   * - Narrative  → scope（Scope 层）
   * - Foresight  → scope（Scope 层）
   * - Document   → scope（Scope 层）
   * - EventLog   → scope:session:sessionId（Session 层）
   */
  private resolveGroupId(
    type: MemoryType,
    memcell: MemCell,
    routing?: MemoryRoutingContext
  ): string | undefined {
    if (!routing) return memcell.group_id ?? undefined

    switch (type) {
      case MemoryType.PROFILE:
        return USER_GROUP_ID

      case MemoryType.NARRATIVE:
      case MemoryType.FORESIGHT:
      case MemoryType.DOCUMENT:
        return routing.scope

      case MemoryType.EVENT_LOG:
        return routing.sessionId ? `${routing.scope}:session:${routing.sessionId}` : routing.scope

      default:
        return memcell.group_id ?? routing.scope
    }
  }

  /**
   * 从 profile 的 items 列表生成 content 文本（用于全文搜索和 embedding）。
   * 格式：每条 item 一行，前面加用户称呼（如有）。
   */
  /**
   * 从 profile 的 items 列表生成 content 文本（用于全文搜索和 embedding）。
   * 每条 item 一行。
   */
  private buildProfileContent(profile: Record<string, unknown>): string {
    const items = Array.isArray(profile.items) ? (profile.items as string[]) : []
    return items
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim())
      .join('\n')
  }

  /**
   * 获取已有用户画像的 items 列表文本，注入抽取 prompt 让 LLM 跳过已知信息只抽取增量。
   * 轻量查询（单条 SQL），不消耗 LLM token。
   * 返回格式：每条 item 一行，截断到 ~500 字符。
   */
  private async getExistingProfileSummary(userId: string): Promise<string | undefined> {
    const rows = await this.storage.relational.query(
      'SELECT metadata FROM memories WHERE type = ? AND user_id = ? AND group_id = ? ORDER BY updated_at DESC LIMIT 1',
      [MemoryType.PROFILE, userId, USER_GROUP_ID]
    )
    if (rows.length === 0) return undefined

    let meta: Record<string, unknown> = {}
    try {
      const raw = rows[0].metadata
      meta = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}
    } catch {
      return undefined
    }

    const items = Array.isArray(meta.items) ? (meta.items as string[]) : []
    if (items.length === 0) return undefined

    const text = items.map((s) => `- ${s}`).join('\n')
    return text.length > 500 ? text.slice(0, 500) + '...' : text
  }

  private getMemoryContent(memory: any): string {
    if (memory.content) return memory.content
    if (memory.summary) return memory.summary
    if (memory.foresight) return memory.foresight
    if (memory.atomic_fact)
      return Array.isArray(memory.atomic_fact) ? memory.atomic_fact.join(' ') : memory.atomic_fact
    return ''
  }

  /** 列出记忆（用于管理/可视化） */
  async listMemories(user_id = DEFAULT_USER_ID, limit = 200): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [user_id, limit]
    )
    return rows
  }

  /** 统计记忆总数 */
  async countMemories(user_id = DEFAULT_USER_ID): Promise<number> {
    const rows = await this.storage.relational.query(
      'SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?',
      [user_id]
    )
    return (rows[0] as any)?.cnt ?? 0
  }

  /** 按 type 分组统计记忆数量 */
  async countMemoriesByType(user_id = DEFAULT_USER_ID): Promise<Record<string, number>> {
    const rows = await this.storage.relational.query(
      'SELECT type, COUNT(*) as cnt FROM memories WHERE user_id = ? GROUP BY type',
      [user_id]
    )
    const result: Record<string, number> = {}
    for (const row of rows) {
      const r = row as { type: string; cnt: number }
      if (r.type) result[r.type] = r.cnt
    }
    return result
  }

  /** 按来源轮次消息 ID 列出该轮创建的记忆 */
  async listMemoriesByRoundMessageId(
    round_message_id: string,
    user_id = DEFAULT_USER_ID,
    limit = 50
  ): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND source_round_id = ? ORDER BY created_at DESC LIMIT ?',
      [user_id, round_message_id, limit]
    )
    return rows
  }

  /** 按 group_id 列出记忆 */
  async listMemoriesByGroup(
    group_id: string,
    user_id = DEFAULT_USER_ID,
    limit = 200
  ): Promise<any[]> {
    const rows = await this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND group_id = ? ORDER BY created_at DESC LIMIT ?',
      [user_id, group_id, limit]
    )
    return rows
  }

  /** 按 group_id 前缀列出记忆（如 "online:" 列出 scope 下所有层级） */
  async listMemoriesByGroupPrefix(
    group_prefix: string,
    user_id = DEFAULT_USER_ID,
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

  /**
   * 按 metadata JSON 字段的 key-value 批量删除记忆。
   * 可选按 groupId 和 type 进一步过滤。用于清除特定文档的记忆。
   * @param key metadata 中的字段名（如 "documentId"）
   * @param value 要匹配的值
   * @param groupId 可选，限定 group_id
   * @param types 可选，限定 memory_type 列表
   * @returns 删除的记忆数量
   */
  async deleteMemoriesByMetadata(
    key: string,
    value: string,
    groupId?: string,
    types?: string[]
  ): Promise<number> {
    try {
      const conditions: string[] = [`json_extract(metadata, '$.${key}') = ?`]
      const params: unknown[] = [value]

      if (groupId !== undefined) {
        conditions.push('group_id = ?')
        params.push(groupId)
      }
      if (types && types.length > 0) {
        const placeholders = types.map(() => '?').join(', ')
        conditions.push(`type IN (${placeholders})`)
        params.push(...types)
      }

      const where = conditions.join(' AND ')
      const rows = await this.storage.relational.query(
        `SELECT id, type FROM memories WHERE ${where}`,
        params
      )
      for (const row of rows) {
        const r = row as { id: string; type: string }
        await this.storage.relational.delete('memories', r.id)
      }
      return rows.length
    } catch (e) {
      console.error('deleteMemoriesByMetadata error:', e)
      return 0
    }
  }

  /**
   * 按 metadata JSON 字段的 key-value 列出记忆。
   * 可选按 groupId 和 type 进一步过滤。用于查询特定文档的记忆。
   */
  async listMemoriesByMetadata(
    key: string,
    value: string,
    groupId?: string,
    type?: string,
    limit = 100
  ): Promise<Array<{ id: string; type: string; content: string; metadata: string }>> {
    try {
      const conditions: string[] = [`json_extract(metadata, '$.${key}') = ?`]
      const params: unknown[] = [value]

      if (groupId !== undefined) {
        conditions.push('group_id = ?')
        params.push(groupId)
      }
      if (type) {
        conditions.push('type = ?')
        params.push(type)
      }
      params.push(limit)

      const where = conditions.join(' AND ')
      const rows = await this.storage.relational.query(
        `SELECT id, type, content, metadata FROM memories WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
        params
      )
      return rows as Array<{ id: string; type: string; content: string; metadata: string }>
    } catch (e) {
      console.error('listMemoriesByMetadata error:', e)
      return []
    }
  }

  /**
   * 列出所有记忆（供向量补全使用）。
   * embedding 不存在 SQLite 中，无法在 DB 层判断是否缺失向量。
   * 调用方应直接对返回结果执行 backfillVector（LanceDB add 是幂等的）。
   */
  async listAllMemories(user_id = DEFAULT_USER_ID): Promise<
    Array<{
      id: string
      type: string
      content: string
      user_id: string | null
      group_id: string | null
    }>
  > {
    const rows = await this.storage.relational.query(
      'SELECT id, type, content, user_id, group_id FROM memories WHERE user_id = ?',
      [user_id]
    )
    return rows as Array<{
      id: string
      type: string
      content: string
      user_id: string | null
      group_id: string | null
    }>
  }

  /**
   * 为单条记忆补全向量。
   * 从 content 生成 embedding 并写入 LanceDB。SQLite 不受影响（embedding 不存 SQLite）。
   */
  async backfillVector(
    memoryId: string,
    type: string,
    content: string,
    userId: string | null,
    groupId: string | null,
    embeddingProvider: IEmbeddingProvider
  ): Promise<boolean> {
    try {
      const embedding = await embeddingProvider.getEmbedding(content)
      if (!embedding?.length) return false

      await this.storage.vector.add(type, [
        toVectorRow(memoryId, content, userId, groupId, embedding)
      ])

      return true
    } catch {
      return false
    }
  }

  // ==================== 类型安全的层级 API ====================

  /** 列出 User 层记忆（Profile） */
  async listUserMemories(
    types?: UserMemoryType[],
    userId = DEFAULT_USER_ID,
    limit = 200
  ): Promise<any[]> {
    const typeFilter = types ?? [MemoryType.PROFILE]
    const placeholders = typeFilter.map(() => '?').join(', ')
    return this.storage.relational.query(
      `SELECT * FROM memories WHERE user_id = ? AND group_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      [userId, USER_GROUP_ID, ...typeFilter, limit]
    )
  }

  /** 列出 Scope 层记忆（Narrative / Foresight / Document） */
  async listScopeMemories(
    scope: string,
    types?: ScopeMemoryType[],
    userId = DEFAULT_USER_ID,
    limit = 200
  ): Promise<any[]> {
    const typeFilter: string[] = types ?? [
      MemoryType.NARRATIVE,
      MemoryType.FORESIGHT,
      MemoryType.DOCUMENT
    ]
    const placeholders = typeFilter.map(() => '?').join(', ')
    return this.storage.relational.query(
      `SELECT * FROM memories WHERE user_id = ? AND group_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      [userId, scope, ...typeFilter, limit]
    )
  }

  /** 列出 Session 层记忆（EventLog） */
  async listSessionMemories(
    scope: string,
    sessionId: string,
    userId = DEFAULT_USER_ID,
    limit = 200
  ): Promise<any[]> {
    const groupId = `${scope}:session:${sessionId}`
    return this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND group_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?',
      [userId, groupId, MemoryType.EVENT_LOG, limit]
    )
  }

  /** 删除 User 层记忆 */
  async deleteUserMemories(userId = DEFAULT_USER_ID): Promise<number> {
    try {
      const rows = await this.storage.relational.query(
        'SELECT id FROM memories WHERE user_id = ? AND group_id = ?',
        [userId, USER_GROUP_ID]
      )
      for (const row of rows) {
        await this.storage.relational.delete('memories', row.id)
      }
      return rows.length
    } catch {
      return 0
    }
  }

  /** 删除 Scope 层记忆，可选按类型过滤 */
  async deleteScopeMemories(scope: string, types?: ScopeMemoryType[]): Promise<number> {
    try {
      const typeFilter: string[] = types ?? [
        MemoryType.NARRATIVE,
        MemoryType.FORESIGHT,
        MemoryType.DOCUMENT
      ]
      const placeholders = typeFilter.map(() => '?').join(', ')
      const rows = await this.storage.relational.query(
        `SELECT id FROM memories WHERE group_id = ? AND type IN (${placeholders})`,
        [scope, ...typeFilter]
      )
      for (const row of rows) {
        await this.storage.relational.delete('memories', row.id)
      }
      return rows.length
    } catch {
      return 0
    }
  }

  /** 删除 Session 层记忆 */
  async deleteSessionMemories(scope: string, sessionId: string): Promise<number> {
    const groupId = `${scope}:session:${sessionId}`
    return this.deleteMemoriesByGroupId(groupId)
  }

  /** 按 sub_type 列出文档记忆 */
  async listDocumentMemories(
    scope: string,
    subType?: DocumentSubType,
    userId = DEFAULT_USER_ID,
    limit = 200
  ): Promise<any[]> {
    if (subType) {
      return this.storage.relational.query(
        'SELECT * FROM memories WHERE user_id = ? AND group_id = ? AND type = ? AND sub_type = ? ORDER BY created_at DESC LIMIT ?',
        [userId, scope, MemoryType.DOCUMENT, subType, limit]
      )
    }
    return this.storage.relational.query(
      'SELECT * FROM memories WHERE user_id = ? AND group_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?',
      [userId, scope, MemoryType.DOCUMENT, limit]
    )
  }

  /** 按 sub_type 删除文档记忆 */
  async deleteDocumentMemories(scope: string, subTypes?: DocumentSubType[]): Promise<number> {
    try {
      let rows: any[]
      if (subTypes?.length) {
        const placeholders = subTypes.map(() => '?').join(', ')
        rows = await this.storage.relational.query(
          `SELECT id FROM memories WHERE group_id = ? AND type = ? AND sub_type IN (${placeholders})`,
          [scope, MemoryType.DOCUMENT, ...subTypes]
        )
      } else {
        rows = await this.storage.relational.query(
          'SELECT id FROM memories WHERE group_id = ? AND type = ?',
          [scope, MemoryType.DOCUMENT]
        )
      }
      for (const row of rows) {
        await this.storage.relational.delete('memories', row.id)
      }
      return rows.length
    } catch {
      return 0
    }
  }

  /**
   * 清空所有记忆（SQLite + 向量索引）。
   * 返回删除的 SQLite 行数。
   */
  async clearAllMemories(): Promise<number> {
    // 统计删除数量
    const countRows = await this.storage.relational.query(
      'SELECT COUNT(*) as cnt FROM memories',
      []
    )
    const count = (countRows[0] as { cnt: number })?.cnt ?? 0

    // 清空 SQLite memories 表
    await this.storage.relational.query('DELETE FROM memories', [])

    // 清空去重日志
    try {
      await this.storage.relational.query('DELETE FROM dedup_log', [])
    } catch {
      // table may not exist
    }

    // 删除所有向量集合
    const vectorTypes = [
      MemoryType.NARRATIVE,
      MemoryType.FORESIGHT,
      MemoryType.EVENT_LOG,
      MemoryType.PROFILE,
      MemoryType.DOCUMENT
    ]
    for (const type of vectorTypes) {
      try {
        if (this.storage.vector.dropCollection) {
          await this.storage.vector.dropCollection(type)
        }
      } catch {
        // ignore
      }
    }

    return count
  }
}

// ==================== 文本去重辅助函数 ====================

/**
 * 文本归一化：去除标点符号、多余空白，转小写。
 * 语言无关，适用于 Dice 系数等基于字符的算法。
 */
export function normalizeForDedup(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
}

/**
 * 将归一化后的字符串拆为字符 bigram 的多重集合（Map<bigram, count>）。
 * 使用 Map 而非 Set，以正确处理重复 bigram。
 */
export function buildBigrams(normalized: string): Map<string, number> {
  const bigrams = new Map<string, number>()
  for (let i = 0; i < normalized.length - 1; i++) {
    const bg = normalized.slice(i, i + 2)
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1)
  }
  return bigrams
}

/**
 * Sørensen-Dice coefficient（基于字符 bigram 多重集合）。
 * Dice = 2 × |A ∩ B| / (|A| + |B|)
 *
 * 语言无关：
 * - 中文：每个字符是语义单元，bigram 天然保序
 * - 英文/其他：bigram 捕获词内字符模式
 *
 * O(n) 时间复杂度。
 */
export function diceCoefficientFromBigrams(a: Map<string, number>, b: Map<string, number>): number {
  const sizeA = sumValues(a)
  const sizeB = sumValues(b)
  if (sizeA === 0 && sizeB === 0) return 1
  if (sizeA === 0 || sizeB === 0) return 0

  let intersection = 0
  const smaller = a.size <= b.size ? a : b
  const larger = a.size <= b.size ? b : a
  for (const [bg, countA] of smaller) {
    const countB = larger.get(bg)
    if (countB !== undefined) {
      intersection += Math.min(countA, countB)
    }
  }
  return (2 * intersection) / (sizeA + sizeB)
}

/**
 * 便捷函数：直接对两段文本计算 Dice coefficient。
 */
export function diceCoefficient(textA: string, textB: string): number {
  const a = normalizeForDedup(textA)
  const b = normalizeForDedup(textB)
  if (a.length < 2 && b.length < 2) return a === b ? 1 : 0
  return diceCoefficientFromBigrams(buildBigrams(a), buildBigrams(b))
}

function sumValues(map: Map<string, number>): number {
  let s = 0
  for (const v of map.values()) s += v
  return s
}

// ---- jieba 分词 Jaccard（中文增强） ----

/** 停用词集合（中英文高频无意义词） */
const STOP_WORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'be',
  'to',
  'of',
  'and',
  'in',
  'that',
  'it',
  'for'
])

/**
 * 使用 jieba 分词将文本转为 token 集合（去停用词、去标点、转小写）。
 * 中文增强信号，与 Dice 系数配合使用。
 */
export function tokenizeForDedup(text: string): Set<string> {
  const tokens = jieba.cut(text, true)
  const result = new Set<string>()
  for (const t of tokens) {
    const trimmed = t.trim().toLowerCase()
    if (trimmed.length === 0) continue
    if (/^[\s\p{P}\p{S}]+$/u.test(trimmed)) continue
    if (STOP_WORDS.has(trimmed)) continue
    result.add(trimmed)
  }
  return result
}

/**
 * 计算两个 token 集合的 Jaccard 相似度。
 * Jaccard = |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  const smaller = a.size <= b.size ? a : b
  const larger = a.size <= b.size ? b : a
  for (const token of smaller) {
    if (larger.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 综合文本相似度：max(Dice 系数, jieba Jaccard)。
 * - Dice：语言无关，基于字符 bigram，保序
 * - Jaccard：中文分词增强，捕获词级语义
 * 取最大值确保对任意语言都有最佳覆盖。
 */
export function textSimilarity(textA: string, textB: string): number {
  const normA = normalizeForDedup(textA)
  const normB = normalizeForDedup(textB)

  // Dice coefficient（字符 bigram）
  let dice = 0
  if (normA.length >= 2 && normB.length >= 2) {
    dice = diceCoefficientFromBigrams(buildBigrams(normA), buildBigrams(normB))
  } else if (normA === normB) {
    dice = 1
  }

  // jieba token Jaccard
  const tokensA = tokenizeForDedup(textA)
  const tokensB = tokenizeForDedup(textB)
  const jaccard = tokensA.size > 0 && tokensB.size > 0 ? jaccardSimilarity(tokensA, tokensB) : 0

  return Math.max(dice, jaccard)
}
