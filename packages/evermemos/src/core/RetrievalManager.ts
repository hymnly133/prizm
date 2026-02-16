import { StorageAdapter } from '../storage/interfaces.js'
import {
  RetrieveRequest,
  SearchResult,
  MemoryType,
  RetrieveMethod,
  IQueryExpansionProvider
} from '../types.js'
import { reciprocalRankFusion, reciprocalRankFusionMulti } from '../utils/rankFusion.js'
import { Jieba } from '@node-rs/jieba'
const jieba = new Jieba()

export interface ILLMProvider {
  getEmbedding(text: string): Promise<number[]>
  rerank?(query: string, docs: string[]): Promise<number[]>
}

export interface RetrievalManagerOptions {
  /** 仅在使用 method=AGENTIC 时需要；用于多查询扩展，未提供时 agentic 退化为单 query 的 hybrid */
  queryExpansionProvider?: IQueryExpansionProvider
}

export class RetrievalManager {
  private storage: StorageAdapter
  private llmProvider: ILLMProvider
  private queryExpansionProvider?: IQueryExpansionProvider

  constructor(
    storage: StorageAdapter,
    llmProvider: ILLMProvider,
    options?: RetrievalManagerOptions
  ) {
    this.storage = storage
    this.llmProvider = llmProvider
    this.queryExpansionProvider = options?.queryExpansionProvider
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

  private async keywordSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const tokens: string[] = jieba.cut(request.query, true)
    const validTokens = tokens.filter((t: string) => t.trim().length > 0)
    const likePart = validTokens.join('%')
    if (!likePart) return []

    const limit = request.limit || 20
    const conditions: string[] = ['content LIKE ?']
    const params: (string | number)[] = [`%${likePart}%`]
    if (request.user_id) {
      conditions.push('user_id = ?')
      params.push(request.user_id)
    }
    if (request.group_id) {
      conditions.push('group_id = ?')
      params.push(request.group_id)
    }
    params.push(limit)
    const sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} LIMIT ?`
    const rows = await this.storage.relational.query(sql, params)

    const queryLower = request.query.toLowerCase()
    const tokensLower = validTokens.map((t) => t.toLowerCase())

    return rows
      .map((r) => {
        const content = (r.content as string) || ''
        const contentLower = content.toLowerCase()
        const contentLen = content.length || 1

        let hitCount = 0
        for (const tok of tokensLower) {
          let idx = 0
          while ((idx = contentLower.indexOf(tok, idx)) !== -1) {
            hitCount++
            idx += tok.length
          }
        }

        const exactBonus = contentLower.includes(queryLower) ? 2 : 0
        const density = hitCount / contentLen
        const score = exactBonus + density * 1000

        return {
          id: r.id,
          score,
          content: r.content,
          metadata: r.metadata,
          type: r.type as MemoryType
        } as SearchResult
      })
      .sort((a, b) => b.score - a.score)
  }

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
          type: type
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  private async hybridSearch(request: RetrieveRequest): Promise<SearchResult[]> {
    const [keywordResults, vectorResults] = await Promise.all([
      this.keywordSearch(request),
      this.vectorSearch(request)
    ])
    const fused = reciprocalRankFusion(keywordResults, vectorResults)
    const limit = request.limit ?? 20
    return fused.slice(0, limit) as SearchResult[]
  }

  /**
   * Agentic 检索：多查询扩展 -> 每条做 hybrid -> RRF 融合。
   * 仅在需要处理复杂/多意图查询时使用（会多轮 LLM 调用）。
   */
  private async agenticSearch(request: RetrieveRequest): Promise<SearchResult[]> {
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

  private async applyRerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    const rerank = this.llmProvider.rerank
    if (!rerank || results.length === 0) return results
    const contents = results.map((r) => r.content || '')
    const scores = await rerank(query, contents)
    if (scores.length !== results.length) return results
    const indexed = results.map((r, i) => ({ ...r, score: scores[i] ?? 0 }))
    indexed.sort((a, b) => b.score - a.score)
    return indexed
  }
}
