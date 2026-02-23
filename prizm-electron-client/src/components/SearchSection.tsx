import { Input, Tag } from '@lobehub/ui'
import { AccentList } from './ui/AccentList'
import type { InputRef } from 'antd'
import type { SearchResult } from '@prizm/client-core'
import { useRef, useState, useEffect, useMemo } from 'react'
import { FileText, ListTodo, Clipboard as ClipboardIcon, Loader2, Search } from 'lucide-react'
import { getSearchResultKindLabel, getSearchMatchSourceLabel } from '../constants/todo'
import { useLogsContext } from '../context/LogsContext'
import { usePrizmContext } from '../context/PrizmContext'
import { useDebounce } from '../hooks/useDebounce'

const KIND_ICONS = {
  document: FileText,
  file: FileText,
  todoList: ListTodo,
  clipboard: ClipboardIcon
} as const

interface SearchSectionProps {
  activeTab: string
  scope?: string
  onActiveTabChange: (value: string) => void
  onRefreshFiles: () => void
  onRefreshTasks: () => void
  onRefreshClipboard: () => void
  onSelectFile?: (payload: { kind: 'todoList' | 'document'; id: string }) => void
}

export default function SearchSection({
  activeTab,
  scope = 'default',
  onActiveTabChange,
  onRefreshFiles,
  onRefreshTasks,
  onRefreshClipboard,
  onSelectFile
}: SearchSectionProps) {
  const { manager } = usePrizmContext()
  const { addLog } = useLogsContext()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const sectionRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<InputRef>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  const debouncedQuery = useDebounce(query, 200)

  async function performSearch(): Promise<SearchResult[]> {
    const http = manager?.getHttpClient()
    if (!http || !query.trim()) return []

    setLoading(true)
    try {
      const r = await http.search({
        keywords: query.trim(),
        scope,
        limit: 50,
        mode: 'any',
        complete: true
      } as Parameters<typeof http.search>[0])
      return r
    } catch (e) {
      addLog(`搜索失败: ${String(e)}`, 'error')
      return []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setShowResults(false)
      setResults([])
      setLoading(false)
      return
    }
    performSearch().then((r) => {
      setResults(r)
      setShowResults(true)
      setFocusedIndex(0)
    })
  }, [debouncedQuery, scope])

  async function onFocus() {
    if (query.trim()) {
      const r = await performSearch()
      setResults(r)
      setShowResults(true)
      setFocusedIndex(0)
    }
  }

  function focusNext() {
    if (results.length) {
      const next = (focusedIndex + 1) % results.length
      setFocusedIndex(next)
      itemRefs.current[next]?.scrollIntoView({ block: 'nearest' })
    }
  }

  function focusPrev() {
    if (results.length) {
      const prev = (focusedIndex - 1 + results.length) % results.length
      setFocusedIndex(prev)
      itemRefs.current[prev]?.scrollIntoView({ block: 'nearest' })
    }
  }

  function handleClick(r: SearchResult) {
    setQuery('')
    setShowResults(false)
    setResults([])

    if (r.kind === 'todoList') {
      onActiveTabChange('files')
      onRefreshTasks()
      onSelectFile?.({ kind: 'todoList', id: r.id })
    } else if (r.kind === 'document' || r.kind === 'file') {
      onActiveTabChange('files')
      onRefreshFiles()
      onSelectFile?.({ kind: 'document', id: r.id })
    } else if (r.kind === 'clipboard' && r.raw && typeof r.raw === 'object' && 'content' in r.raw) {
      const content = (r.raw as { content?: string }).content
      if (content != null) void window.prizm.writeClipboard(content)
      addLog('已复制到剪贴板', 'success')
      onActiveTabChange('clipboard')
      onRefreshClipboard()
    }
  }

  async function onEnter(e: React.KeyboardEvent) {
    if (!query.trim()) return
    if (results.length > 0 && showResults) {
      const r = results[focusedIndex]
      if (r) {
        e.preventDefault()
        handleClick(r)
      }
      return
    }
    const http = manager?.getHttpClient()
    if (!http) return
    e.preventDefault()
    const content = query.trim()
    setQuery('')
    setShowResults(false)
    setResults([])
    try {
      const doc = await http.createDocument(
        { title: content.slice(0, 50) || '未命名', content },
        scope
      )
      addLog('已创建文档', 'success')
      onActiveTabChange('files')
      onRefreshFiles()
      onSelectFile?.({ kind: 'document', id: doc.id })
    } catch (err) {
      addLog(`创建文档失败: ${String(err)}`, 'error')
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (sectionRef.current && !sectionRef.current.contains(e.target as Node)) {
      setShowResults(false)
    }
  }

  useEffect(() => {
    document.addEventListener('click', handleClickOutside)
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handler)
    }
  }, [])

  const { indexResults, fulltextResults } = useMemo(() => {
    const index: SearchResult[] = []
    const fulltext: SearchResult[] = []
    for (const r of results) {
      const src = (r as SearchResult & { source?: 'index' | 'fulltext' }).source
      if (src === 'fulltext') fulltext.push(r)
      else index.push(r)
    }
    return { indexResults: index, fulltextResults: fulltext }
  }, [results])

  const buildListItems = (
    group: SearchResult[],
    startIndex: number
  ): Array<{
    key: string
    title: React.ReactNode
    addon: React.ReactNode
    onClick: () => void
    onMouseEnter: () => void
  }> =>
    group.map((r, i) => {
      const globalIndex = startIndex + i
      const Icon = KIND_ICONS[r.kind] ?? FileText
      return {
        key: `${r.id}-${r.kind}`,
        title: (
          <span className="search-result-row">
            <Icon className="search-result-row__icon" size={16} aria-hidden />
            <span className="search-result-row__text">{r.preview || '(空)'}</span>
          </span>
        ),
        addon: <Tag title="信息源">{getSearchResultKindLabel(r.kind)}</Tag>,
        onClick: () => handleClick(r),
        onMouseEnter: () => setFocusedIndex(globalIndex)
      }
    })

  const listItemsIndex = useMemo(() => buildListItems(indexResults, 0), [indexResults])
  const listItemsFulltext = useMemo(
    () => buildListItems(fulltextResults, indexResults.length),
    [fulltextResults, indexResults.length]
  )

  const activeKey =
    results[focusedIndex] != null
      ? `${results[focusedIndex].id}-${results[focusedIndex].kind}`
      : undefined

  return (
    <div className="search-section" ref={sectionRef}>
      <div className="search-input-wrap">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文档、任务、剪贴板... (Ctrl+K)"
          aria-label="全局搜索"
          aria-expanded={showResults}
          aria-controls="search-results"
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter(e as unknown as React.KeyboardEvent)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              focusNext()
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              focusPrev()
            }
          }}
          style={{ width: '100%' }}
        />
      </div>
      {showResults && (
        <div id="search-results" className="search-results" role="listbox" aria-label="搜索结果">
          {loading ? (
            <div className="search-results-loading">
              <Loader2 size={20} className="search-results-loading__icon" aria-hidden />
              <span>正在搜索…</span>
            </div>
          ) : results.length === 0 && query.trim() ? (
            <div className="search-result-empty">无匹配结果</div>
          ) : !loading && query.trim() ? (
            <>
              <div className="search-results-header">
                <Search size={14} aria-hidden />
                <span>共 {results.length} 条</span>
              </div>
              <div className="search-result-group">
                <div className="search-result-group__title" title="算法/索引匹配结果">
                  {getSearchMatchSourceLabel('index')}
                  <span className="search-result-group__count">{indexResults.length}</span>
                </div>
                {indexResults.length > 0 ? (
                  <AccentList activeKey={activeKey} items={listItemsIndex} />
                ) : (
                  <div className="search-result-group-empty">索引中无额外匹配</div>
                )}
              </div>
              <div className="search-result-group">
                <div className="search-result-group__title" title="全文扫描匹配结果">
                  {getSearchMatchSourceLabel('fulltext')}
                  <span className="search-result-group__count">{fulltextResults.length}</span>
                </div>
                {fulltextResults.length > 0 ? (
                  <AccentList activeKey={activeKey} items={listItemsFulltext} />
                ) : (
                  <div className="search-result-group-empty">全文扫描未发现额外结果</div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
