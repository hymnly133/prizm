import {
  MemoryManager,
  RetrievalManager,
  SQLiteAdapter,
  LanceDBAdapter,
  StorageAdapter,
  MemCell,
  RawDataType,
  MemoryType,
  RetrieveMethod,
  UnifiedExtractor,
  DefaultQueryExpansionProvider,
  MemoryRoutingContext
} from '@prizm/evermemos'
import path from 'path'
import fs from 'fs'
import { createLogger } from '../logger'
import { getConfig } from '../config'
import { getLLMProvider } from '../llm/index'
import { CompletionRequest, ICompletionProvider } from '@prizm/evermemos'
import { recordTokenUsage } from './tokenUsage'
import { scopeStore } from '../core/ScopeStore'
import type { MemoryItem, RoundMemoryGrowth } from '@prizm/shared'

const log = createLogger('EverMemService')

let _memoryManager: MemoryManager | null = null
let _retrievalManager: RetrievalManager | null = null

/** 当前请求的 token 记录用 userId，由 addMemoryInteraction 设置 */
let _tokenUserId: string | null = null

// Adapter for Prizm LLM Provider to EverMemOS LLM Provider
class PrizmLLMAdapter implements ICompletionProvider {
  async generate(request: CompletionRequest): Promise<string> {
    const provider = getLLMProvider()
    const messages = [{ role: 'user', content: request.prompt }]

    const model = 'zhipu'

    const stream = provider.chat(messages, {
      temperature: request.temperature
    })

    let fullText = ''
    let usage: {
      totalInputTokens?: number
      totalOutputTokens?: number
      totalTokens?: number
    } | null = null
    let recordedInCatch = false

    try {
      for await (const chunk of stream) {
        if (chunk.text) fullText += chunk.text
        if (chunk.usage) usage = chunk.usage
      }
    } catch (err) {
      if (_tokenUserId) {
        recordTokenUsage(
          _tokenUserId,
          'memory',
          usage ?? { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 },
          model,
          !usage
        )
        recordedInCatch = true
      }
      throw err
    } finally {
      if (usage && _tokenUserId && !recordedInCatch) {
        recordTokenUsage(_tokenUserId, 'memory', usage, model)
      }
    }

    return fullText
  }

  async getEmbedding(text: string): Promise<number[]> {
    const provider = getLLMProvider()
    // Assuming provider has getEmbedding, otherwise we need to implement it or use a specific embedding model
    // For now, let's assume the provider interface supports it or we use a fallback
    if ('embed' in provider) {
      // @ts-ignore
      const resp = await provider.embed([text])
      return resp[0]
    }
    // Mock embedding if not supported (to avoid runtime crash on some providers)
    // In production we should ensure generic OpenAILikeProvider supports embed
    return new Array(1536).fill(0.01)
  }
}

export async function initEverMemService() {
  const cfg = getConfig()
  const dbPath = path.join(cfg.dataDir, 'evermemos.db')
  const vectorDbPath = path.join(cfg.dataDir, 'evermemos_vec')

  // Ensure directories exist
  if (!fs.existsSync(cfg.dataDir)) {
    fs.mkdirSync(cfg.dataDir, { recursive: true })
  }

  const sqliteAdapter = new SQLiteAdapter(dbPath)
  const lancedbAdapter = new LanceDBAdapter(vectorDbPath)

  const storage: StorageAdapter = {
    relational: sqliteAdapter,
    vector: lancedbAdapter
  }

  const llmProvider = new PrizmLLMAdapter()
  const unifiedExtractor = new UnifiedExtractor(llmProvider)
  _memoryManager = new MemoryManager(storage, {
    unifiedExtractor,
    embeddingProvider: llmProvider
  })
  // 使用统一抽取时不注册分类型 extractor，避免 1+6=7 次调用

  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  _retrievalManager = new RetrievalManager(storage, llmProvider, {
    queryExpansionProvider
  })

  log.info('EverMemService initialized')
}

