/**
 * useDocumentMemories - 文档记忆 hook
 * 使用专用 API 获取文档记忆（按 source_document_id 索引查询），按 sub_type 分组
 * 支持提取状态跟踪和手动触发提取
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import type { MemoryItem } from '@prizm/client-core'

export interface GroupedMemories {
  overview: MemoryItem[]
  fact: MemoryItem[]
  migration: MemoryItem[]
  other: MemoryItem[]
}

interface UseDocumentMemoriesReturn {
  memories: GroupedMemories
  allMemories: MemoryItem[]
  loading: boolean
  extracting: boolean
  error: string | null
  fetchMemories: (documentId: string, scope?: string) => Promise<void>
  refresh: () => Promise<void>
  triggerExtract: () => Promise<boolean>
}

export const EMPTY_GROUPED: GroupedMemories = {
  overview: [],
  fact: [],
  migration: [],
  other: []
}

export function groupMemories(items: MemoryItem[]): GroupedMemories {
  const result: GroupedMemories = {
    overview: [],
    fact: [],
    migration: [],
    other: []
  }
  for (const item of items) {
    const subType = item.sub_type ?? ''
    if (subType === 'overview') {
      result.overview.push(item)
    } else if (subType === 'fact') {
      result.fact.push(item)
    } else if (subType === 'migration') {
      result.migration.push(item)
    } else {
      result.other.push(item)
    }
  }
  return result
}

export function useDocumentMemories(): UseDocumentMemoriesReturn {
  const { manager } = usePrizmContext()
  const [memories, setMemories] = useState<GroupedMemories>(EMPTY_GROUPED)
  const [allMemories, setAllMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDocId, setLastDocId] = useState<string | null>(null)
  const [lastScope, setLastScope] = useState<string | undefined>(undefined)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDocIdRef = useRef<string | null>(null)
  const lastScopeRef = useRef<string | undefined>(undefined)

  const fetchMemories = useCallback(
    async (documentId: string, scope?: string) => {
      if (!manager) return
      setLastDocId(documentId)
      setLastScope(scope)
      lastDocIdRef.current = documentId
      lastScopeRef.current = scope
      setLoading(true)
      setError(null)
      try {
        const client = manager.getHttpClient()
        const result = await client.getDocumentMemories(documentId, scope)
        const docMemories = result.memories ?? []
        setAllMemories(docMemories)
        setMemories(groupMemories(docMemories))
        setExtracting(result.extracting === true)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [manager]
  )

  const refresh = useCallback(async () => {
    if (lastDocId) {
      await fetchMemories(lastDocId, lastScope)
    }
  }, [lastDocId, lastScope, fetchMemories])

  const triggerExtract = useCallback(async (): Promise<boolean> => {
    if (!manager || !lastDocId) return false
    try {
      const client = manager.getHttpClient()
      const result = await client.extractDocumentMemory(lastDocId, lastScope)
      if (result.triggered) {
        setExtracting(true)
        // 轮询等待提取完成，然后自动刷新
        const poll = () => {
          pollTimerRef.current = setTimeout(async () => {
            try {
              const r = await client.getDocumentMemories(lastDocId, lastScope)
              if (r.extracting) {
                poll()
              } else {
                setExtracting(false)
                const docMemories = r.memories ?? []
                setAllMemories(docMemories)
                setMemories(groupMemories(docMemories))
              }
            } catch {
              setExtracting(false)
            }
          }, 3000)
        }
        poll()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [manager, lastDocId, lastScope])

  // WS 订阅：document:updated 时延迟刷新记忆（提取通常需要数秒）
  const memoryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsub = subscribeSyncEvents((eventType, payload) => {
      if (eventType !== 'document:updated') return
      const docId = lastDocIdRef.current
      if (!docId || !payload?.id || payload.id !== docId) return
      if (memoryRefreshTimerRef.current) clearTimeout(memoryRefreshTimerRef.current)
      memoryRefreshTimerRef.current = setTimeout(() => {
        memoryRefreshTimerRef.current = null
        if (!manager) return
        const client = manager.getHttpClient()
        void client
          .getDocumentMemories(docId, lastScopeRef.current)
          .then((result) => {
            const docMemories = result.memories ?? []
            setAllMemories(docMemories)
            setMemories(groupMemories(docMemories))
            setExtracting(result.extracting === true)
          })
          .catch(() => {})
      }, 5000)
    })
    return () => {
      unsub()
      if (memoryRefreshTimerRef.current) clearTimeout(memoryRefreshTimerRef.current)
    }
  }, [manager])

  return {
    memories,
    allMemories,
    loading,
    extracting,
    error,
    fetchMemories,
    refresh,
    triggerExtract
  }
}
