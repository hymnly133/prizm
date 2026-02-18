import {
  MemoryManager,
  RetrievalManager,
  SQLiteAdapter,
  LanceDBAdapter,
  StorageAdapter,
  MemCell,
  RawDataType,
  MemoryType,
  MemorySourceType,
  DocumentSubType,
  getLayerForType,
  USER_GROUP_ID,
  DEFAULT_USER_ID,
  RetrieveMethod,
  UnifiedExtractor,
  DefaultQueryExpansionProvider,
  MemoryRoutingContext
} from '@prizm/evermemos'
import Database from 'better-sqlite3'
import fs from 'fs'
import { randomUUID } from 'node:crypto'
// DEFAULT_USER_ID 已迁移到 @prizm/evermemos 的 DEFAULT_USER_ID
import { createLogger } from '../logger'
import { memLog } from './memoryLogger'
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
import { createCompositeStorageAdapter } from './CompositeStorageAdapter'
import { getLLMProvider, getLLMProviderName } from '../llm/index'
import { CompletionRequest, ICompletionProvider } from '@prizm/evermemos'
import { recordTokenUsage } from './tokenUsage'
import type { MemoryItem, MemoryIdsByLayer } from '@prizm/shared'
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
  llmProvider: PrizmLLMAdapter
}
const _scopeManagers = new Map<string, ScopeManagerSet>()

/** 仅测试用：注入后所有 retrieval（含 scope）均使用此 mock */
let _testRetrievalOverride: RetrievalManager | null = null

/**
 * Adapter for Prizm LLM Provider to EverMemOS LLM Provider.
 *
 * 每个实例绑定固定的 scope（不可变）和可变的 sessionId，
 * 避免模块级全局变量在并发 async 操作中互相覆盖。
 */
class PrizmLLMAdapter implements ICompletionProvider {
  private _sessionId: string | undefined

  constructor(private readonly _scope: string = 'default') {}

  /** 设置当前会话 ID（在每次记忆抽取前调用） */
  setSessionId(sessionId: string | undefined): void {
    this._sessionId = sessionId
  }

  async generate(request: CompletionRequest): Promise<string> {
    const provider = getLLMProvider()
    const messages = [{ role: 'user', content: request.prompt }]

    const model = getLLMProviderName()
    const category = (request.operationTag ??
      'memory:conversation_extract') as import('../types').TokenUsageCategory

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
      recordTokenUsage(
        category,
        this._scope,
        usage ?? { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 },
        model,
        this._sessionId,
        !usage
      )
      recordedInCatch = true
      throw err
    } finally {
      if (usage && !recordedInCatch) {
        recordTokenUsage(category, this._scope, usage, model, this._sessionId)
      }
    }

    return fullText
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (_localEmbeddingProvider) {
      return _localEmbeddingProvider(text)
    }

    const provider = getLLMProvider()
    if ('embed' in provider) {
      // @ts-ignore
      const resp = await provider.embed([text])
      return resp[0]
    }

