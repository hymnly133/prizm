/**
 * useFileTree - 获取主工作区和会话临时工作区的文件树
 * 监听 file:* WebSocket 事件自动刷新
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import type { FileEntry } from '@prizm/client-core'

export interface TreeNode {
  id: string
  name: string
  children?: TreeNode[]
  isDir: boolean
  prizmType?: string
  prizmId?: string
  size?: number
  lastModified?: number
}

function toTreeData(entries: FileEntry[]): TreeNode[] {
  return entries.map((e) => ({
    id: e.relativePath,
    name: e.name,
    isDir: e.isDir,
    prizmType: e.prizmType ?? undefined,
    prizmId: e.prizmId ?? undefined,
    size: e.size,
    lastModified: e.lastModified,
    children: e.isDir ? (e.children ? toTreeData(e.children) : []) : undefined
  }))
}

export function useFileTree(scope: string, sessionId?: string) {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const [workspaceTree, setWorkspaceTree] = useState<TreeNode[]>([])
  const [sessionTree, setSessionTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const fetchWorkspace = useCallback(async () => {
    if (!http) return
    try {
      const files = await http.fileList({ recursive: true, scope })
      if (mountedRef.current) setWorkspaceTree(toTreeData(files))
    } catch {
      // silently ignore
    }
  }, [http, scope])

  const fetchSession = useCallback(async () => {
    if (!http || !sessionId) {
      setSessionTree([])
      return
    }
    try {
      const files = await http.fileList({ recursive: true, scope, sessionWorkspace: sessionId })
      if (mountedRef.current) setSessionTree(toTreeData(files))
    } catch {
      setSessionTree([])
    }
  }, [http, scope, sessionId])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchWorkspace(), fetchSession()])
    if (mountedRef.current) setLoading(false)
  }, [fetchWorkspace, fetchSession])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  // Listen for file:* events to auto-refresh (debounced)
  // document:* events don't affect file system structure, only file:* events do
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribeSyncEvents((eventType) => {
      if (eventType.startsWith('file:')) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void refresh()
        }, 500)
      }
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  return { workspaceTree, sessionTree, loading, refresh }
}
