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
import Database from 'better-sqlite3'
import fs from 'fs'
import { MEMORY_USER_ID } from '@prizm/shared'
import { createLogger } from '../logger'
import {
  ensureMemoryDir,
  getUserMemoryDbPath,
  getUserMemoryVecPath,
  getScopeMemoryDbPath,
  getScopeMemoryVecPath,
  ensureScopeMemoryDir,
  getUsersDir
} from '../core/PathProviderCore'
import { scopeStore } from '../core/ScopeStore'
import { appendSessionMemories } from '../core/mdStore'
import { readUserTokenUsage, writeUserTokenUsage } from '../core/UserStore'
import { createCompositeStorageAdapter } from './CompositeStorageAdapter'
import { getLLMProvider } from '../llm/index'
import { CompletionRequest, ICompletionProvider } from '@prizm/evermemos'
import { recordTokenUsage } from './tokenUsage'
import type { MemoryItem, RoundMemoryGrowth } from '@prizm/shared'
import type { DedupLogEntry } from '@prizm/evermemos'

const log = createLogger('EverMemService')

/** 用户级 Manager（PROFILE 记忆） */
let _userManagers: { memory: MemoryManager; retrieval: RetrievalManager } | null = null

/**
 * Scope 级 Manager 缓存：
 * - memory: composite storage，写入时按 group_id 路由（PROFILE→userDB，其余→scopeDB）
 * - scopeOnlyMemory: scope-only storage，用于直接查询 scope DB（listing/round 等不含 group_id 的读操作）
 * - retrieval: scope-only storage，用于向量检索
 */
interface ScopeManagerSet {
  memory: MemoryManager
  scopeOnlyMemory: MemoryManager
  retrieval: RetrievalManager
}
const _scopeManagers = new Map<string, ScopeManagerSet>()

/** 当前请求的 token 记录用 userId，由 addMemoryInteraction 设置 */
let _tokenUserId: string | null = null

/** 仅测试用：注入后所有 retrieval（含 scope）均使用此 mock */
let _testRetrievalOverride: RetrievalManager | null = null

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
    // 优先使用本地 embedding provider（如 bge-small-zh-v1.5）
    if (_localEmbeddingProvider) {
      return _localEmbeddingProvider(text)
    }

    const provider = getLLMProvider()
    if ('embed' in provider) {
      // @ts-ignore
      const resp = await provider.embed([text])
      return resp[0]
    }

    // 回退：mock embedding（仅用于向量表占位，实际去重依赖 jieba 文本相似度）
    if (!_mockEmbeddingWarned) {
      console.warn(
        '[EverMemService] No embedding provider available, using mock embedding. ' +
          'Text-based dedup (jieba) will still work. ' +
          'Set PRIZM_LOCAL_EMBEDDING=1 to enable local embedding model.'
      )
      _mockEmbeddingWarned = true
    }
    return new Array(384).fill(0.01)
  }
}

// ==================== 本地 Embedding 接口 ====================

/** 本地 embedding 函数签名 */
export type LocalEmbeddingFn = (text: string) => Promise<number[]>

/** 已注册的本地 embedding provider（由外部模块注入） */
let _localEmbeddingProvider: LocalEmbeddingFn | null = null

/** mock embedding 警告是否已打印（避免重复日志） */
let _mockEmbeddingWarned = false

/**
 * 注册本地 embedding provider。
 * 用法示例（待实现 @huggingface/transformers 后启用）：
 *   registerLocalEmbeddingProvider(async (text) => {
 *     const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5')
 *     const output = await extractor(text, { pooling: 'mean', normalize: true })
 *     return Array.from(output.data)
 *   })
 */
export function registerLocalEmbeddingProvider(fn: LocalEmbeddingFn): void {
  _localEmbeddingProvider = fn
  _mockEmbeddingWarned = false
  log.info('Local embedding provider registered')
}

/** 清除本地 embedding provider（测试用） */
export function clearLocalEmbeddingProvider(): void {
  _localEmbeddingProvider = null
  _mockEmbeddingWarned = false
}

/**
 * 迁移单个 SQLite 记忆数据库：将所有 user_id 统一为 MEMORY_USER_ID。
 * 处理迁移过程中的 UNIQUE 冲突（如果相同 id 已存在则跳过）。
 */