    if (!_mockEmbeddingWarned) {
      log.warn(
        'No embedding provider available — memories will be saved without vectors. ' +
          'Vector search will be unavailable until the local embedding model is ready. ' +
          'Text-based dedup (jieba) still works.'
      )
      _mockEmbeddingWarned = true
    }
    return []
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
 * 迁移单个 SQLite 记忆数据库：将所有 user_id 统一为 DEFAULT_USER_ID。
 * 处理迁移过程中的 UNIQUE 冲突（如果相同 id 已存在则跳过）。
 */
function migrateMemoryDb(dbPath: string, label: string): void {
  if (!fs.existsSync(dbPath)) return
  try {
    const db = new Database(dbPath)
    // 查找需要迁移的记忆数量
    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id != ? AND user_id IS NOT NULL')
      .get(DEFAULT_USER_ID) as { cnt: number } | undefined
    const count = countRow?.cnt ?? 0
    if (count > 0) {
      const result = db
        .prepare('UPDATE memories SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(DEFAULT_USER_ID, DEFAULT_USER_ID)
      log.info(
        `[Migration] ${label}: unified ${result.changes} memory rows to user_id="${DEFAULT_USER_ID}"`
      )
    }
    // 同样迁移 dedup_log 表
    try {
      const dedupResult = db
        .prepare('UPDATE dedup_log SET user_id = ? WHERE user_id != ? AND user_id IS NOT NULL')
        .run(DEFAULT_USER_ID, DEFAULT_USER_ID)
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

export async function initEverMemService() {
  ensureMemoryDir()

  // 初始化本地 embedding 模型（在 EverMemService 初始化前，以便注册 provider）
  try {
    const { localEmbedding } = await import('./localEmbedding')
    await localEmbedding.init()
  } catch (e) {
    log.warn('Local embedding init failed — memories will be saved without vectors:', e)
  }

  // 启动时执行 user_id 统一迁移
  runMemoryUserIdMigration()

  const userDbPath = getUserMemoryDbPath()
  const userVecPath = getUserMemoryVecPath()

  const userSqlite = new SQLiteAdapter(userDbPath)
  const userLancedb = new LanceDBAdapter(userVecPath)
  const userStorage: StorageAdapter = {
    relational: userSqlite,
    vector: userLancedb
  }

  const llmProvider = new PrizmLLMAdapter('__user__')
  const unifiedExtractor = new UnifiedExtractor(llmProvider)
  const userMemory = new MemoryManager(userStorage, {
    unifiedExtractor,
    embeddingProvider: llmProvider
  })
  const queryExpansionProvider = new DefaultQueryExpansionProvider(llmProvider)
  const userRetrieval = new RetrievalManager(userStorage, llmProvider, {
    queryExpansionProvider,
    agenticCompletionProvider: llmProvider
  })

  _userManagers = { memory: userMemory, retrieval: userRetrieval }
  log.info('EverMemService initialized (user-level)')

  // 当本地 embedding 模型就绪后，自动补全无向量的记忆
  scheduleVectorBackfill()
}

// ==================== 向量迁移（Backfill） ====================

let _backfillPromise: Promise<void> | null = null

/**
 * 安排向量补全任务。
 * 等待本地 embedding 就绪后，扫描所有无向量记忆并逐条补全。
 */
function scheduleVectorBackfill(): void {
  // 延迟 5 秒启动，让服务端完成初始化
  setTimeout(() => void runVectorBackfill(), 5_000)
}

/** 执行向量补全。可被热重载或外部事件触发。 */
export async function runVectorBackfill(): Promise<void> {
  if (_backfillPromise) return _backfillPromise
  if (!_localEmbeddingProvider) {
    log.info('[VectorBackfill] No local embedding provider available, skipping')
    return
  }

  _backfillPromise = doVectorBackfill()
  try {
    await _backfillPromise
  } finally {
    _backfillPromise = null
  }
}

async function doVectorBackfill(): Promise<void> {
  log.info('[VectorBackfill] Starting vector backfill scan...')

  const embeddingProvider = new PrizmLLMAdapter('__backfill__')
  let totalBackfilled = 0
  let totalFailed = 0

  try {
    // 补全 user-level 记忆（LanceDB add 是幂等的，重复写入不会报错）
    const userManagers = getUserManagers()
    const userAll = await userManagers.memory.listAllMemories(DEFAULT_USER_ID)
    if (userAll.length > 0) {
      log.info(`[VectorBackfill] Scanning ${userAll.length} user memories for vector backfill`)
      for (const mem of userAll) {
        const ok = await userManagers.memory.backfillVector(
          mem.id,
          mem.type,
          mem.content,
          mem.user_id,
          mem.group_id,
          embeddingProvider
        )
        if (ok) totalBackfilled++
        else totalFailed++
      }
    }

    // 补全所有已初始化 scope 的记忆
    for (const [scopeId, managers] of _scopeManagers) {
      try {
        const scopeAll = await managers.scopeOnlyMemory.listAllMemories(DEFAULT_USER_ID)
        if (scopeAll.length > 0) {
          log.info(
            `[VectorBackfill] Scanning ${scopeAll.length} scope[${scopeId}] memories for vector backfill`
          )
          for (const mem of scopeAll) {
            const ok = await managers.scopeOnlyMemory.backfillVector(
              mem.id,
              mem.type,
              mem.content,
              mem.user_id,
              mem.group_id,
              embeddingProvider
            )
            if (ok) totalBackfilled++
            else totalFailed++
          }
        }
      } catch (e) {
        log.warn(`[VectorBackfill] Failed to backfill scope "${scopeId}":`, e)
      }
    }
  } catch (e) {
    log.error('[VectorBackfill] Backfill error:', e)
  }

  if (totalBackfilled > 0 || totalFailed > 0) {
    log.info(`[VectorBackfill] Complete: ${totalBackfilled} backfilled, ${totalFailed} failed`)
  } else {
    log.info('[VectorBackfill] No memories need vector backfill')
  }
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
        retrieval: _testRetrievalOverride,
        llmProvider: new PrizmLLMAdapter(scope)
      }
      _scopeManagers.set(`__test__${scope}`, m)
    }
    return m
  }
  let m = _scopeManagers.get(scope)
  if (m) {
    // 校验缓存的 DB 文件仍然存在，否则失效重建
    const cachedScopeRoot = scopeStore.getScopeRootPath(scope)
    if (cachedScopeRoot) {
      const expectedDbPath = getScopeMemoryDbPath(cachedScopeRoot)
      if (!fs.existsSync(expectedDbPath)) {
        memLog('cache:invalidate', {
          scope,
          detail: { reason: 'db_file_missing', expectedDbPath }
        })
        log.warn('Scope memory DB missing, invalidating cache:', scope, expectedDbPath)
        _scopeManagers.delete(scope)
        m = undefined
      }
    }
  }
  if (m) return m

  const scopeRoot = scopeStore.getScopeRootPath(scope)
  if (!scopeRoot) throw new Error(`Scope not found: ${scope}`)

  ensureScopeMemoryDir(scopeRoot)
  const scopeDbPath = getScopeMemoryDbPath(scopeRoot)
  const scopeVecPath = getScopeMemoryVecPath(scopeRoot)
  memLog('cache:init', { scope, detail: { scopeDbPath, scopeVecPath } })

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

  const llmProvider = new PrizmLLMAdapter(scope)
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
    queryExpansionProvider,
    agenticCompletionProvider: llmProvider
  })

  m = { memory, scopeOnlyMemory, retrieval, llmProvider }
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

// ==================== 双流水线对话记忆抽取 ====================

// ---- 累积器状态 ----

interface AccumulatedRound {
  roundMessageId: string
  messages: Array<{ role: string; content: string }>
  tokenEstimate: number
  /** Pipeline 1 产出的记忆 ID */
  p1MemoryIds: string[]
}

interface RoundAccumulator {
  rounds: AccumulatedRound[]
  totalTokens: number
  totalRounds: number
}

/** 以 `scope:sessionId` 为 key 维护累积器 */
const _accumulators = new Map<string, RoundAccumulator>()

/** Pipeline 2 阈值配置 */
const NARRATIVE_TOKEN_THRESHOLD = 4096
const NARRATIVE_ROUND_THRESHOLD = 8

/** 并发控制：per-session 的 mutex promise chain */
const _pipelineLocks = new Map<string, Promise<void>>()

function accumulatorKey(scope: string, sessionId?: string): string {
  return `${scope}:${sessionId ?? '__nosession__'}`
}

function getOrCreateAccumulator(key: string): RoundAccumulator {
  let acc = _accumulators.get(key)
  if (!acc) {
    acc = { rounds: [], totalTokens: 0, totalRounds: 0 }
    _accumulators.set(key, acc)
  }
  return acc
}

/** 粗略估算 token 数（中文按字符数 ÷ 1.5，英文按空格分词） */
function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const m of messages) {
    const len = m.content.length
    total += Math.ceil(len / 1.5)
  }
  return total
}

/** 清理所有会话累积器 */
export function clearSessionBuffers(): void {
  _accumulators.clear()
  _pipelineLocks.clear()
}

