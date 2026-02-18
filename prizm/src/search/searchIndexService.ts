/**
 * 按 scope 维护 MiniSearch 索引：创建/更新时写入索引，检索时直接查索引
 * Phase 1: MiniSearch (jieba 分词) 快速搜索
 * Phase 2: ripgrep 文件扫描（complete 模式），保证不漏
 * 持久化优先使用现有 SQLite（@prizm/evermemos），无则回退 JSON 文件
 */

import fs from 'fs'
import path from 'path'
import MiniSearch from 'minisearch'
import matter from 'gray-matter'
import type { PrizmAdapters } from '../adapters/interfaces'
import { scopeStore } from '../core/ScopeStore'
import { getSearchIndexPath } from '../core/PathProvider'
import { createLogger } from '../logger'
import { parseKeywords, cjkTokenize } from './keywordSearch'
import { ripgrepSearch } from './ripgrepSearch'

const log = createLogger('SearchIndex')

/**
 * 索引版本号 - 当分词器或索引格式变更时递增，
 * 加载到旧版本的索引会自动丢弃并从 adapters 重建
 */
const INDEX_VERSION = 4

/** 搜索索引持久化接口，可由 SQLite 等实现（复用现有依赖） */
export interface ISearchIndexStore {
  getSearchIndex(scope: string): Promise<{ miniSearchBlob: string; byIdBlob: string } | null>
  setSearchIndex(scope: string, miniSearchBlob: string, byIdBlob: string): Promise<void>
  deleteSearchIndex(scope: string): Promise<void>
}

function getIndexFilePath(scope: string): string {
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  return getSearchIndexPath(scopeRoot)
}

export type SearchResultKind = 'document' | 'clipboard' | 'todoList'

interface IndexEntry {
  kind: SearchResultKind
  raw: unknown
  tags: string[]
}

interface ScopeIndex {
  miniSearch: MiniSearch
  byId: Map<string, IndexEntry>
}

export interface SearchIndexOptions {
  types?: SearchResultKind[]
  limit?: number
  mode?: 'any' | 'all'
  fuzzy?: number
  /**
   * 完全搜索模式：MiniSearch 结果之外，用 ripgrep 扫描文件确保不漏
   * - false/undefined: 仅 MiniSearch（快速，适合 UI 实时搜索）
   * - true: MiniSearch + ripgrep 文件扫描，合并去重（保证召回，适合 Agent / 精确查找）
   */
  complete?: boolean
  /** 按 tag 过滤（OR 逻辑：含任一指定 tag 即匹配） */
  tags?: string[]
  /** 按创建时间过滤（时间戳，>=） */
  dateFrom?: number
  /** 按创建时间过滤（时间戳，<=） */
  dateTo?: number
}

export interface SearchIndexResultItem {
  kind: SearchResultKind
  id: string
  score: number
  matchedKeywords: string[]
  preview: string
  raw: unknown
  /** 结果来源：'index' 来自 MiniSearch 索引，'fulltext' 来自 ripgrep 文件扫描 */
  source?: 'index' | 'fulltext'
}

const DEFAULT_FUZZY = 0.2

const MINI_SEARCH_OPTIONS = {
  fields: ['title', 'text'],
  storeFields: [] as string[],
  tokenize: cjkTokenize,
  searchOptions: {
    fuzzy: DEFAULT_FUZZY,
    prefix: true,
    boost: { title: 2 },
    combineWith: 'OR' as const
  }
}

function toDocId(kind: SearchResultKind, id: string): string {
  return `${kind}:${id}`
}

function itemToDoc(
  kind: SearchResultKind,
  raw: { id?: string; title?: string; content?: string },
  text: string,
  title: string
): { id: string; title: string; text: string } {
  const id = typeof raw?.id === 'string' ? raw.id : ''
  return {
    id: toDocId(kind, id),
    title: title ?? '',
    text: text ?? ''
  }
}

interface PersistedByIdEntry {
  id: string
  kind: SearchResultKind
  raw: unknown
  tags: string[]
}

/** 从 raw 中提取 tags */
function extractTags(raw: unknown): string[] {
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.tags)) {
    return r.tags.filter((t): t is string => typeof t === 'string')
  }
  return []
}

/** 从 raw 数据提取预览文本 */
function makePreview(raw: unknown): string {
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title : ''
  const content = typeof r.content === 'string' ? r.content : ''
  if (title) return title.length > 80 ? title.slice(0, 80) + '…' : title
  if (content) return content.length > 80 ? content.slice(0, 80) + '…' : content
  return '(空)'
}

