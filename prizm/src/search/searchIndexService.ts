/**
 * 按 scope 维护 MiniSearch 索引：创建/更新时写入索引，检索时直接查索引
 * 持久化优先使用现有 SQLite（@prizm/evermemos），无则回退 JSON 文件
 */

import fs from 'fs'
import path from 'path'
import MiniSearch from 'minisearch'
import type { PrizmAdapters } from '../adapters/interfaces'
import { getConfig } from '../config'
import { createLogger } from '../logger'
import { parseKeywords } from './keywordSearch'

const log = createLogger('SearchIndex')
const SCOPES_DIR = 'scopes'
const SEARCH_INDEX_FILENAME = 'search-index.json'

/** 搜索索引持久化接口，可由 SQLite 等实现（复用现有依赖） */
export interface ISearchIndexStore {
  getSearchIndex(scope: string): Promise<{ miniSearchBlob: string; byIdBlob: string } | null>
  setSearchIndex(scope: string, miniSearchBlob: string, byIdBlob: string): Promise<void>
  deleteSearchIndex(scope: string): Promise<void>
}

function safeScopeDirname(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
}

function getIndexFilePath(scope: string): string {
  const dataDir = getConfig().dataDir
  return path.join(dataDir, SCOPES_DIR, safeScopeDirname(scope), SEARCH_INDEX_FILENAME)
}

export type SearchResultKind = 'note' | 'document' | 'clipboard' | 'todoList'

interface IndexEntry {
  kind: SearchResultKind
  raw: unknown
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
}

export interface SearchIndexResultItem {
  kind: SearchResultKind
  id: string
  score: number
  matchedKeywords: string[]
  preview: string
  raw: unknown
}

const DEFAULT_FUZZY = 0.2

const MINI_SEARCH_OPTIONS = {
  fields: ['title', 'text'],
  storeFields: [] as string[],
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
}

