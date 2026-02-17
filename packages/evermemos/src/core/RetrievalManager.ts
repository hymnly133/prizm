import { StorageAdapter } from '../storage/interfaces.js'
import {
  RetrieveRequest,
  SearchResult,
  MemoryType,
  RetrieveMethod,
  IQueryExpansionProvider
} from '../types.js'
import { reciprocalRankFusion, reciprocalRankFusionMulti } from '../utils/rankFusion.js'
import {
  checkSufficiency,
  generateRefinedQueries,
  type IAgenticCompletionProvider
} from '../utils/agenticRetrieval.js'
import MiniSearch from 'minisearch'
import { Jieba } from '@node-rs/jieba'

const jieba = new Jieba()

/** CJK Unicode range for splitting mixed text */
const CJK_SEQ_RE = /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+)/
const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

/** CJK-aware tokenizer: jieba for Chinese segments, word-boundary split for the rest */
function cjkTokenize(text: string): string[] {
  if (!text) return []
  const tokens: string[] = []
  const segments = text.split(CJK_SEQ_RE)
  for (const seg of segments) {
    if (!seg) continue
    if (CJK_CHAR_RE.test(seg)) {
      for (const w of jieba.cutForSearch(seg, true)) {
        const t = w.trim()
        if (t.length > 0) tokens.push(t)
      }
    } else {
      for (const w of seg.split(/[^\w]+/)) {
        if (w.length > 0) tokens.push(w)
      }
    }
  }
  return tokens
}

export interface ILLMProvider {
  getEmbedding(text: string): Promise<number[]>
  rerank?(query: string, docs: string[]): Promise<number[]>
}

export interface RetrievalManagerOptions {
  /** 仅在使用 method=AGENTIC 时需要；用于多查询扩展，未提供时 agentic 退化为单 query 的 hybrid */
  queryExpansionProvider?: IQueryExpansionProvider
  /** Agentic 检索需要的 LLM 补全能力（充分性判断 + 补充查询生成）；不提供时退化为简单多查询 */
  agenticCompletionProvider?: IAgenticCompletionProvider
}

export class RetrievalManager {
  private storage: StorageAdapter
  private llmProvider: ILLMProvider
  private queryExpansionProvider?: IQueryExpansionProvider
  private agenticCompletionProvider?: IAgenticCompletionProvider

  constructor(
    storage: StorageAdapter,
    llmProvider: ILLMProvider,
    options?: RetrievalManagerOptions
  ) {
    this.storage = storage
    this.llmProvider = llmProvider
    this.queryExpansionProvider = options?.queryExpansionProvider
    this.agenticCompletionProvider = options?.agenticCompletionProvider
  }

  async retrieve(request: RetrieveRequest): Promise<SearchResult[]> {
    const method = request.method || RetrieveMethod.HYBRID
    const limit = request.limit ?? 10

    let results: SearchResult[]
    switch (method) {
      case RetrieveMethod.KEYWORD:
        results = await this.keywordSearch(request)
        break
      case RetrieveMethod.VECTOR:
        results = await this.vectorSearch(request)
        break
      case RetrieveMethod.HYBRID:
      case RetrieveMethod.RRF:
        results = await this.hybridSearch(request)
        break
      case RetrieveMethod.AGENTIC:
        results = await this.agenticSearch(request)
        break
      default:
        results = await this.keywordSearch(request)
    }

    if (request.use_rerank && this.llmProvider.rerank && results.length > 0) {
      results = await this.applyRerank(request.query, results)
    }
    return results.slice(0, limit)
  }

  // ---------------------------------------------------------------------------
  // P0: MiniSearch-based keyword search (replaces SQLite LIKE)
  // ---------------------------------------------------------------------------

  private async keywordSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const limit = request.limit || 20