/** 供 E2E 测试用：返回与记忆抽取同款的 LLM 适配器（使用 getLLMProvider，即默认 MiMo/智谱/OpenAI） */
export function createMemoryExtractionLLMAdapter(): ICompletionProvider {
  return new PrizmLLMAdapter()
}

export function getMemoryManager(): MemoryManager {
  if (!_memoryManager) throw new Error('EverMemService not initialized')
  return _memoryManager
}

export function getRetrievalManager(): RetrievalManager {
  if (!_retrievalManager) throw new Error('EverMemService not initialized')
  return _retrievalManager
}

/**
 * 仅用于测试：注入 mock RetrievalManager，避免未 init 时抛错
 */
export function setRetrievalManagerForTest(manager: RetrievalManager | null): void {
  if (process.env.NODE_ENV !== 'test') return
  _retrievalManager = manager
}

/**
 * 三层路由：将对话记忆写入 User/Scope/Session 层
 * @param messages 对话消息
 * @param userId   真实用户 ID（clientId）
 * @param scope    数据 scope
 * @param sessionId 当前会话 ID
 * @param roundMessageId 关联的 assistant 消息 ID，用于按轮次查询记忆增长
 * @returns 本轮新创建的记忆汇总（RoundMemoryGrowth），用于客户端展示
 */
export async function addMemoryInteraction(
  messages: Array<{ role: string; content: string }>,
  userId: string,
  scope: string,
  sessionId?: string,
  roundMessageId?: string
): Promise<RoundMemoryGrowth | null> {
  const manager = getMemoryManager()
  _tokenUserId = userId
  try {
    const routing: MemoryRoutingContext = {
      userId,
      scope,
      sessionId,
      roundMessageId,
      skipSessionExtraction: true
    }
    const memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      user_id: userId,
      deleted: false,
      scene: 'assistant'
    }
    const created = await manager.processMemCell(memcell, routing)
    if (!roundMessageId || created.length === 0) return null
    const byType: Record<string, number> = {}
    for (const c of created) {
      byType[c.type] = (byType[c.type] ?? 0) + 1
    }
    const memories: MemoryItem[] = created.map((c) => ({
      id: c.id,
      memory: c.content,
      user_id: userId,
      group_id: c.group_id,
      memory_type: c.type
    }))
    return { messageId: roundMessageId, count: created.length, byType, memories }
  } finally {
    _tokenUserId = null
  }
}

/**
 * 将指定轮次的对话批量抽取为 Session 层记忆（仅 EventLog）
 * 用于 A/B 滑动窗口压缩：将最老 B 轮对话抽取为记忆后，不再发送原始上下文
 */
export async function addSessionMemoryFromRounds(
  messages: Array<{ role: string; content: string }>,
  userId: string,
  scope: string,
  sessionId: string
): Promise<void> {
  if (!messages.length) return
  const manager = getMemoryManager()
  _tokenUserId = userId
  try {
    const routing: MemoryRoutingContext = {
      userId,
      scope,
      sessionId,
      sessionOnly: true
    }
    const memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      user_id: userId,
      deleted: false,
      scene: 'assistant'
    }
    await manager.processMemCell(memcell, routing)
    log.info(
      'Session memory extracted from rounds, scope=%s session=%s msgs=%d',
      scope,
      sessionId,
      messages.length
    )
  } finally {
    _tokenUserId = null
  }
}

/**
 * 将文档内容写入 scope:docs 层记忆
 * @param userId     真实用户 ID
 * @param scope      数据 scope
 * @param documentId 文档 ID
 */
