/**
 * useFileTree - 获取主工作区和会话临时工作区的文件树
 * 监听 file:* WebSocket 事件做增量更新（insert/delete/move node）；
 * file:updated 仅单条刷新，无法增量时 fallback 到全量刷新。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
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

function getParentPath(relativePath: string): string {
  const sep = relativePath.includes('\\') ? '\\' : '/'
  const parts = relativePath.split(sep)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join(sep)
}

function getFileName(relativePath: string): string {
  const sep = relativePath.includes('\\') ? '\\' : '/'
  const parts = relativePath.split(sep)
  return parts[parts.length - 1] || relativePath
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
  return descendant.startsWith(ancestor + '/') || descendant.startsWith(ancestor + '\\')
}

function insertNode(tree: TreeNode[], parentPath: string, node: TreeNode): TreeNode[] {
  if (!parentPath) {
    if (tree.some((n) => n.id === node.id)) return tree
    return [...tree, node]
  }
  let changed = false
  const result = tree.map((n) => {
    if (n.id === parentPath && n.children) {
      if (n.children.some((c) => c.id === node.id)) return n
      changed = true
      return { ...n, children: [...n.children, node] }
    }
    if (n.children && isAncestorPath(n.id, parentPath)) {
      const newChildren = insertNode(n.children, parentPath, node)
      if (newChildren !== n.children) {
        changed = true
        return { ...n, children: newChildren }
      }
    }
    return n
  })
  return changed ? result : tree
}

function removeNode(tree: TreeNode[], targetPath: string): TreeNode[] {
  const filtered = tree.filter((n) => n.id !== targetPath)
  if (filtered.length !== tree.length) return filtered
  let changed = false
  const result = tree.map((n) => {
    if (!n.children) return n
    const newChildren = removeNode(n.children, targetPath)
    if (newChildren !== n.children) {
      changed = true
      return { ...n, children: newChildren }
    }
    return n
  })
  return changed ? result : tree
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

  useEffect(() => {
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    const unsub = subscribeSyncEvents((eventType: string, payload?: SyncEventPayload) => {
      if (!eventType.startsWith('file:')) return
      const p = payload ?? {}
      const relativePath = p.relativePath as string | undefined
      if (!relativePath) {
        scheduleFallback()
        return
      }

      if (eventType === 'file:created') {
        const isDir = (p.isDir as boolean) ?? false
        const node: TreeNode = {
          id: relativePath,
          name: getFileName(relativePath),
          isDir,
          children: isDir ? [] : undefined
        }
        setWorkspaceTree((prev) => insertNode(prev, getParentPath(relativePath), node))
      } else if (eventType === 'file:deleted') {
        setWorkspaceTree((prev) => removeNode(prev, relativePath))
      } else if (eventType === 'file:moved') {
        const oldPath = p.oldRelativePath as string | undefined
        if (oldPath) {
          const isDir = (p.isDir as boolean) ?? false
          setWorkspaceTree((prev) => {
            const after = removeNode(prev, oldPath)
            const node: TreeNode = {
              id: relativePath,
              name: getFileName(relativePath),
              isDir,
              children: isDir ? [] : undefined
            }
            return insertNode(after, getParentPath(relativePath), node)
          })
        } else {
          scheduleFallback()
        }
      } else {
        scheduleFallback()
      }
    })

    function scheduleFallback(): void {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null
        void refresh()
      }, 500)
    }

    return () => {
      unsub()
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [refresh])

  return { workspaceTree, sessionTree, loading, refresh }
}
