/**
 * useDocumentSearch - 文档搜索 hook
 * Debounce 搜索、搜索结果状态
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import type { Document } from '@prizm/client-core'

interface SearchResultItem {
  id: string
  kind: string
  title: string
  text?: string
  score: number
  /** 匹配方式：index=索引匹配，fulltext=全文匹配 */
  source?: 'index' | 'fulltext'
}

interface UseDocumentSearchReturn {
  results: SearchResultItem[]
  loading: boolean
  error: string | null
  search: (query: string) => void
  clearResults: () => void
}

export function useDocumentSearch(scope?: string): UseDocumentSearchReturn {
  const { manager } = usePrizmContext()
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)

      if (!query.trim()) {
        setResults([])
        setLoading(false)
        return
      }

      setLoading(true)

      timerRef.current = setTimeout(async () => {
        if (!manager) {
          setLoading(false)
          return
        }
        try {
          const client = manager.getHttpClient()
          const searchResults = await client.search({
            keywords: query,
            scope,
            types: ['document'],
            limit: 30
          })
          setResults(
            searchResults.map((r) => ({
              id: r.id,
              kind: r.kind,
              title: r.preview ?? r.id,
              text: r.preview,
              score: r.score,
              source: r.source
            }))
          )
          setError(null)
        } catch (e) {
          setError(String(e))
        } finally {
          setLoading(false)
        }
      }, 300)
    },
    [manager, scope]
  )

  const clearResults = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { results, loading, error, search, clearResults }
}