/**
 * 重置指定会话的累积器（回退场景专用）。
 * 与 flushSessionBuffer 不同，此方法直接丢弃累积数据而非提取记忆，
 * 因为回退场景下累积器可能包含被回退轮次的无效数据。
 */
export function resetSessionAccumulator(scope: string, sessionId?: string): void {
  const key = accumulatorKey(scope, sessionId)
  const acc = _accumulators.get(key)
  memLog('pipeline:accumulator_rollback_reset', {
    scope,
    sessionId,
    detail: {
      hadAccumulator: !!acc,
      discardedRounds: acc?.totalRounds ?? 0,
      discardedTokens: acc?.totalTokens ?? 0
    }
  })
  _accumulators.delete(key)
  _pipelineLocks.delete(key)
}

/**
 * 强制 flush 指定会话的累积器并提取记忆（session 结束时调用）。
 * 如果累积器中有未达阈值的轮次，强制触发 Pipeline 2。
 */
export async function flushSessionBuffer(
  scope: string,
  sessionId?: string
): Promise<MemoryIdsByLayer | null> {
  const key = accumulatorKey(scope, sessionId)
  const acc = _accumulators.get(key)
  if (!acc || acc.rounds.length === 0) {
    memLog('pipeline:session_flush', {
      scope,
      sessionId,
      detail: { note: 'no_pending_rounds' }
    })
    return null
  }

  memLog('pipeline:session_flush', {
    scope,
    sessionId,
    detail: {
      pendingRounds: acc.rounds.length,
      pendingTokens: acc.totalTokens
    }
  })

  // 强制触发 Pipeline 2
  const byLayer = await executePipeline2(scope, sessionId, key, acc)
  _accumulators.delete(key)
  _pipelineLocks.delete(key)
  return byLayer
}

/**
 * 双流水线入口：每轮对话完成后调用。
 *
 * Pipeline 1（立即执行）：对本轮 messages 执行 processPerRound，提取 event_log / profile / foresight。
 * Pipeline 2（条件触发）：当累积 token >= NARRATIVE_TOKEN_THRESHOLD 或 rounds >= NARRATIVE_ROUND_THRESHOLD 时，
 *   等待 Pipeline 1 完成后，对累积轮次执行 processNarrativeBatch，提取 narrative / foresight / profile。
 */
export async function addMemoryInteraction(
  messages: Array<{ role: string; content: string }>,
  scope: string,
  sessionId?: string,
  roundMessageId?: string
): Promise<MemoryIdsByLayer | null> {
  const msgId = roundMessageId ?? randomUUID()

  memLog('conv_memory:chat_trigger', {
    scope,
    sessionId,
    detail: {
      msgCount: messages.length,
      msgRoles: messages.map((m) => m.role),
      msgLengths: messages.map((m) => m.content.length),
      totalChars: messages.reduce((s, m) => s + m.content.length, 0),
      roundMessageId: msgId
    }
  })

  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)
  const key = accumulatorKey(scope, sessionId)

  try {
    // ── Pipeline 1：每轮轻量抽取（event_log / profile / foresight） ──
    memLog('pipeline:p1_start', {
      scope,
      sessionId,
      detail: { roundMessageId: msgId, messageCount: messages.length }
    })

    const p1Routing: MemoryRoutingContext = {
      scope,
      sessionId,
      roundMessageId: msgId,
      sourceType: MemorySourceType.CONVERSATION
    }
    const p1Memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }

    let p1Lock: { resolve: () => void }
    const p1Promise = new Promise<void>((resolve) => {
      p1Lock = { resolve }
    })
    _pipelineLocks.set(key, p1Promise)

    let p1Created: Array<{ id: string; type: string; content: string; group_id?: string }> = []
    try {
      p1Created = await managers.memory.processPerRound(p1Memcell, p1Routing)
      memLog('pipeline:p1_done', {
        scope,
        sessionId,
        detail: {
          roundMessageId: msgId,
          createdCount: p1Created.length,
          createdTypes: p1Created.map((c) => c.type),
          createdIds: p1Created.map((c) => c.id)
        }
      })
    } catch (e) {
      memLog('pipeline:p1_error', { scope, sessionId, error: e })
    } finally {
      p1Lock!.resolve()
    }

    // ── 累积本轮 ──
    const tokenEstimate = estimateTokens(messages)
    const acc = getOrCreateAccumulator(key)
    acc.rounds.push({
      roundMessageId: msgId,
      messages,
      tokenEstimate,
      p1MemoryIds: p1Created.map((c) => c.id)
    })
    acc.totalTokens += tokenEstimate
    acc.totalRounds += 1

    memLog('pipeline:accumulator_append', {
      scope,
      sessionId,
      detail: {
        roundMessageId: msgId,
        roundTokens: tokenEstimate,
        totalTokens: acc.totalTokens,
        totalRounds: acc.totalRounds,
        p1MemoryCount: p1Created.length
      }
    })

    // ── 构建 P1 的返回结果 ──
    const byLayer: MemoryIdsByLayer = { user: [], scope: [], session: [] }
    for (const c of p1Created) {
      const layer = getLayerForType(c.type as MemoryType)
      if (layer === 'user') {
        byLayer.user.push(c.id)
      } else if (layer === 'session') {
        byLayer.session.push(c.id)
      } else {
        byLayer.scope.push(c.id)
      }
    }

    // 写入 session memories snapshot
    if (sessionId && p1Created.length > 0) {
      const sessionGroupPrefix = `${scope}:session:${sessionId}`
      const sessionMemories = p1Created.filter(
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

    // ── Pipeline 2 阈值检查 ──
    const shouldTriggerP2 =
      acc.totalTokens >= NARRATIVE_TOKEN_THRESHOLD || acc.totalRounds >= NARRATIVE_ROUND_THRESHOLD

    memLog('pipeline:p2_threshold_check', {
      scope,
      sessionId,
      detail: {
        totalTokens: acc.totalTokens,
        totalRounds: acc.totalRounds,
        tokenThreshold: NARRATIVE_TOKEN_THRESHOLD,
        roundThreshold: NARRATIVE_ROUND_THRESHOLD,
        triggered: shouldTriggerP2
      }
    })

    if (shouldTriggerP2) {
      // Pipeline 2 在后台异步执行，不阻塞当前返回
      const accSnapshot = { ...acc, rounds: [...acc.rounds] }
      // 重置累积器
      _accumulators.set(key, { rounds: [], totalTokens: 0, totalRounds: 0 })
      memLog('pipeline:accumulator_reset', { scope, sessionId })

      // 后台执行 Pipeline 2（fire-and-forget，但捕获错误以记录日志）
      executePipeline2(scope, sessionId, key, accSnapshot)
        .then((p2Result) => {
          if (p2Result) {
            // Pipeline 2 的记忆不需要合并到当前返回值（已经返回了 P1 结果）
            log.info(
              'Pipeline 2 completed: scope=%s session=%s user=%d scope=%d',
              scope,
              sessionId,
              p2Result.user.length,
              p2Result.scope.length
            )
          }
        })
        .catch((e) => {
          log.error('Pipeline 2 background execution error:', e)
        })
    }

    return p1Created.length > 0 ? byLayer : null
  } finally {
    managers.llmProvider.setSessionId(undefined)
  }
}