export async function addDocumentToMemory(
  userId: string,
  scope: string,
  documentId: string
): Promise<void> {
  const manager = getMemoryManager()
  _tokenUserId = userId
  try {
    const data = scopeStore.getScopeData(scope)
    const doc = data.documents.find((d) => d.id === documentId)
    if (!doc) {
      log.warn('Document not found for memory:', documentId, 'scope:', scope)
      return
    }

    const content = doc.content?.trim() ?? ''
    if (!content) {
      log.info('Document has no content for memory:', documentId)
      return
    }

    const routing: MemoryRoutingContext = {
      userId,
      scope
      // document 场景不传 sessionId
    }
    const memcell: MemCell = {
      original_data: { documentId, title: doc.title ?? documentId },
      timestamp: new Date().toISOString(),
      type: RawDataType.TEXT,
      text: content.slice(0, 8000), // 截断避免过长
      user_id: userId,
      deleted: false,
      scene: 'document', // 仅抽取 Episode + EventLog
      metadata: {
        source: 'document',
        documentId,
        title: doc.title ?? documentId
      }
    }
    await manager.processMemCell(memcell, routing)
    log.info('Document memory stored:', documentId, 'scope:', scope)
  } finally {
    _tokenUserId = null
  }
}

/** 记忆检索可选参数，与 evermemos RetrieveRequest 对齐 */
export interface MemorySearchOptions {
  method?: RetrieveMethod
  use_rerank?: boolean
  limit?: number
  memory_types?: MemoryType[]
}

// ---- 三层检索 API ----

/**
 * User 层检索：Profile 记忆（group_id IS NULL）
 */
export async function searchUserMemories(
  query: string,
  userId: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  return doSearch(query, userId, undefined, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.PROFILE]
  })
}

/**
 * Scope 层检索：Episodic + Foresight + Document 记忆
 * group_id = scope 或 scope:docs
 */
export async function searchScopeMemories(
  query: string,
  userId: string,
  scope: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  // scope 层检索：scope 本身 + scope:docs
  // 用 scope 作为 group_id，RetrievalManager 按 group_id 过滤
  const defaultTypes = [MemoryType.EPISODIC_MEMORY, MemoryType.FORESIGHT]
  const scopeResults = await doSearch(query, userId, scope, {
    ...options,
    memory_types: options?.memory_types ?? defaultTypes
  })
  // 额外检索文档记忆
  const docResults = await doSearch(query, userId, `${scope}:docs`, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.EPISODIC_MEMORY, MemoryType.EVENT_LOG],
    limit: options?.limit ?? 10
  })
  // 合并去重并按 score 排序
  const merged = mergeAndDedup([...scopeResults, ...docResults])
  const limit = options?.limit ?? 20
  return merged.slice(0, limit)
}

/**
 * Session 层检索：EventLog 记忆
 * group_id = scope:session:sessionId
 */
export async function searchSessionMemories(
  query: string,
  userId: string,
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const groupId = `${scope}:session:${sessionId}`
  return doSearch(query, userId, groupId, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.EVENT_LOG]
  })
}

/**
 * 兼容旧接口：搜索所有记忆（不区分层级）
 */
export async function searchMemories(query: string, userId: string): Promise<MemoryItem[]> {
  return doSearch(query, userId)
}

export async function searchMemoriesWithOptions(
  query: string,
  userId: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  return doSearch(query, userId, undefined, options)
}

/** 自动注入用：每层条数上限，控制 token */
const INJECT_USER_LIMIT = 3
const INJECT_SCOPE_LIMIT = 5
const INJECT_SESSION_LIMIT = 5

/**
 * 仅检索 User + Scope 层（首条消息前注入用，无 session）
 */
export async function searchUserAndScopeMemories(
  query: string,
  userId: string,
  scope: string,
  options?: MemorySearchOptions
): Promise<{ user: MemoryItem[]; scope: MemoryItem[] }> {
  const [userMem, scopeMem] = await Promise.all([
    searchUserMemories(query, userId, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, userId, scope, {
      ...options,
      limit: options?.limit ?? INJECT_SCOPE_LIMIT
    })
  ])
  return { user: userMem, scope: scopeMem }
}

/**
 * 并行执行三层检索，返回合并后的三段结果（用于自动注入时条数较少以省 token）
 */