function migrateMemoryDb(dbPath: string, label: string): void {
  if (!fs.existsSync(dbPath)) return
  try {
    const db = new Database(dbPath)
    // 查找需要迁移的记忆数量
    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id != ? AND user_id IS NOT NULL')
      .get(MEMORY_USER_ID) as { cnt: number } | undefined
    const count = countRow?.cnt ?? 0
    if (count > 0) {
      const result = db
        .prepare('UPDATE memories SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(MEMORY_USER_ID, MEMORY_USER_ID)
      log.info(
        `[Migration] ${label}: unified ${result.changes} memory rows to user_id="${MEMORY_USER_ID}"`
      )
    }
    // 同样迁移 dedup_log 表
    try {
      const dedupResult = db
        .prepare('UPDATE dedup_log SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(MEMORY_USER_ID, MEMORY_USER_ID)
      if (dedupResult.changes > 0) {
        log.info(`[Migration] ${label}: unified ${dedupResult.changes} dedup_log rows`)
      }
    } catch {
      // dedup_log 表可能不存在，忽略
    }
    db.close()
  } catch (e) {
    log.warn(`[Migration] ${label}: failed to migrate:`, e)
  }
}

/**
 * 启动时运行记忆 user_id 迁移：将散落在不同 clientId 下的记忆合并到统一 userId。
 * 幂等操作，已迁移的数据不会重复处理。
 */
function runMemoryUserIdMigration(): void {
  // 1. 迁移 User DB
  const userDbPath = getUserMemoryDbPath()
  migrateMemoryDb(userDbPath, 'user.db')

  // 2. 迁移所有已注册 Scope 的 DB
  const scopes = scopeStore.getAllScopes()
  for (const scopeId of scopes) {
    try {
      const scopeRoot = scopeStore.getScopeRootPath(scopeId)
      if (!scopeRoot) continue
      const scopeDbPath = getScopeMemoryDbPath(scopeRoot)
      migrateMemoryDb(scopeDbPath, `scope[${scopeId}]`)
    } catch {
      // scope root path not available, skip
    }
  }
}

/**
 * 启动时运行 token 使用数据迁移：将散落在不同 userId 目录下的 token 记录合并到统一用户。
 * 幂等：已合并的目录下文件被删除，不会重复处理。
 */
function runTokenUsageMigration(): void {
  const usersDir = getUsersDir()
  if (!fs.existsSync(usersDir)) return

  const targetId = MEMORY_USER_ID
  let entries: string[]
  try {
    entries = fs.readdirSync(usersDir)
  } catch {
    return
  }

  // 收集所有非目标用户的 token 记录
  let merged = 0
  for (const entry of entries) {
    if (entry === targetId) continue
    const entryPath = `${usersDir}/${entry}`
    try {
      const stat = fs.statSync(entryPath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }

    const records = readUserTokenUsage(entry)
    if (records.length === 0) continue

    // 读取目标用户已有记录，追加后写回
    const targetRecords = readUserTokenUsage(targetId)
    // 按 id 去重，避免重复追加
    const existingIds = new Set(targetRecords.map((r) => r.id))
    const newRecords = records.filter((r) => !existingIds.has(r.id))
    if (newRecords.length > 0) {
      const combined = [...targetRecords, ...newRecords]
      combined.sort((a, b) => a.timestamp - b.timestamp)
      writeUserTokenUsage(targetId, combined)
      merged += newRecords.length
    }

    // 删除旧用户的 token 文件（保留目录，可能有其他数据）
    try {
      const oldTokenFile = `${entryPath}/.prizm/token_usage.md`
      if (fs.existsSync(oldTokenFile)) {
        fs.unlinkSync(oldTokenFile)
      }
    } catch {
      // ignore cleanup errors
    }
  }

  if (merged > 0) {
    log.info(
      `[Migration] Token usage: merged ${merged} records from ${
        entries.length - 1
      } user(s) into "${targetId}"`
    )
  }
}

export async function initEverMemService() {
  ensureMemoryDir()

  // 启动时执行 user_id 统一迁移
  runMemoryUserIdMigration()
  runTokenUsageMigration()

  const userDbPath = getUserMemoryDbPath()
  const userVecPath = getUserMemoryVecPath()

  const userSqlite = new SQLiteAdapter(userDbPath)
  const userLancedb = new LanceDBAdapter(userVecPath)
  const userStorage: StorageAdapter = {
    relational: userSqlite,
    vector: userLancedb
  }

  const llmProvider = new PrizmLLMAdapter()
  const unifiedExtractor = new UnifiedExtractor(llmProvider)
  const userMemory = new MemoryManager(userStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider
  })
  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  const userRetrieval = new RetrievalManager(userStorage, llmProvider, {
    queryExpansionProvider
  })

  _userManagers = { memory: userMemory, retrieval: userRetrieval }
  log.info('EverMemService initialized (user-level)')
}

function getUserManagers(): { memory: MemoryManager; retrieval: RetrievalManager } {
  if (!_userManagers) throw new Error('EverMemService not initialized')
  return _userManagers
}

function getScopeManagers(scope: string): ScopeManagerSet {
  if (_testRetrievalOverride) {
    let m = _scopeManagers.get(`__test__${scope}`)
    if (!m) {
      m = {
        memory: {} as MemoryManager,
        scopeOnlyMemory: {} as MemoryManager,
        retrieval: _testRetrievalOverride
      }
      _scopeManagers.set(`__test__${scope}`, m)
    }
    return m
  }
  let m = _scopeManagers.get(scope)
  if (m) return m

  const scopeRoot = scopeStore.getScopeRootPath(scope)
  if (!scopeRoot) throw new Error(`Scope not found: ${scope}`)

  ensureScopeMemoryDir(scopeRoot)
  const scopeDbPath = getScopeMemoryDbPath(scopeRoot)
  const scopeVecPath = getScopeMemoryVecPath(scopeRoot)

  const scopeSqlite = new SQLiteAdapter(scopeDbPath)
  const scopeLancedb = new LanceDBAdapter(scopeVecPath)
  const scopeStorage: StorageAdapter = {
    relational: scopeSqlite,
    vector: scopeLancedb
  }

  const userStorage: StorageAdapter = {
    relational: new SQLiteAdapter(getUserMemoryDbPath()),
    vector: new LanceDBAdapter(getUserMemoryVecPath())
  }
  const compositeStorage = createCompositeStorageAdapter(userStorage, scopeStorage)

  const llmProvider = new PrizmLLMAdapter()
  const unifiedExtractor = new UnifiedExtractor(llmProvider)

  // composite: 写入按 group_id 路由（PROFILE→userDB，其余→scopeDB）
  const memory = new MemoryManager(compositeStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider,
    llmProvider
  })

  // scope-only: 直接查询 scope DB，用于 listing/round 等不含 group_id 的读操作
  const scopeOnlyMemory = new MemoryManager(scopeStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider,
    llmProvider
  })

  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  const retrieval = new RetrievalManager(scopeStorage, llmProvider, {
    queryExpansionProvider
  })

  m = { memory, scopeOnlyMemory, retrieval }
  _scopeManagers.set(scope, m)
  return m
}