export class SearchIndexService {
  private scopes = new Map<string, ScopeIndex>()
  private adapters: PrizmAdapters | null = null
  private store: ISearchIndexStore | null = null

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
      const byIdArr = JSON.parse(byIdBlob) as PersistedByIdEntry[]
      if (!Array.isArray(byIdArr)) return null
      const miniSearch = MiniSearch.loadJSON(miniSearchBlob, { ...MINI_SEARCH_OPTIONS })
      const byId = new Map<string, IndexEntry>()
      for (const e of byIdArr) {
        if (e && typeof e.id === 'string' && e.kind && e.raw !== undefined) {
          byId.set(e.id, { kind: e.kind, raw: e.raw })
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
        miniSearch?: unknown
        byId?: PersistedByIdEntry[]
      }
      if (!data.miniSearch || !Array.isArray(data.byId)) return null
      const miniSearch = MiniSearch.loadJSON(JSON.stringify(data.miniSearch), {
        ...MINI_SEARCH_OPTIONS
      })
      const byId = new Map<string, IndexEntry>()
      for (const e of data.byId) {
        if (e && typeof e.id === 'string' && e.kind && e.raw !== undefined) {
          byId.set(e.id, { kind: e.kind, raw: e.raw })
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
      byIdArr.push({ id, kind: entry.kind, raw: entry.raw })
    })
    const byIdBlob = JSON.stringify(byIdArr)
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
      const payload = { miniSearch: JSON.parse(miniSearchBlob), byId: JSON.parse(byIdBlob) }
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8')
    } catch (err) {
      log.error('search index save failed', scope, err)
    }
  }

  private async ensureIndex(scope: string): Promise<ScopeIndex> {
    let idx: ScopeIndex | undefined | null = this.scopes.get(scope)
    if (idx) return idx

    idx = await this.loadFromDisk(scope)
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

    if (adapters.notes?.getAllNotes) {
      const notes = await adapters.notes.getAllNotes(scope)
      for (const n of notes) {
        const content = n.content ?? ''
        const title = content.slice(0, 80)
        const doc = itemToDoc('note', n, content, title)
        docs.push(doc)
        entries.push([doc.id, { kind: 'note', raw: n }])
      }
    }
    if (adapters.documents?.getAllDocuments) {
      const list = await adapters.documents.getAllDocuments(scope)
      for (const d of list) {
        const title = d.title ?? ''
        const text = `${title}\n${d.content ?? ''}`
        const doc = itemToDoc('document', d, text, title)
        docs.push(doc)
        entries.push([doc.id, { kind: 'document', raw: d }])
      }
    }
    if (adapters.clipboard?.getHistory) {
      const clips = await adapters.clipboard.getHistory(scope, { limit: 200 })
      for (const c of clips) {
        const content = c.content ?? ''
        const doc = itemToDoc('clipboard', c as { id?: string }, content, content.slice(0, 80))
        docs.push(doc)
        entries.push([doc.id, { kind: 'clipboard', raw: c }])
      }
    }
    if (adapters.todoList?.getTodoLists) {
      const todoLists = await adapters.todoList.getTodoLists(scope)
      for (const todo of todoLists) {
        const parts: string[] = [todo.title ?? '']
        for (const it of todo.items) {
          parts.push(it.title ?? '')
          if (it.description) parts.push(it.description)
        }
        const text = parts.join('\n')
        const doc = itemToDoc('todoList', todo, text, todo.title ?? '')
        docs.push(doc)
        entries.push([doc.id, { kind: 'todoList', raw: todo }])
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

  /** 文档创建后调用，写入索引；若该 scope 尚无索引则先建索引（从 adapters 加载，会包含新文档） */
  async addDocument(
    scope: string,
    raw: { id: string; title?: string; content?: string }
  ): Promise<void> {
    let idx = this.getIndex(scope)
    if (!idx) {
      await this.ensureIndex(scope)
      return
    }
    const title = raw.title ?? ''
    const text = `${title}\n${raw.content ?? ''}`
    const docId = toDocId('document', raw.id)
    idx.miniSearch.add(itemToDoc('document', raw, text, title))
    idx.byId.set(docId, { kind: 'document', raw })
    await this.saveToDisk(scope, idx)
  }

  /** 文档更新后调用，更新索引 */
  async updateDocument(
    scope: string,
    id: string,
    raw: { id: string; title?: string; content?: string }
  ): Promise<void> {
    const idx = this.getIndex(scope)
    if (!idx) return
    const docId = toDocId('document', id)
    const title = raw.title ?? ''
    const text = `${title}\n${raw.content ?? ''}`
    const doc = itemToDoc('document', raw, text, title)
    idx.miniSearch.replace(doc)
    idx.byId.set(docId, { kind: 'document', raw })
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
      ? options.types.filter((t) => ['note', 'document', 'clipboard', 'todoList'].includes(t))
      : (['note', 'document', 'clipboard', 'todoList'] as SearchResultKind[])
    const limit = typeof options.limit === 'number' ? Math.min(options.limit, 100) : 50
    const mode = options.mode === 'all' ? 'all' : 'any'
    const fuzzy =
      typeof options.fuzzy === 'number' ? Math.max(0, Math.min(1, options.fuzzy)) : DEFAULT_FUZZY

    const idx = await this.ensureIndex(scope)
    const query = terms.join(' ')
    const rawResults = idx.miniSearch.search(query, {
      fuzzy: fuzzy > 0 ? fuzzy : undefined,
      combineWith: mode === 'all' ? 'AND' : 'OR',
      boost: { title: 2 }
    })

    const results: SearchIndexResultItem[] = []
    for (const r of rawResults.slice(0, limit)) {
      const entry = idx.byId.get(String(r.id))
      if (!entry) continue
      if (!types.includes(entry.kind)) continue
      const raw = entry.raw as { id?: string; content?: string; title?: string }
      const id = raw?.id ?? ''
      let preview = ''
      if ('content' in raw && typeof raw.content === 'string') {
        preview = raw.content.length > 80 ? raw.content.slice(0, 80) + '…' : raw.content
      } else if ('title' in raw && typeof raw.title === 'string') {
        preview = raw.title
      }
      const matchedKeywords = Array.isArray((r as { queryTerms?: string[] }).queryTerms)
        ? (r as { queryTerms: string[] }).queryTerms
        : terms
      results.push({
        kind: entry.kind,
        id,
        score: r.score ?? 0,
        matchedKeywords,
        preview: preview || '(空)',
        raw: entry.raw
      })
    }
    return results
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