/** 检查条目是否通过 tags/date 过滤器 */
function passesFilters(entry: IndexEntry, options: SearchIndexOptions): boolean {
  if (options.tags?.length) {
    if (!entry.tags.some((t) => options.tags!.includes(t))) return false
  }
  const r = entry.raw as { createdAt?: number }
  const ts = r.createdAt ?? 0
  if (options.dateFrom && ts < options.dateFrom) return false
  if (options.dateTo && ts > options.dateTo) return false
  return true
}

/** 将 frontmatter 的 prizm_type 映射到 SearchResultKind */
function mapPrizmTypeToKind(prizmType: unknown): SearchResultKind | null {
  switch (prizmType) {
    case 'document':
      return 'document'
    case 'todo_list':
      return 'todoList'
    case 'clipboard_item':
      return 'clipboard'
    default:
      return null
  }
}

/** 从文件读取 frontmatter（用于 ripgrep 结果解析） */
function readFrontmatter(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const { data } = matter(content)
    if (data && typeof data === 'object') return data as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export class SearchIndexService {
  private scopes = new Map<string, ScopeIndex>()
  private adapters: PrizmAdapters | null = null
  private store: ISearchIndexStore | null = null
  /** 防止同一 scope 并发创建索引的 Promise 缓存 */
  private pendingEnsure = new Map<string, Promise<ScopeIndex>>()

  constructor(store?: ISearchIndexStore | null) {
    this.store = store ?? null
  }

  setAdapters(adapters: PrizmAdapters): void {
    this.adapters = adapters
  }

  private createEmptyIndex(): ScopeIndex {
    const miniSearch = new MiniSearch({
      ...MINI_SEARCH_OPTIONS
    })
    return { miniSearch, byId: new Map() }
  }

  private parseStored(miniSearchBlob: string, byIdBlob: string): ScopeIndex | null {
    try {
      const byIdData = JSON.parse(byIdBlob)
      if (Array.isArray(byIdData)) {
        log.info('search index is old format (no version), will rebuild')
        return null
      }
      if (byIdData.version !== INDEX_VERSION) {
        log.info('search index version mismatch', {
          stored: byIdData.version,
          expected: INDEX_VERSION
        })
        return null
      }
      const byIdArr = byIdData.entries as PersistedByIdEntry[]
      if (!Array.isArray(byIdArr)) return null
      const miniSearch = MiniSearch.loadJSON(miniSearchBlob, { ...MINI_SEARCH_OPTIONS })
      const byId = new Map<string, IndexEntry>()
      for (const e of byIdArr) {
        if (e && typeof e.id === 'string' && e.kind && e.raw !== undefined) {
          byId.set(e.id, {
            kind: e.kind,
            raw: e.raw,
            tags: Array.isArray(e.tags) ? e.tags : []
          })
        }
      }
      return { miniSearch, byId }
    } catch {
      return null
    }
  }

  private async loadFromDisk(scope: string): Promise<ScopeIndex | null> {
    if (this.store) {
      try {
        const r = await this.store.getSearchIndex(scope)
        if (r) {
          const idx = this.parseStored(r.miniSearchBlob, r.byIdBlob)
          if (idx) {
            log.info('search index loaded from store', { scope, entries: idx.byId.size })
            return idx
          }
        }
      } catch (err) {
        log.warn('search index load from store failed', scope, err)
      }
    }
    const filePath = getIndexFilePath(scope)
    try {
      if (!fs.existsSync(filePath)) return null
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as {
        version?: number
        miniSearch?: unknown
        byId?: PersistedByIdEntry[]
      }
      if (data.version !== INDEX_VERSION) {
        log.info('search index file version mismatch, will rebuild', {
          scope,
          stored: data.version,
          expected: INDEX_VERSION
        })
        return null
      }
      if (!data.miniSearch || !Array.isArray(data.byId)) return null
      const miniSearch = MiniSearch.loadJSON(JSON.stringify(data.miniSearch), {
        ...MINI_SEARCH_OPTIONS
      })
      const byId = new Map<string, IndexEntry>()
      for (const e of data.byId) {
        if (e && typeof e.id === 'string' && e.kind && e.raw !== undefined) {
          byId.set(e.id, {
            kind: e.kind,
            raw: e.raw,
            tags: Array.isArray(e.tags) ? e.tags : []
          })
        }
      }
      log.info('search index loaded from file', { scope, entries: byId.size })
      return { miniSearch, byId }
    } catch (err) {
      log.warn('search index load failed', scope, err)
      return null
    }
  }

  private async saveToDisk(scope: string, idx: ScopeIndex): Promise<void> {
    const miniSearchBlob = JSON.stringify(idx.miniSearch.toJSON())
    const byIdArr: PersistedByIdEntry[] = []
    idx.byId.forEach((entry, id) => {
      byIdArr.push({ id, kind: entry.kind, raw: entry.raw, tags: entry.tags })
    })
    const byIdBlob = JSON.stringify({ version: INDEX_VERSION, entries: byIdArr })
    if (this.store) {
      try {
        await this.store.setSearchIndex(scope, miniSearchBlob, byIdBlob)
        return
      } catch (err) {
        log.error('search index save to store failed', scope, err)
      }
    }
    const filePath = getIndexFilePath(scope)
    try {
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const payload = {
        version: INDEX_VERSION,
        miniSearch: JSON.parse(miniSearchBlob),
        byId: byIdArr
      }
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8')
    } catch (err) {
      log.error('search index save failed', scope, err)
    }
  }

  private async ensureIndex(scope: string): Promise<ScopeIndex> {
    const cached = this.scopes.get(scope)
    if (cached) return cached

    // 使用 Promise 缓存防止并发创建同一 scope 的索引
    const pending = this.pendingEnsure.get(scope)
    if (pending) return pending

    const promise = this.buildIndex(scope)
    this.pendingEnsure.set(scope, promise)
    try {
      return await promise
    } finally {
      this.pendingEnsure.delete(scope)
    }
  }

  private async buildIndex(scope: string): Promise<ScopeIndex> {
    let idx: ScopeIndex | undefined | null = await this.loadFromDisk(scope)
    if (idx != null) {
      this.scopes.set(scope, idx)
      return idx
    }

    const adapters = this.adapters
    if (!adapters) {
      idx = this.createEmptyIndex()
      this.scopes.set(scope, idx)
      return idx
    }

    idx = this.createEmptyIndex()
    const docs: { id: string; title: string; text: string }[] = []
    const entries: [string, IndexEntry][] = []

    if (adapters.documents?.getAllDocuments) {
      const list = await adapters.documents.getAllDocuments(scope)
      for (const d of list) {
        const title = d.title ?? ''
        const text = `${title}\n${d.content ?? ''}`
        const doc = itemToDoc('document', d, text, title)
        docs.push(doc)
        entries.push([doc.id, { kind: 'document', raw: d, tags: extractTags(d) }])
      }
    }
    if (adapters.clipboard?.getHistory) {
      const clips = await adapters.clipboard.getHistory(scope, { limit: 200 })
      for (const c of clips) {
        const content = c.content ?? ''
        const title = content.slice(0, 80)
        const doc = itemToDoc('clipboard', c as { id?: string }, content, title)
        docs.push(doc)
        entries.push([doc.id, { kind: 'clipboard', raw: c, tags: [] }])
      }
    }
    if (adapters.todoList?.getTodoLists) {
      const todoLists = await adapters.todoList.getTodoLists(scope)
      for (const todo of todoLists) {
        const title = todo.title ?? ''
        const parts: string[] = [title]
        for (const it of todo.items) {
          parts.push(it.title ?? '')
          if (it.description) parts.push(it.description)
        }
        const text = parts.join('\n')
        const doc = itemToDoc('todoList', todo, text, title)
        docs.push(doc)
        entries.push([doc.id, { kind: 'todoList', raw: todo, tags: [] }])
      }
    }

    idx.miniSearch.addAll(docs)
    for (const [id, entry] of entries) idx.byId.set(id, entry)
    this.scopes.set(scope, idx)
    await this.saveToDisk(scope, idx)
    return idx
  }

  private getIndex(scope: string): ScopeIndex | undefined {
    return this.scopes.get(scope)
  }

  /** 文档创建后调用，写入索引；若该 scope 尚无索引则先建索引 */
  async addDocument(
    scope: string,
    raw: { id: string; title?: string; content?: string; tags?: string[] }
  ): Promise<void> {
    const idx = await this.ensureIndex(scope)
    const docId = toDocId('document', raw.id)
    if (idx.byId.has(docId)) return
    const title = raw.title ?? ''
    const text = `${title}\n${raw.content ?? ''}`
    idx.miniSearch.add(itemToDoc('document', raw, text, title))
    idx.byId.set(docId, { kind: 'document', raw, tags: extractTags(raw) })
    await this.saveToDisk(scope, idx)
  }

  /** 文档更新后调用，更新索引 */
  async updateDocument(
    scope: string,
    id: string,
    raw: { id: string; title?: string; content?: string; tags?: string[] }
  ): Promise<void> {
    const idx = this.getIndex(scope)
    if (!idx) return
    const docId = toDocId('document', id)
    const title = raw.title ?? ''
    const text = `${title}\n${raw.content ?? ''}`
    const doc = itemToDoc('document', raw, text, title)
    idx.miniSearch.replace(doc)
    idx.byId.set(docId, { kind: 'document', raw, tags: extractTags(raw) })
    await this.saveToDisk(scope, idx)
  }

  /** 文档删除后调用，从索引移除 */
  async removeDocument(scope: string, id: string): Promise<void> {
    const idx = this.getIndex(scope)
    if (!idx) return
    const docId = toDocId('document', id)
    idx.miniSearch.discard(docId)
    idx.byId.delete(docId)
    await this.saveToDisk(scope, idx)
  }

  /** 检索：若该 scope 尚无索引则先从 adapters 懒加载建索引 */
  async search(
    scope: string,
    keywords: string | string[],
    options: SearchIndexOptions = {}
  ): Promise<SearchIndexResultItem[]> {
    const terms = parseKeywords(keywords)
    if (terms.length === 0) return []

    const types = options.types?.length
      ? options.types.filter((t) => ['document', 'clipboard', 'todoList'].includes(t))
      : (['document', 'clipboard', 'todoList'] as SearchResultKind[])
    const limit = typeof options.limit === 'number' ? Math.min(options.limit, 100) : 50
    const mode = options.mode === 'all' ? 'all' : 'any'
    const fuzzy =
      typeof options.fuzzy === 'number' ? Math.max(0, Math.min(1, options.fuzzy)) : DEFAULT_FUZZY

    const idx = await this.ensureIndex(scope)

    // ---- Phase 1: MiniSearch 索引搜索（快速，有评分） ----
    const query = terms.join(' ')
    const rawResults = idx.miniSearch.search(query, {
      fuzzy: fuzzy > 0 ? fuzzy : undefined,
      combineWith: mode === 'all' ? 'AND' : 'OR',
      boost: { title: 2 }
    })

    const matchedIds = new Set<string>()
    const results: SearchIndexResultItem[] = []
    for (const r of rawResults) {
      const entry = idx.byId.get(String(r.id))
      if (!entry) continue
      if (!types.includes(entry.kind)) continue
      if (!passesFilters(entry, options)) continue
      matchedIds.add(String(r.id))
      const raw = entry.raw as { id?: string }
      const id = raw?.id ?? ''
      const matchedKeywords = Array.isArray((r as { queryTerms?: string[] }).queryTerms)
        ? (r as { queryTerms: string[] }).queryTerms
        : terms
      results.push({
        kind: entry.kind,
        id,
        score: r.score ?? 0,
        matchedKeywords,
        preview: makePreview(entry.raw),
        raw: entry.raw,
        source: 'index'
      })
    }

    // ---- Phase 2: ripgrep 文件扫描（complete 模式，保证召回） ----
    if (options.complete) {
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const rgResults = await ripgrepSearch(query, scopeRoot, {
          glob: '*.md',
          maxMatchesPerFile: 3,
          maxFiles: 100
        })

        for (const fileMatch of rgResults) {
          const fm = readFrontmatter(fileMatch.filePath)
          if (!fm) continue
          const kind = mapPrizmTypeToKind(fm.prizm_type)
          if (!kind || !types.includes(kind)) continue
          const fmId = typeof fm.id === 'string' ? fm.id : ''
          if (!fmId) continue
          const docId = toDocId(kind, fmId)
          if (matchedIds.has(docId)) continue

          const fmTags = Array.isArray(fm.tags)
            ? (fm.tags as string[]).filter((t): t is string => typeof t === 'string')
            : []
          const pseudoEntry: IndexEntry = { kind, raw: fm, tags: fmTags }
          if (!passesFilters(pseudoEntry, options)) continue

          matchedIds.add(docId)
          const title = typeof fm.title === 'string' ? fm.title : ''
          const preview = title || fileMatch.matches[0]?.lineText?.slice(0, 80) || '(空)'
          results.push({
            kind,
            id: fmId,
            score: fileMatch.matches.length * 0.5,
            matchedKeywords: terms,
            preview,
            raw: fm,
            source: 'fulltext'
          })
        }
      } catch (err) {
        log.warn('ripgrep search failed, skipping complete mode', err)
      }
      results.sort((a, b) => b.score - a.score)
    }

    return results.slice(0, limit)
  }

  /** 使某 scope 的索引失效并删除缓存，下次检索时从 adapters 重新建索引 */
  async invalidateScope(scope: string): Promise<void> {
    this.scopes.delete(scope)
    if (this.store) {
      try {
        await this.store.deleteSearchIndex(scope)
        log.info('search index cache removed', { scope })
      } catch (err) {
        log.warn('search index cache remove failed', scope, err)
      }
      return
    }
    const filePath = getIndexFilePath(scope)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        log.info('search index cache removed', { scope })
      }
    } catch (err) {
      log.warn('search index cache remove failed', scope, err)
    }
  }
}