/**
 * 执行 Pipeline 2：叙述性批量抽取。
 * 等待 Pipeline 1 lock 释放后执行，收集所有累积轮次的消息和 P1 已提取记忆。
 */
async function executePipeline2(
  scope: string,
  sessionId: string | undefined,
  key: string,
  acc: RoundAccumulator
): Promise<MemoryIdsByLayer | null> {
  // 等待 Pipeline 1 完成
  const currentLock = _pipelineLocks.get(key)
  if (currentLock) {
    await currentLock
  }

  memLog('pipeline:p2_start', {
    scope,
    sessionId,
    detail: {
      roundCount: acc.rounds.length,
      totalTokens: acc.totalTokens,
      roundMessageIds: acc.rounds.map((r) => r.roundMessageId)
    }
  })

  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)

  try {
    // 收集所有累积轮次的消息
    const allMessages: Array<{ role: string; content: string }> = []
    const allRoundIds: string[] = []
    for (const round of acc.rounds) {
      allMessages.push(...round.messages)
      allRoundIds.push(round.roundMessageId)
    }

    // 收集 Pipeline 1 已提取的记忆内容摘要
    const allP1MemoryIds = acc.rounds.flatMap((r) => r.p1MemoryIds)
    let alreadyExtractedContext = ''
    if (allP1MemoryIds.length > 0) {
      try {
        const scopeManagers = getScopeManagers(scope)
        const placeholders = allP1MemoryIds.map(() => '?').join(',')
        const p1Rows = await scopeManagers.scopeOnlyMemory.storage.relational.query(
          `SELECT type, content FROM memories WHERE id IN (${placeholders})`,
          allP1MemoryIds
        )
        // 也查 user DB（profile 可能在那里）
        let userRows: Array<{ type: string; content: string }> = []
        try {
          userRows = await getUserManagers().memory.storage.relational.query(
            `SELECT type, content FROM memories WHERE id IN (${placeholders})`,
            allP1MemoryIds
          )
        } catch {
          // ignore
        }

        const allRows = [...p1Rows, ...userRows] as Array<{ type: string; content: string }>
        if (allRows.length > 0) {
          const sections: Record<string, string[]> = {}
          for (const row of allRows) {
            if (!sections[row.type]) sections[row.type] = []
            sections[row.type].push(row.content?.slice(0, 200) ?? '')
          }
          alreadyExtractedContext = Object.entries(sections)
            .map(([type, contents]) => `[${type}]\n${contents.map((c) => `- ${c}`).join('\n')}`)
            .join('\n\n')
        }
      } catch (e) {
        log.warn('Failed to collect P1 memory context for P2:', e)
      }
    }

    const p2Routing: MemoryRoutingContext = {
      scope,
      sessionId,
      roundMessageIds: allRoundIds,
      sourceType: MemorySourceType.CONVERSATION
    }
    const p2Memcell: MemCell = {
      original_data: allMessages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }

    const p2Created = await managers.memory.processNarrativeBatch(
      p2Memcell,
      p2Routing,
      alreadyExtractedContext || undefined
    )

    memLog('pipeline:p2_done', {
      scope,
      sessionId,
      detail: {
        createdCount: p2Created.length,
        createdTypes: p2Created.map((c: { type: string }) => c.type),
        createdIds: p2Created.map((c: { id: string }) => c.id),
        roundMessageIds: allRoundIds
      }
    })

    if (p2Created.length === 0) return null

    // 按层分类
    const byLayer: MemoryIdsByLayer = { user: [], scope: [], session: [] }
    for (const c of p2Created) {
      const layer = getLayerForType(c.type as MemoryType)
      if (layer === 'user') {
        byLayer.user.push(c.id)
      } else if (layer === 'session') {
        byLayer.session.push(c.id)
      } else {
        byLayer.scope.push(c.id)
      }
    }

    // 写入 session snapshot
    if (sessionId && p2Created.length > 0) {
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const content = p2Created.map((c: { content: string }) => `- [P2] ${c.content}`).join('\n')
        appendSessionMemories(scopeRoot, sessionId, content)
      } catch (e) {
        log.warn('Failed to append P2 session memories snapshot:', sessionId, e)
      }
    }

    return byLayer
  } catch (e) {
    memLog('pipeline:p2_error', { scope, sessionId, error: e })
    log.error('Pipeline 2 execution error:', e)
    return null
  } finally {
    managers.llmProvider.setSessionId(undefined)
  }
}

/**
 * 将指定轮次的对话批量抽取为 Session 层记忆（仅 EventLog）
 * 用于 A/B 滑动窗口压缩：将最老 B 轮对话抽取为记忆后，不再发送原始上下文
 */