/** 供 E2E 测试用：返回与记忆抽取同款的 LLM 适配器（使用 getLLMProvider，即默认 MiMo/智谱/OpenAI） */
export function createMemoryExtractionLLMAdapter(): ICompletionProvider {
  return new PrizmLLMAdapter()
}

/** 返回用户级 MemoryManager（兼容旧用法，新代码应使用 getUserManagers） */
export function getMemoryManager(): MemoryManager {
  return getUserManagers().memory
}

/** 返回用户级 RetrievalManager（兼容旧用法） */
export function getRetrievalManager(): RetrievalManager {
  return getUserManagers().retrieval
}

/**
 * 仅用于测试：注入 mock retrieval，user 与 scope 检索均使用此 mock
 */
export function setRetrievalManagerForTest(manager: RetrievalManager | null): void {
  if (process.env.NODE_ENV !== 'test') return
  _testRetrievalOverride = manager
  if (manager) {
    try {
      _userManagers = {
        memory: getUserManagers().memory,
        retrieval: manager
      }
    } catch {
      _userManagers = {
        memory: {} as MemoryManager,
        retrieval: manager
      }
    }
  } else {
    _userManagers = null
    _testRetrievalOverride = null
    _scopeManagers.clear()
  }
}

/**
 * 三层路由：将对话记忆写入 User/Scope/Session 层
 * @param messages 对话消息
 * @param userId   用户 ID（统一使用 MEMORY_USER_ID）
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
  const manager = getScopeManagers(scope).memory
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
    if (sessionId) {
      const sessionGroupPrefix = `${scope}:session:${sessionId}`
      const sessionMemories = created.filter(
        (c) => c.group_id === sessionGroupPrefix || c.group_id?.startsWith(sessionGroupPrefix)
      )
      if (sessionMemories.length > 0) {
        try {
          const scopeRoot = scopeStore.getScopeRootPath(scope)
          const content = sessionMemories.map((c) => `- ${c.content}`).join('\n')
          appendSessionMemories(scopeRoot, sessionId, content)
        } catch (e) {
          log.warn('Failed to append session memories snapshot:', sessionId, e)
        }
      }
    }
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
  const manager = getScopeManagers(scope).memory
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
    const created = await manager.processMemCell(memcell, routing)
    if (created.length > 0) {
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const content = created.map((c) => `- ${c.content}`).join('\n')
        appendSessionMemories(scopeRoot, sessionId, content)
      } catch (e) {
        log.warn('Failed to append session memories snapshot:', sessionId, e)
      }
    }
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
  const manager = getScopeManagers(scope).memory
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

// ---- 用户画像直接列表 API ----

/** 每轮注入的 profile 条数上限 */
const INJECT_PROFILE_LIMIT = 10

