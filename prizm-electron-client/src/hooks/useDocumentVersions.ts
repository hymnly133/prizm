/**
 * useDocumentVersions - 文档版本历史 hook
 * 版本列表获取、Diff 获取、版本恢复
 */
import { useState, useCallback } from 'react'
import { usePrizmContext } from '../context/PrizmContext'

interface VersionSummary {
  version: number
  timestamp: string
  title: string
  contentHash: string
}

interface UseDocumentVersionsReturn {
  versions: VersionSummary[]
  loading: boolean
  error: string | null
  fetchVersions: (documentId: string, scope?: string) => Promise<void>
  fetchDiff: (
    documentId: string,
    from: number,
    to: number,
    scope?: string
  ) => Promise<string | null>
  restoreVersion: (documentId: string, version: number, scope?: string) => Promise<boolean>
}

export function useDocumentVersions(): UseDocumentVersionsReturn {
  const { manager } = usePrizmContext()
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVersions = useCallback(
    async (documentId: string, scope?: string) => {
      if (!manager) return
      setLoading(true)
      setError(null)
      try {
        const client = manager.getHttpClient()
        const result = await client.getDocumentVersions(documentId, scope)
        setVersions(result.versions)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [manager]
  )

  const fetchDiff = useCallback(
    async (documentId: string, from: number, to: number, scope?: string) => {
      if (!manager) return null
      try {
        const client = manager.getHttpClient()
        const result = await client.getDocumentDiff(documentId, from, to, scope)
        return result.diff
      } catch (e) {
        setError(String(e))
        return null
      }
    },
    [manager]
  )

  const restoreVersion = useCallback(
    async (documentId: string, version: number, scope?: string) => {
      if (!manager) return false
      try {
        const client = manager.getHttpClient()
        await client.restoreDocumentVersion(documentId, version, scope)
        return true
      } catch (e) {
        setError(String(e))
        return false
      }
    },
    [manager]
  )

  return {
    versions,
    loading,
    error,
    fetchVersions,
    fetchDiff,
    restoreVersion
  }
}