export async function addSessionMemoryFromRounds(
  messages: Array<{ role: string; content: string }>,
  scope: string,
  sessionId: string
): Promise<void> {
  if (!messages.length) return
  memLog('conv_memory:compression_trigger', {
    scope,
    sessionId,
    detail: {
      messageCount: messages.length,
      totalChars: messages.reduce((s, m) => s + m.content.length, 0)
    }
  })
  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)
  try {
    const routing: MemoryRoutingContext = {
      scope,
      sessionId,
      sessionOnly: true,
      sourceType: MemorySourceType.COMPRESSION
    }
    const memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }
    const created = await managers.memory.processNarrativeBatch(memcell, routing)
    memLog('conv_memory:flush_result', {
      scope,
      sessionId,
      detail: {
        source: 'compression',
        createdCount: created.length,
        createdTypes: created.map((c) => c.type),
        createdIds: created.map((c) => c.id)
      }
    })
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
    managers.llmProvider.setSessionId(undefined)
  }
}

/**
 * 将文档内容写入 Scope 层 DOCUMENT 记忆（总览 + 原子事实）。
 * - narrative → type=DOCUMENT, sub_type=overview
 * - event_log facts → type=DOCUMENT, sub_type=fact
 * @param scope      数据 scope
 * @param documentId 文档 ID
 */
export async function addDocumentToMemory(scope: string, documentId: string): Promise<void> {
  memLog('memory:store', { scope, documentId, detail: { phase: 'addDocumentToMemory:start' } })
  const manager = getScopeManagers(scope).memory
  const data = scopeStore.getScopeData(scope)
  const doc = data.documents.find((d) => d.id === documentId)
  if (!doc) {
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:skip', reason: 'doc_not_found' }
    })
    log.warn('Document not found for memory:', documentId, 'scope:', scope)
    return
  }

  const content = doc.content?.trim() ?? ''
  if (!content) {
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:skip', reason: 'no_content' }
    })
    log.info('Document has no content for memory:', documentId)
    return
  }

  const title = doc.title ?? documentId

  const routing: MemoryRoutingContext = {
    scope,
    sourceType: MemorySourceType.DOCUMENT,
    sourceDocumentId: documentId
  }
  const memcell: MemCell = {
    original_data: { documentId, title },
    timestamp: new Date().toISOString(),
    type: RawDataType.TEXT,
    text: content.slice(0, 8000),
    deleted: false,
    scene: 'document',
    metadata: {
      documentId,
      title
    }
  }
  try {
    await manager.processDocumentMemCell(memcell, routing)
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:done', title, textLen: content.slice(0, 8000).length }
    })
    log.info('Document memory stored:', documentId, 'scope:', scope)
  } catch (e) {
    memLog('manager:error', {
      scope,
      documentId,
      detail: { phase: 'processDocumentMemCell' },
      error: e
    })
    throw e
  }
}

/**
 * 删除指定文档的记忆。默认仅删除 overview + fact（不删迁移记忆）。
 * @param subTypes 要删除的 DocumentSubType 列表，默认 [overview, fact]
 * @returns 删除的记忆数量
 */
export async function deleteDocumentMemories(
  scope: string,
  documentId: string,
  subTypes: DocumentSubType[] = [DocumentSubType.OVERVIEW, DocumentSubType.FACT]
): Promise<number> {
  const managers = getScopeManagers(scope)
  let total = 0

  // 使用 source_document_id 索引查询（优先），回退到 metadata json_extract
  const allRows = await managers.scopeOnlyMemory.storage.relational.query(
    `SELECT id, sub_type FROM memories WHERE source_document_id = ? AND type = ?`,
    [documentId, MemoryType.DOCUMENT]
  )
  // 若索引查询为空，回退到 metadata（兼容旧数据）
  const rows =
    allRows.length > 0
      ? allRows
      : await managers.scopeOnlyMemory.listMemoriesByMetadata(
          'documentId',
          documentId,
          scope,
          MemoryType.DOCUMENT
        )
  for (const row of rows) {
    const r = row as { id: string; sub_type?: string }
    if (subTypes.includes(r.sub_type as DocumentSubType)) {
      await managers.scopeOnlyMemory.deleteMemory(r.id)
      total++
    }
  }
  if (total > 0) {
    log.info(
      'Deleted %d document memories for %s (subTypes=%s)',
      total,
      documentId,
      subTypes.join(',')
    )
  }
  return total
}

/**
 * 追加文档迁移记忆。每条 change 作为独立的 DOCUMENT(migration) 写入 Scope 层。
 * @param version 文档版本号，记录在 metadata 中
 */
export async function addDocumentMigrationMemory(
  scope: string,
  documentId: string,
  title: string,
  changes: string[],
  version?: number,
  changedBy?: { type: string; sessionId?: string; apiSource?: string }
): Promise<void> {
  if (!changes.length) return
  memLog('memory:store', {
    scope,
    documentId,
    detail: { phase: 'addDocumentMigrationMemory', changesCount: changes.length, version }
  })

  const manager = getScopeManagers(scope).memory
  const groupId = scope
  const now = new Date().toISOString()
  const embeddingProvider = new PrizmLLMAdapter(scope)

  for (const change of changes) {
    if (!change.trim()) continue
    const id = randomUUID()

    let embedding: number[] | undefined
    try {
      embedding = await embeddingProvider.getEmbedding(change)
    } catch (e) {
      log.warn('Migration memory embedding failed:', e)
    }

    const migrationMeta: Record<string, unknown> = {
      documentId,
      title,
      ...(version !== undefined && { version }),
      ...(changedBy && { changedBy })
    }

    const contentStr = change.trim()

    await manager.storage.relational.insert('memories', {
      id,
      type: MemoryType.DOCUMENT,
      content: contentStr,
      user_id: DEFAULT_USER_ID,
      group_id: groupId,
      created_at: now,
      updated_at: now,
      metadata: JSON.stringify(migrationMeta),
      source_type: MemorySourceType.DOCUMENT,
      source_document_id: documentId,
      sub_type: DocumentSubType.MIGRATION
    })
    if (embedding?.length) {
      await manager.storage.vector.add(MemoryType.DOCUMENT, [
        {
          id,
          content: contentStr,
          user_id: DEFAULT_USER_ID,
          group_id: groupId,
          vector: embedding
        }
      ])
    }
  }
  log.info(
    'Migration memories added: %d changes for doc %s v%s',
    changes.length,
    documentId,
    version ?? '?'
  )
}