/**
 * 直接列出用户所有 PROFILE 记忆（不依赖语义搜索，确保每轮完整注入）。
 * 结果按 updated_at DESC 排序，最新的画像条目优先。
 */
export async function listAllUserProfiles(
  userId: string,
  limit: number = INJECT_PROFILE_LIMIT
): Promise<MemoryItem[]> {
  const manager = getUserManagers().memory
  const rows = await manager.listMemories(userId, 200)
  // 过滤 PROFILE 类型
  const profileRows = rows.filter((r: any) => r.type === MemoryType.PROFILE)
  return profileRows.slice(0, limit).map(mapRowToMemoryItem)
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
  return doSearchWithManager(getUserManagers().retrieval, query, userId, undefined, {
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
  const retrieval = getScopeManagers(scope).retrieval
  const defaultTypes = [MemoryType.EPISODIC_MEMORY, MemoryType.FORESIGHT]
  const scopeResults = await doSearchWithManager(retrieval, query, userId, scope, {
    ...options,
    memory_types: options?.memory_types ?? defaultTypes
  })
  const docResults = await doSearchWithManager(retrieval, query, userId, `${scope}:docs`, {
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
  return doSearchWithManager(getScopeManagers(scope).retrieval, query, userId, groupId, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.EVENT_LOG]
  })
}

/**
 * 兼容旧接口：搜索所有记忆（不区分层级）
 */
export async function searchMemories(query: string, userId: string): Promise<MemoryItem[]> {
  return doSearchWithManager(getUserManagers().retrieval, query, userId)
}

/**
 * 搜索记忆（面板/API 用）。传入 scope 时合并用户层 + scope 层结果
 */
export async function searchMemoriesWithOptions(
  query: string,
  userId: string,
  scope?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const userResults = await doSearchWithManager(
    getUserManagers().retrieval,
    query,
    userId,
    undefined,
    options
  )
  if (!scope) return userResults
  try {
    const scopeResults = await doSearchWithManager(
      getScopeManagers(scope).retrieval,
      query,
      userId,
      undefined,
      options
    )
    return mergeAndDedup([...userResults, ...scopeResults])
  } catch {
    return userResults
  }
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
async function doSearchWithManager(
  retrieval: RetrievalManager,
  query: string,
  userId: string,
  groupId?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const results = await retrieval.retrieve({
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

/** DB 行去重（按 id），保持原有排序 */
function deduplicateRows(rows: any[]): any[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}

/** 将 DB 行映射为 API 返回的 MemoryItem */
function mapRowToMemoryItem(r: {
  id: string
  content?: string
  user_id?: string
  group_id?: string | null
  type?: string
  created_at?: string
  updated_at?: string
  metadata?: unknown
}): MemoryItem {
  return {
    id: r.id,
    memory: r.content ?? '',
    user_id: r.user_id,
    group_id: r.group_id ?? undefined,
    memory_type: r.type,
    created_at: r.created_at,
    updated_at: r.updated_at,
    metadata: typeof r.metadata === 'string' ? undefined : (r.metadata as Record<string, unknown>)
  }
}

export async function getAllMemories(userId: string, scope?: string): Promise<MemoryItem[]> {
  // User DB: PROFILE 记忆（group_id IS NULL）
  const userRows = await getUserManagers().memory.listMemories(userId)
  let rows = userRows
  if (scope) {
    try {
      // Scope DB: EPISODIC / FORESIGHT / EVENT_LOG 记忆
      // 使用 scopeOnlyMemory 直接查询 scope DB，避免 composite adapter 路由问题
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.listMemories(userId)
      rows = [...userRows, ...scopeRows]
    } catch {
      // scope not found, use user only
    }
  }
  return deduplicateRows(rows).map(mapRowToMemoryItem)
}

export async function deleteMemory(id: string, scope?: string): Promise<boolean> {
  let ok = await getUserManagers().memory.deleteMemory(id)
  if (ok) return true
  if (scope) {
    try {
      ok = await getScopeManagers(scope).memory.deleteMemory(id)
    } catch {
      // scope not found
    }
  } else {
    for (const [, m] of _scopeManagers) {
      ok = await m.memory.deleteMemory(id)
      if (ok) return true
    }
  }
  return ok
}

/**
 * 按 group_id 批量删除记忆（用于 session 生命周期管理）
 */
export async function deleteMemoriesByGroupId(groupId: string): Promise<number> {
  if (groupId === null || groupId === undefined || groupId === '') {
    return getUserManagers().memory.deleteMemoriesByGroupId(groupId as any)
  }
  const scope = groupId.split(':')[0]
  return getScopeManagers(scope).memory.deleteMemoriesByGroupId(groupId)
}

/**
 * 按 group_id 前缀批量删除（用于 scope 生命周期管理）
 */
export async function deleteMemoriesByGroupPrefix(groupPrefix: string): Promise<number> {
  if (!groupPrefix || groupPrefix === '') return 0
  const scope = groupPrefix.split(':')[0]
  return getScopeManagers(scope).memory.deleteMemoriesByGroupPrefix(groupPrefix)
}

export function isMemoryEnabled(): boolean {
  return true
}

/**
 * 获取各层记忆的实际总数（直接 COUNT，不依赖语义搜索）
 */
export async function getMemoryCounts(
  userId: string,
  scope?: string
): Promise<{ userCount: number; scopeCount: number }> {
  const userCount = await getUserManagers().memory.countMemories(userId)
  let scopeCount = 0
  if (scope) {
    try {
      scopeCount = await getScopeManagers(scope).scopeOnlyMemory.countMemories(userId)
    } catch {
      // scope not found
    }
  }
  return { userCount, scopeCount }
}

/**
 * 按 round_message_id 获取该轮对话的记忆增长（用于历史消息懒加载）
 * @param scope 可选，提供时优先查 scope DB（session 记忆在此）
 */
export async function getRoundMemories(
  userId: string,
  messageId: string,
  scope?: string
): Promise<RoundMemoryGrowth | null> {
  let rows: any[] = []
  try {
    rows = await getUserManagers().memory.listMemoriesByRoundMessageId(userId, messageId)
  } catch {
    // ignore
  }
  if (scope) {
    try {
      // 使用 scopeOnlyMemory 直接查询 scope DB，避免 composite adapter 路由问题
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.listMemoriesByRoundMessageId(
        userId,
        messageId
      )
      rows = [...rows, ...scopeRows]
    } catch {
      // ignore
    }
  }
  rows = deduplicateRows(rows)
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

// ==================== 去重日志 API ====================

/**
 * 获取去重日志列表。
 * 合并查询 scopeDB + userDB（Profile 的去重日志写入 userDB，其余写入 scopeDB），
 * 按 created_at 降序排列后截取。
 */
export async function listDedupLog(
  userId: string,
  scope: string,
  limit?: number
): Promise<DedupLogEntry[]> {
  const effectiveLimit = limit ?? 50
  try {
    const scopeEntries = await getScopeManagers(scope).scopeOnlyMemory.listDedupLog(
      userId,
      effectiveLimit
    )

    // 也查询 userDB 中的去重日志（Profile 的 group_id=null → composite 路由到 userDB）
    let userEntries: DedupLogEntry[] = []
    try {
      userEntries = await getUserManagers().memory.listDedupLog(userId, effectiveLimit)
    } catch {
      // user managers 未初始化或查询失败，忽略
    }

    if (userEntries.length === 0) return scopeEntries
    if (scopeEntries.length === 0) return userEntries

    // 按 id 去重（避免 composite 查询两个 DB 返回相同记录）
    const seen = new Set<string>()
    const merged: DedupLogEntry[] = []
    for (const entry of [...scopeEntries, ...userEntries]) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      merged.push(entry)
    }
    merged.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    return merged.slice(0, effectiveLimit)
  } catch (e) {
    log.error('listDedupLog error:', e)
    return []
  }
}

/**
 * 回退一次去重：恢复被抑制的记忆。
 * 先尝试 scopeDB，再尝试 userDB（Profile 日志在 userDB 中）。
 * @returns 恢复的记忆 id，或 null 表示失败
 */
export async function undoDedupLog(dedupLogId: string, scope: string): Promise<string | null> {
  try {
    // 先尝试 scope DB
    const scopeResult = await getScopeManagers(scope).scopeOnlyMemory.undoDedup(dedupLogId)
    if (scopeResult) return scopeResult

    // 再尝试 user DB（Profile 的去重日志在此）
    try {
      const userResult = await getUserManagers().memory.undoDedup(dedupLogId)
      if (userResult) return userResult
    } catch {
      // user managers 未初始化
    }

    return null
  } catch (e) {
    log.error('undoDedupLog error:', e)
    return null
  }
}