    const conditions: string[] = []
    const params: (string | number)[] = []
    if (request.user_id) {
      conditions.push('user_id = ?')
      params.push(request.user_id)
    }
    if (request.group_id) {
      conditions.push('group_id = ?')
      params.push(request.group_id)
    }
    const maxCandidates = Math.max(limit * 10, 200)
    params.push(maxCandidates)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`
    const rows = await this.storage.relational.query(sql, params)

    if (rows.length === 0) return []

    try {
      return this.miniSearchScore(rows, request.query, limit)
    } catch {
      return this.fallbackLikeScore(rows, request.query, limit)
    }
  }

  /** Build a temporary MiniSearch index over candidate rows and score them with TF-IDF */
  private miniSearchScore(rows: any[], query: string, limit: number): SearchResult[] {
    const ms = new MiniSearch<{ id: string; content: string }>({
      fields: ['content'],
      storeFields: ['content'],
      tokenize: cjkTokenize,
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'OR'
      }
    })

    const docs = rows.map((r, i) => ({
      id: r.id ?? String(i),
      content: (r.content as string) || ''
    }))
    ms.addAll(docs)

    const hits = ms.search(query, {
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'OR'
    })

    const rowById = new Map(rows.map((r, i) => [r.id ?? String(i), r]))

    return hits.slice(0, limit).map((h) => {
      const row = rowById.get(h.id)!
      return {
        id: h.id,
        score: h.score,
        content: row.content ?? '',
        metadata: row.metadata,
        type: row.type as MemoryType,
        group_id: row.group_id,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    })
  }

  /** Fallback: simple hit-count scoring if MiniSearch fails unexpectedly */
  private fallbackLikeScore(rows: any[], query: string, limit: number): SearchResult[] {
    const tokens = cjkTokenize(query).map((t) => t.toLowerCase())
    if (tokens.length === 0) return []

    const queryLower = query.toLowerCase()

    return rows
      .map((r) => {
        const content = ((r.content as string) || '').toLowerCase()
        const contentLen = content.length || 1

        let hitCount = 0
        for (const tok of tokens) {
          let idx = 0
          while ((idx = content.indexOf(tok, idx)) !== -1) {
            hitCount++
            idx += tok.length
          }
        }
        const exactBonus = content.includes(queryLower) ? 2 : 0
        const score = exactBonus + (hitCount / contentLen) * 1000

        return {
          id: r.id,
          score,
          content: r.content ?? '',
          metadata: r.metadata,
          type: r.type as MemoryType,
          group_id: r.group_id,
          created_at: r.created_at,
          updated_at: r.updated_at
        } as SearchResult
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  // ---------------------------------------------------------------------------
  // Vector search (unchanged)
  // ---------------------------------------------------------------------------

  private async vectorSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const embedding = await this.llmProvider.getEmbedding(request.query)
    const results: SearchResult[] = []
    const types = request.memory_types || [MemoryType.EPISODIC_MEMORY]
    const limit = request.limit || 20

    for (const type of types) {
      const hits = await this.storage.vector.search(type, embedding, limit * 2)
      for (const h of hits) {
        if (request.user_id != null && h.user_id != null && h.user_id !== request.user_id) continue
        if (request.group_id != null && h.group_id != null && h.group_id !== request.group_id)
          continue
        results.push({
          id: h.id,
          score: 1 - (h._distance ?? 0),
          content: h.content ?? '',
          metadata: h,
          type: type,
          group_id: h.group_id,
          created_at: h.created_at,
          updated_at: h.updated_at
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // ---------------------------------------------------------------------------
  // Hybrid = Keyword + Vector + RRF
  // ---------------------------------------------------------------------------

  private async hybridSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const [keywordResults, vectorResults] = await Promise.all([
      this.keywordSearch(request),
      this.vectorSearch(request)
    ])
    const fused = reciprocalRankFusion(keywordResults, vectorResults)
    const limit = request.limit ?? 20
    return fused.slice(0, limit) as SearchResult[]
  }

  // ---------------------------------------------------------------------------
  // P1: Agentic multi-round retrieval with sufficiency check + LLM rerank
  // ---------------------------------------------------------------------------

  /**
   * Agentic 检索：LLM 驱动的多轮检索闭环。
   *
   * Round 1: hybridSearch -> Top 20
   *       -> LLM Rerank -> Top 5
   *       -> LLM 充分性判断 (is_sufficient?)
   * 如果足够: 返回 Round 1 的 Top 20
   * 如果不足:
   *   Round 2: LLM 生成 2-3 条补充查询
   *        -> 并行 hybridSearch
   *        -> Multi-RRF 融合
   *        -> 合并 Round1 + Round2 去重 -> 40 docs
   *        -> LLM Rerank -> Top 20
   *
   * 降级: 无 agenticCompletionProvider 时退化为简单多查询 RRF 融合。
   */
  private async agenticSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const limit = request.limit ?? 20

    if (!this.agenticCompletionProvider) {
      return this.agenticSearchFallback(request)
    }

    // ===== Round 1: hybrid search -> Top 20 =====
    const round1Request: RetrieveRequest = { ...request, limit: 20, use_rerank: false }
    let round1Results = await this.hybridSearch(round1Request)

    if (round1Results.length === 0) return []

    // ===== LLM Rerank Round 1 -> Top 5 for sufficiency check =====
    let top5ForCheck = round1Results.slice(0, 5)
    if (this.llmProvider.rerank && round1Results.length > 5) {
      try {
        const reranked = await this.applyRerank(request.query, round1Results)
        top5ForCheck = reranked.slice(0, 5)
      } catch {
        top5ForCheck = round1Results.slice(0, 5)
      }
    }

    // ===== LLM Sufficiency Check =====
    let isSufficient = true
    let missingInfo: string[] = []
    try {
      const result = await checkSufficiency(
        request.query,
        top5ForCheck,
        this.agenticCompletionProvider
      )
      isSufficient = result.isSufficient
      missingInfo = result.missingInfo
    } catch {
      return round1Results.slice(0, limit)
    }

    if (isSufficient) {
      return round1Results.slice(0, limit)
    }

    // ===== Round 2: generate refined queries + parallel hybrid search =====
    let refinedQueries: string[] = [request.query]
    try {
      const generated = await generateRefinedQueries(
        request.query,
        top5ForCheck,
        missingInfo,
        this.agenticCompletionProvider
      )
      if (generated.length > 0) refinedQueries = generated
    } catch {
      // Use original + expansion fallback
      if (this.queryExpansionProvider) {
        try {
          refinedQueries = await this.queryExpansionProvider.expandQuery(request.query)
        } catch {
          refinedQueries = [request.query]
        }
      }
    }

    const round2SubRequests: RetrieveRequest[] = refinedQueries.map((q) => ({
      ...request,
      query: q,
      limit: 20,
      use_rerank: false
    }))

    const round2AllResults = await Promise.all(round2SubRequests.map((r) => this.hybridSearch(r)))
    const round2Fused = reciprocalRankFusionMulti(round2AllResults) as SearchResult[]

    // ===== Merge Round 1 + Round 2, deduplicate =====
    const seenIds = new Set(round1Results.map((r) => r.id))
    const round2Unique = round2Fused.filter((r) => !seenIds.has(r.id))

    const combinedTotal = 40
    const combined = [...round1Results]
    const needed = combinedTotal - combined.length
    combined.push(...round2Unique.slice(0, Math.max(0, needed)))

    // ===== Final LLM Rerank =====
    let finalResults = combined
    if (this.llmProvider.rerank && combined.length > 0) {
      try {
        finalResults = await this.applyRerank(request.query, combined)
      } catch {
        finalResults = combined
      }
    }

    return finalResults.slice(0, limit)
  }

  /** Fallback agentic search: simple query expansion + multi-hybrid + RRF (no sufficiency check) */
  private async agenticSearchFallback(request: RetrieveRequest): Promise<SearchResult[]> {
    const queries: string[] =
      this.queryExpansionProvider != null
        ? await this.queryExpansionProvider.expandQuery(request.query)
        : [request.query]
    if (queries.length === 0) queries.push(request.query)

    const limit = request.limit ?? 20
    const perQueryLimit = Math.max(limit, 15)
    const subRequests: RetrieveRequest[] = queries.map((q) => ({
      ...request,
      query: q,
      limit: perQueryLimit,
      method: RetrieveMethod.HYBRID,
      use_rerank: false
    }))

    const allResults = await Promise.all(subRequests.map((r) => this.hybridSearch(r)))
    const fused = reciprocalRankFusionMulti(allResults) as SearchResult[]
    return fused.slice(0, limit)
  }

  // ---------------------------------------------------------------------------
  // Rerank helper
  // ---------------------------------------------------------------------------

  private async applyRerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    const rerank = this.llmProvider.rerank
    if (!rerank || results.length === 0) return results
    const contents = results.map((r) => r.content || '')
    const scores = await rerank.call(this.llmProvider, query, contents)
    if (scores.length !== results.length) return results
    const indexed = results.map((r, i) => ({ ...r, score: scores[i] ?? 0 }))
    indexed.sort((a, b) => b.score - a.score)
    return indexed
  }
}