/**
 * 获取文档的总览记忆（DOCUMENT + sub_type=overview）。
 * 用于 scopeContext 注入，替代 llmSummary。
 * @returns 总览内容字符串，或 null（尚未生成）
 */
export async function getDocumentOverview(
  scope: string,
  documentId: string
): Promise<string | null> {
  try {
    const managers = getScopeManagers(scope)
    // 优先使用 source_document_id 索引查询
    const rows = await managers.scopeOnlyMemory.storage.relational.query(
      `SELECT content, sub_type FROM memories WHERE source_document_id = ? AND type = ? AND sub_type = ? LIMIT 1`,
      [documentId, MemoryType.DOCUMENT, DocumentSubType.OVERVIEW]
    )
    if (rows.length > 0) {
      return (rows[0] as { content?: string }).content || null
    }
    // 回退：旧数据可能无 source_document_id
    const legacyRows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
      'documentId',
      documentId,
      scope,
      MemoryType.DOCUMENT
    )
    for (const row of legacyRows) {
      const r = row as { sub_type?: string; content?: string }
      if (r.sub_type === DocumentSubType.OVERVIEW) {
        return r.content || null
      }
    }
    return null
  } catch (e) {
    log.warn('getDocumentOverview error:', documentId, e)
    return null
  }
}

/**
 * 获取文档的迁移记忆列表（按时间倒序）。
 */
export async function getDocumentMigrationHistory(
  scope: string,
  documentId: string
): Promise<MemoryItem[]> {
  try {
    const managers = getScopeManagers(scope)
    const rows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
      'documentId',
      documentId,
      scope,
      MemoryType.DOCUMENT
    )
    return rows
      .filter((row) => {
        const r = row as any
        return r.sub_type === DocumentSubType.MIGRATION
      })
      .map((r) => mapRowToMemoryItem(r as any))
  } catch (e) {
    log.warn('getDocumentMigrationHistory error:', documentId, e)
    return []
  }
}

/**
 * 获取指定文档的全部记忆（overview + fact + migration），按 source_document_id 索引查询。
 * 回退兼容：若无 source_document_id 数据，使用 metadata.documentId 查询。
 */
export async function getDocumentAllMemories(
  scope: string,
  documentId: string
): Promise<MemoryItem[]> {
  try {
    const managers = getScopeManagers(scope)
    // 优先使用 source_document_id 索引
    let rows = await managers.scopeOnlyMemory.storage.relational.query(
      `SELECT * FROM memories WHERE source_document_id = ? AND type = ? ORDER BY created_at DESC`,
      [documentId, MemoryType.DOCUMENT]
    )
    // 回退：旧数据无 source_document_id
    if (rows.length === 0) {
      rows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
        'documentId',
        documentId,
        scope,
        MemoryType.DOCUMENT
      )
    }
    return deduplicateRows(rows).map((r: any) => mapRowToMemoryItem(r))
  } catch (e) {
    log.warn('getDocumentAllMemories error:', documentId, e)
    return []
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
  limit: number = INJECT_PROFILE_LIMIT
): Promise<MemoryItem[]> {
  const manager = getUserManagers().memory
  const rows = await manager.listMemories(DEFAULT_USER_ID, 200)
  // 过滤 PROFILE 类型
  const profileRows = rows.filter((r: any) => r.type === MemoryType.PROFILE)
  return profileRows.slice(0, limit).map(mapRowToMemoryItem)
}

// ---- 三层检索 API ----

/**
 * User 层检索：Profile 记忆（group_id="user"）
 */
export async function searchUserMemories(
  query: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  return doSearchWithManager(getUserManagers().retrieval, query, DEFAULT_USER_ID, USER_GROUP_ID, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.PROFILE]
  })
}

/**
 * Scope 层检索：Narrative + Foresight + Document 记忆
 * group_id = scope
 */
export async function searchScopeMemories(
  query: string,
  scope: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const retrieval = getScopeManagers(scope).retrieval
  const defaultTypes = [MemoryType.NARRATIVE, MemoryType.FORESIGHT, MemoryType.DOCUMENT]
  return doSearchWithManager(retrieval, query, DEFAULT_USER_ID, scope, {
    ...options,
    memory_types: options?.memory_types ?? defaultTypes
  })
}

/**
 * Session 层检索：EventLog 记忆
 * group_id = scope:session:sessionId
 */
export async function searchSessionMemories(
  query: string,
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const groupId = `${scope}:session:${sessionId}`
  return doSearchWithManager(getScopeManagers(scope).retrieval, query, DEFAULT_USER_ID, groupId, {
    ...options,
    memory_types: options?.memory_types ?? [MemoryType.EVENT_LOG]
  })
}

/**
 * 兼容旧接口：搜索所有记忆（不区分层级）
 */
export async function searchMemories(query: string): Promise<MemoryItem[]> {
  return doSearchWithManager(getUserManagers().retrieval, query, DEFAULT_USER_ID)
}

/**
 * 搜索记忆（面板/API 用）。传入 scope 时合并用户层 + scope 层结果
 */