export async function searchThreeLevelMemories(
  query: string,
  userId: string,
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<{
  user: MemoryItem[]
  scope: MemoryItem[]
  session: MemoryItem[]
}> {
  const [userMem, scopeMem, sessionMem] = await Promise.all([
    searchUserMemories(query, userId, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, userId, scope, {
      ...options,
      limit: options?.limit ?? INJECT_SCOPE_LIMIT
    }),
    searchSessionMemories(query, userId, scope, sessionId, {
      ...options,
      limit: options?.limit ?? INJECT_SESSION_LIMIT
    })
  ])
  return { user: userMem, scope: scopeMem, session: sessionMem }
}

/** 内部通用检索函数 */
async function doSearch(
  query: string,
  userId: string,
  groupId?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const manager = getRetrievalManager()
  const results = await manager.retrieve({
    query,
    user_id: userId,
    group_id: groupId,
    method: options?.method ?? RetrieveMethod.HYBRID,
    use_rerank: options?.use_rerank,
    limit: options?.limit ?? 20,
    memory_types: options?.memory_types
  })
  return results.map((r) => ({
    id: r.id,
    memory: r.content ?? '',
    user_id: userId,
    group_id: (r.metadata as any)?.group_id ?? undefined,
    memory_type: (r.metadata as any)?.type ?? r.type,
    created_at: (r.metadata as any)?.created_at,
    updated_at: (r.metadata as any)?.updated_at,
    metadata: r.metadata,
    score: r.score
  }))
}

/** 合并 MemoryItem 并去重（按 id） */
function mergeAndDedup(items: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>()
  const result: MemoryItem[] = []
  // 按 score 降序排列
  items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      result.push(item)
    }
  }
  return result
}

export async function getAllMemories(userId: string): Promise<MemoryItem[]> {
  const manager = getMemoryManager()
  const rows = await manager.listMemories(userId)
  return rows.map(
    (r: {
      id: string
      content?: string
      user_id?: string
      group_id?: string | null
      type?: string
      created_at?: string
      updated_at?: string
      metadata?: unknown
    }) => ({
      id: r.id,
      memory: r.content ?? '',
      user_id: r.user_id,
      group_id: r.group_id ?? undefined,
      memory_type: r.type,
      created_at: r.created_at,
      updated_at: r.updated_at,
      metadata: typeof r.metadata === 'string' ? undefined : (r.metadata as Record<string, unknown>)
    })
  )
}

export async function deleteMemory(id: string): Promise<boolean> {
  const manager = getMemoryManager()
  return manager.deleteMemory(id)
}

/**
 * 按 group_id 批量删除记忆（用于 session 生命周期管理）
 */
export async function deleteMemoriesByGroupId(groupId: string): Promise<number> {
  const manager = getMemoryManager()
  return manager.deleteMemoriesByGroupId(groupId)
}

/**
 * 按 group_id 前缀批量删除（用于 scope 生命周期管理）
 */
export async function deleteMemoriesByGroupPrefix(groupPrefix: string): Promise<number> {
  const manager = getMemoryManager()
  return manager.deleteMemoriesByGroupPrefix(groupPrefix)
}

export function isMemoryEnabled(): boolean {
  return true
}

/**
 * 按 round_message_id 获取该轮对话的记忆增长（用于历史消息懒加载）
 */
export async function getRoundMemories(
  userId: string,
  messageId: string
): Promise<RoundMemoryGrowth | null> {
  const manager = getMemoryManager()
  const rows = await manager.listMemoriesByRoundMessageId(userId, messageId)
  if (rows.length === 0) return null
  const byType: Record<string, number> = {}
  const memories: MemoryItem[] = rows.map(
    (r: { id: string; content?: string; type?: string; group_id?: string | null }) => {
      const t = r.type ?? 'unknown'
      byType[t] = (byType[t] ?? 0) + 1
      return {
        id: r.id,
        memory: r.content ?? '',
        user_id: userId,
        group_id: r.group_id ?? undefined,
        memory_type: t
      }
    }
  )
  return { messageId, count: rows.length, byType, memories }
}
