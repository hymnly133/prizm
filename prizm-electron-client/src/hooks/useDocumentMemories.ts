/**
 * useDocumentMemories - 文档记忆 hook
 * 获取与特定文档关联的记忆，按 sub_type 分组
 */
import { useState, useCallback } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import type { MemoryItem } from '@prizm/client-core'

interface GroupedMemories {
  overview: MemoryItem[]
  fact: MemoryItem[]
  migration: MemoryItem[]
  other: MemoryItem[]
}

interface UseDocumentMemoriesReturn {
  memories: GroupedMemories
  allMemories: MemoryItem[]
  loading: boolean
  error: string | null
  fetchMemories: (documentId: string, scope?: string) => Promise<void>
  refresh: () => Promise<void>
}

const EMPTY_GROUPED: GroupedMemories = {
  overview: [],
  fact: [],
  migration: [],
  other: []
}

function groupMemories(items: MemoryItem[]): GroupedMemories {
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
  const [error, setError] = useState<string | null>(null)
  const [lastDocId, setLastDocId] = useState<string | null>(null)
  const [lastScope, setLastScope] = useState<string | undefined>(undefined)

  const fetchMemories = useCallback(
    async (documentId: string, scope?: string) => {
      if (!manager) return
      setLastDocId(documentId)
      setLastScope(scope)
      setLoading(true)
      setError(null)
      try {
        const client = manager.getHttpClient()
        // 获取所有记忆并按 metadata.documentId 过滤
        const result = await client.getMemories(scope)
        const docMemories = result.memories.filter(
          (m) =>
            m.memory_type === 'document' &&
            (m.metadata as Record<string, unknown>)?.documentId === documentId
        )
        setAllMemories(docMemories)
        setMemories(groupMemories(docMemories))
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

  return {
    memories,
    allMemories,
    loading,
    error,
    fetchMemories,
    refresh
  }
}