export async function searchMemoriesWithOptions(
  query: string,
  scope?: string,
  options?: MemorySearchOptions
): Promise<MemoryItem[]> {
  const userResults = await doSearchWithManager(
    getUserManagers().retrieval,
    query,
    DEFAULT_USER_ID,
    undefined,
    options
  )
  if (!scope) return userResults
  try {
    const scopeResults = await doSearchWithManager(
      getScopeManagers(scope).retrieval,
      query,
      DEFAULT_USER_ID,
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
  scope: string,
  options?: MemorySearchOptions
): Promise<{ user: MemoryItem[]; scope: MemoryItem[] }> {
  const [userMem, scopeMem] = await Promise.all([
    searchUserMemories(query, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, scope, {
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
  scope: string,
  sessionId: string,
  options?: MemorySearchOptions
): Promise<{
  user: MemoryItem[]
  scope: MemoryItem[]
  session: MemoryItem[]
}> {
  const [userMem, scopeMem, sessionMem] = await Promise.all([
    searchUserMemories(query, { ...options, limit: options?.limit ?? INJECT_USER_LIMIT }),
    searchScopeMemories(query, scope, {
      ...options,
      limit: options?.limit ?? INJECT_SCOPE_LIMIT
    }),
    searchSessionMemories(query, scope, sessionId, {
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
  userId = DEFAULT_USER_ID,
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
    group_id: r.group_id ?? undefined,
    memory_type: r.type,
    memory_layer: getLayerForType(r.type),
    source_type: r.source_type ?? undefined,
    sub_type: r.sub_type ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
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

/** 将 DB 行映射为 API 返回的 MemoryItem（含引用索引字段 + 新增层级/来源/子类型） */
function mapRowToMemoryItem(r: {
  id: string
  content?: string
  user_id?: string
  group_id?: string | null
  type?: string
  created_at?: string
  updated_at?: string
  metadata?: unknown
  source_type?: string | null
  source_session_id?: string | null
  source_round_id?: string | null
  source_round_ids?: string | null
  source_document_id?: string | null
  sub_type?: string | null
}): MemoryItem {
  let meta: Record<string, unknown> | undefined
  if (typeof r.metadata === 'string') {
    try {
      meta = JSON.parse(r.metadata)
    } catch {
      meta = undefined
    }
  } else if (r.metadata && typeof r.metadata === 'object') {
    meta = r.metadata as Record<string, unknown>
  }

  const memoryType = r.type as MemoryType | undefined
  const memoryLayer = memoryType ? getLayerForType(memoryType) : undefined

  let sourceRoundIds: string[] | undefined
  if (r.source_round_ids) {
    try {
      const parsed = JSON.parse(r.source_round_ids)
      if (Array.isArray(parsed)) sourceRoundIds = parsed
    } catch {
      // invalid JSON, ignore
    }
  }

  return {
    id: r.id,
    memory: r.content ?? '',
    user_id: r.user_id,
    group_id: r.group_id ?? undefined,
    memory_type: r.type,
    memory_layer: memoryLayer,
    source_type: r.source_type ?? undefined,
    source_session_id: r.source_session_id ?? undefined,
    source_round_id: r.source_round_id ?? undefined,
    source_round_ids: sourceRoundIds,
    source_document_id: r.source_document_id ?? undefined,
    sub_type: r.sub_type ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    metadata: meta,
    ref_count: typeof meta?.ref_count === 'number' ? meta.ref_count : undefined,
    last_ref_at: typeof meta?.last_ref_at === 'string' ? meta.last_ref_at : undefined
  }
}

export async function getAllMemories(scope?: string): Promise<MemoryItem[]> {
  // User DB: PROFILE 记忆（group_id="user"）
  const userRows = await getUserManagers().memory.listMemories()
  let rows = userRows
  if (scope) {
    try {
      // Scope DB: NARRATIVE / FORESIGHT / DOCUMENT / EVENT_LOG 记忆
      // 使用 scopeOnlyMemory 直接查询 scope DB，避免 composite adapter 路由问题
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.listMemories()
      rows = [...userRows, ...scopeRows]
    } catch {
      // scope not found, use user only
    }
  }
  return deduplicateRows(rows).map(mapRowToMemoryItem)
}

/** 按 ID 查询单条记忆（先查 user 库，再查 scope 库） */
export async function getMemoryById(id: string, scope?: string): Promise<MemoryItem | null> {
  const userRows = await getUserManagers().memory.storage.relational.query(
    'SELECT * FROM memories WHERE id = ? LIMIT 1',
    [id]
  )
  if (userRows.length > 0) return mapRowToMemoryItem(userRows[0] as any)
  if (scope) {
    try {
      const scopeRows = await getScopeManagers(scope).scopeOnlyMemory.storage.relational.query(
        'SELECT * FROM memories WHERE id = ? LIMIT 1',
        [id]
      )
      if (scopeRows.length > 0) return mapRowToMemoryItem(scopeRows[0] as any)
    } catch {
      // scope not found
    }
  }
  return null
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
  if (groupId === USER_GROUP_ID) {
    return getUserManagers().memory.deleteMemoriesByGroupId(groupId)
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
 * 清空所有记忆（User DB + 所有已初始化的 Scope DB）。
 * 包括 SQLite 记录和 LanceDB 向量索引。
 */
export async function clearAllMemories(): Promise<number> {
  let total = 0

  // 清空 user-level DB
  try {
    total += await getUserManagers().memory.clearAllMemories()
  } catch (e) {
    log.error('Failed to clear user memories:', e)
  }

  // 清空所有已初始化的 scope DB
  for (const [scopeId, managers] of _scopeManagers) {
    try {
      total += await managers.scopeOnlyMemory.clearAllMemories()
      log.info(`Cleared scope "${scopeId}" memories`)
    } catch (e) {
      log.error(`Failed to clear scope "${scopeId}" memories:`, e)
    }
  }

  // 清除缓存，下次访问时重建连接
  _scopeManagers.clear()
  memLog('memory:clear', { detail: { totalDeleted: total } })
  log.info(`All memories cleared: ${total} records deleted`)
  return total
}

/**
 * 强制失效指定 scope 的 MemoryManager 缓存。
 * 用于 clean-data 后或文件系统级别操作后重建连接。
 */
export function invalidateScopeManagerCache(scope?: string): void {
  if (scope) {
    _scopeManagers.delete(scope)
    memLog('cache:invalidate', { scope, detail: { reason: 'manual_invalidate' } })
    log.info('Invalidated scope manager cache:', scope)
  } else {
    _scopeManagers.clear()
    memLog('cache:invalidate', { detail: { reason: 'manual_invalidate_all' } })
    log.info('Invalidated all scope manager caches')
  }
}

/** 按类型分组的记忆计数 */
export interface MemoryCountsByType {
  /** 总计: User 层 */
  userCount: number
  /** 总计: Scope 层（不含 session 记忆） */
  scopeCount: number
  /** 总计: Session 层（group_id 匹配 {scope}:session:* 的记忆） */
  sessionCount: number
  /** 按类型分组: { profile: N, narrative: N, foresight: N, document: N, event_log: N } */
  byType: Record<string, number>
}

/**
 * 获取各层记忆的实际总数 + 按类型分组计数（直接 COUNT，不依赖语义搜索）。
 * 将 session 层记忆（group_id 含 :session:）从 scopeCount 中分离出来。
 */
export async function getMemoryCounts(scope?: string): Promise<MemoryCountsByType> {
  const userByType = await getUserManagers().memory.countMemoriesByType()
  const userCount = Object.values(userByType).reduce((s, n) => s + n, 0)

  let scopeByType: Record<string, number> = {}
  let scopeTotalCount = 0
  let sessionCount = 0
  if (scope) {
    try {
      const managers = getScopeManagers(scope)
      scopeByType = await managers.scopeOnlyMemory.countMemoriesByType()
      scopeTotalCount = Object.values(scopeByType).reduce((s, n) => s + n, 0)

      // 分离 session 记忆：group_id 匹配 {scope}:session:* 模式
      const sessionPrefix = `${scope}:session:`
      try {
        const rows = await managers.scopeOnlyMemory.storage.relational.query(
          'SELECT COUNT(*) as cnt FROM memories WHERE group_id LIKE ?',
          [`${sessionPrefix}%`]
        )
        sessionCount = (rows[0] as { cnt: number })?.cnt ?? 0
      } catch {
        // 查询失败不影响总数
      }
    } catch {
      // scope not found
    }
  }

  const scopeCount = scopeTotalCount - sessionCount

  const byType: Record<string, number> = {}
  for (const [t, c] of Object.entries(userByType)) byType[t] = (byType[t] ?? 0) + c
  for (const [t, c] of Object.entries(scopeByType)) byType[t] = (byType[t] ?? 0) + c

  return { userCount, scopeCount, sessionCount, byType }
}

/**
 * 按层精确解析记忆 ID → MemoryItem（用于客户端懒加载）。
 * 每个 ID 只查对应层的 DB，不盲查。已删除的 ID 返回 null。
 */
export async function resolveMemoryIds(
  byLayer: MemoryIdsByLayer,
  scope?: string
): Promise<Record<string, MemoryItem | null>> {
  const result: Record<string, MemoryItem | null> = {}
  const allIds = [...byLayer.user, ...byLayer.scope, ...byLayer.session]
  for (const id of allIds) result[id] = null

  // User DB
  if (byLayer.user.length > 0) {
    try {
      const placeholders = byLayer.user.map(() => '?').join(',')
      const rows = await getUserManagers().memory.storage.relational.query(
        `SELECT * FROM memories WHERE id IN (${placeholders})`,
        byLayer.user
      )
      for (const r of rows) {
        result[r.id] = mapRowToMemoryItem(r)
      }
    } catch {
      // user managers not initialized
    }
  }

  // Scope DB
  const scopeIds = [...byLayer.scope, ...byLayer.session]
  if (scopeIds.length > 0 && scope) {
    try {
      const placeholders = scopeIds.map(() => '?').join(',')
      const rows = await getScopeManagers(scope).scopeOnlyMemory.storage.relational.query(
        `SELECT * FROM memories WHERE id IN (${placeholders})`,
        scopeIds
      )
      for (const r of rows) {
        result[r.id] = mapRowToMemoryItem(r)
      }
    } catch {
      // scope not found
    }
  }

  return result
}

/**
 * 按层批量更新记忆引用索引（ref_count += 1, last_ref_at = NOW）。
 * fire-and-forget 调用，不阻塞对话流程。
 */
export async function updateMemoryRefStats(
  byLayer: MemoryIdsByLayer,
  scope?: string
): Promise<void> {
  const now = new Date().toISOString()

  // User DB
  if (byLayer.user.length > 0) {
    try {
      for (const id of byLayer.user) {
        await getUserManagers().memory.storage.relational.query(
          `UPDATE memories SET metadata = json_set(
            COALESCE(metadata, '{}'),
            '$.ref_count', COALESCE(json_extract(metadata, '$.ref_count'), 0) + 1,
            '$.last_ref_at', ?
          ) WHERE id = ?`,
          [now, id]
        )
      }
    } catch (e) {
      log.warn('updateMemoryRefStats user failed:', e)
    }
  }

  // Scope DB
  const scopeIds = [...byLayer.scope, ...byLayer.session]
  if (scopeIds.length > 0 && scope) {
    try {
      for (const id of scopeIds) {
        await getScopeManagers(scope).scopeOnlyMemory.storage.relational.query(
          `UPDATE memories SET metadata = json_set(
            COALESCE(metadata, '{}'),
            '$.ref_count', COALESCE(json_extract(metadata, '$.ref_count'), 0) + 1,
            '$.last_ref_at', ?
          ) WHERE id = ?`,
          [now, id]
        )
      }
    } catch (e) {
      log.warn('updateMemoryRefStats scope failed:', e)
    }
  }
}

// ==================== 去重日志 API ====================

/**
 * 获取去重日志列表。
 * 合并查询 scopeDB + userDB（Profile 的去重日志写入 userDB，其余写入 scopeDB），
 * 按 created_at 降序排列后截取。
 */
export async function listDedupLog(scope: string, limit?: number): Promise<DedupLogEntry[]> {
  const effectiveLimit = limit ?? 50
  try {
    const scopeEntries = await getScopeManagers(scope).scopeOnlyMemory.listDedupLog(
      DEFAULT_USER_ID,
      effectiveLimit
    )

    // 也查询 userDB 中的去重日志（Profile 的 group_id="user" → composite 路由到 userDB）
    let userEntries: DedupLogEntry[] = []
    try {
      userEntries = await getUserManagers().memory.listDedupLog(DEFAULT_USER_ID, effectiveLimit)
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
