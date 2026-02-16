/**
 * useFileList - 工作区内的文件列表（便签 + 任务 + 文档）
 * 支持增量更新：根据 WebSocket 事件类型与 payload 做 add/update/remove，减少全量拉取
 */
import { useState, useCallback, useEffect, useRef, startTransition } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import type { TodoList, Document, TodoItem } from '@prizm/client-core'

const SYNC_INCREMENTAL_DEBOUNCE_MS = 100
const SYNC_FULL_REFRESH_DEBOUNCE_MS = 400

export type FileKind = 'note' | 'todoList' | 'document'

export interface FileItem {
  kind: FileKind
  id: string
  title: string
  updatedAt: number
  raw: TodoList | Document
}

function isFileSyncEvent(eventType: string): boolean {
  return (
    eventType.startsWith('todo_list:') ||
    eventType.startsWith('todo_item:') ||
    eventType.startsWith('document:')
  )
}

export function todoToFileItem(todoList: TodoList): FileItem {
  return {
    kind: 'todoList',
    id: todoList.id,
    title: todoList.title || '(待办)',
    updatedAt: todoList.updatedAt,
    raw: todoList
  }
}

export function docToFileItem(doc: Document): FileItem {
  return {
    kind: 'document',
    id: doc.id,
    title: doc.title || '(无标题文档)',
    updatedAt: doc.updatedAt,
    raw: doc
  }
}

function fileItemKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

function sortByUpdatedAt(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

type IncrementalEvent = { eventType: string; payload?: SyncEventPayload }

/**
 * 将 FileItem[] 转为以 kind:id 为 key 的 Map，方便 O(1) 查找
 */
function toFileMap(items: FileItem[]): Map<string, FileItem> {
  const map = new Map<string, FileItem>()
  for (const item of items) {
    map.set(fileItemKey(item.kind, item.id), item)
  }
  return map
}

/**
 * 纯函数：基于当前列表和一批事件，计算新列表以及需要异步 fetch 的 id 集合
 * 不触发任何 setState / 网络请求，便于测试和组合
 */
function computeIncrementalPatch(
  prev: FileItem[],
  events: IncrementalEvent[],
  scope: string
): {
  nextItems: FileItem[]
  docIdsToFetch: Set<string>
  needTodoListFetch: boolean
} {
  const map = toFileMap(prev)
  const docIdsToFetch = new Set<string>()
  let needTodoListFetch = false

  // 先分类，减少在循环里做复杂逻辑
  const deletions = new Set<string>()
  let removeAllTodoLists = false
  const todoListUpdates: Array<Record<string, unknown>> = []
  const todoItemUpdates: Array<{ eventType: string; payload: Record<string, unknown> }> = []

  for (const { eventType, payload } of events) {
    const eventScope = (payload as Record<string, unknown>)?.scope ?? scope
    if (eventScope !== scope) continue

    const p = payload as Record<string, unknown> | undefined
    const id = p?.id as string | undefined

    switch (eventType) {
      case 'document:deleted':
        if (id) {
          deletions.add(fileItemKey('document', id))
          docIdsToFetch.delete(id)
        }
        break
      case 'document:created':
      case 'document:updated':
        if (id) docIdsToFetch.add(id)
        break
      case 'todo_list:deleted': {
        const listId = p?.listId as string | undefined
        if (listId) deletions.add(fileItemKey('todoList', listId))
        else if (p?.deleted === true) removeAllTodoLists = true
        break
      }
      case 'todo_list:created':
        needTodoListFetch = true
        break
      case 'todo_list:updated':
        if (p) todoListUpdates.push(p)
        break
      case 'todo_item:created':
      case 'todo_item:updated':
      case 'todo_item:deleted':
        if (p) todoItemUpdates.push({ eventType, payload: p })
        break
    }
  }

  // 1. 删除
  for (const key of deletions) {
    map.delete(key)
  }
  if (removeAllTodoLists) {
    for (const [key] of map) {
      if (key.startsWith('todoList:')) map.delete(key)
    }
  }

  // 从已删除文档中移除 fetch 需求
  for (const key of deletions) {
    if (key.startsWith('document:')) {
      docIdsToFetch.delete(key.slice('document:'.length))
    }
  }

  // 2. 应用 todo_list:updated 事件
  for (const p of todoListUpdates) {
    const listId = p.listId as string | undefined
    if (!listId) {
      needTodoListFetch = true
      continue
    }
    const key = fileItemKey('todoList', listId)
    const existing = map.get(key)
    if (!existing) {
      needTodoListFetch = true
      continue
    }
    const list = existing.raw as TodoList
    if (p.itemsOmitted === true) {
      const updated: TodoList = {
        ...list,
        title: (p.title as string) ?? list.title,
        updatedAt: (p.updatedAt as number) ?? Date.now()
      }
      map.set(key, todoToFileItem(updated))
    } else if (Array.isArray(p.items)) {
      const updated: TodoList = {
        ...list,
        title: (p.title as string) ?? list.title,
        items: p.items as TodoItem[],
        updatedAt: (p.updatedAt as number) ?? Date.now()
      }
      map.set(key, todoToFileItem(updated))
    } else {
      needTodoListFetch = true
    }
  }

  // 3. 应用 todo_item:* 事件（修复：根据 listId 查找正确的 todoList）
  for (const { eventType, payload: p } of todoItemUpdates) {
    const listId = p.listId as string | undefined
    if (!listId) {
      needTodoListFetch = true
      continue
    }
    const key = fileItemKey('todoList', listId)
    const existing = map.get(key)
    if (!existing) {
      needTodoListFetch = true
      continue
    }
    const list = existing.raw as TodoList

    if (eventType === 'todo_item:created') {
      const item: TodoItem = {
        id: (p.itemId ?? p.id) as string,
        title: (p.title as string) ?? '',
        description: p.description as string | undefined,
        status: ((p.status as string) ?? 'todo') as TodoItem['status'],
        createdAt: (p.createdAt as number) ?? Date.now(),
        updatedAt: (p.updatedAt as number) ?? Date.now()
      }
      const updated: TodoList = {
        ...list,
        items: [...list.items, item],
        updatedAt: item.updatedAt ?? Date.now()
      }
      map.set(key, todoToFileItem(updated))
    } else if (eventType === 'todo_item:updated') {
      const itemId = (p.itemId ?? p.id) as string
      if (!itemId) continue
      const item: TodoItem = {
        id: itemId,
        title: (p.title as string) ?? '',
        description: p.description as string | undefined,
        status: ((p.status as string) ?? 'todo') as TodoItem['status'],
        createdAt: (p.createdAt as number) ?? Date.now(),
        updatedAt: (p.updatedAt as number) ?? Date.now()
      }
      const updated: TodoList = {
        ...list,
        items: list.items.map((it) => (it.id === itemId ? item : it)),
        updatedAt: item.updatedAt ?? Date.now()
      }
      map.set(key, todoToFileItem(updated))
    } else if (eventType === 'todo_item:deleted') {
      const itemId = p.itemId as string
      if (!itemId) continue
      const updated: TodoList = {
        ...list,
        items: list.items.filter((it) => it.id !== itemId),
        updatedAt: Date.now()
      }
      map.set(key, todoToFileItem(updated))
    }
  }

  return {
    nextItems: sortByUpdatedAt(Array.from(map.values())),
    docIdsToFetch,
    needTodoListFetch
  }
}

export function useFileList(scope: string) {
  const { manager } = usePrizmContext()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [fileListLoading, setFileListLoading] = useState(false)
  const fileListRef = useRef<FileItem[]>(fileList)
  fileListRef.current = fileList
  const pendingEventsRef = useRef<IncrementalEvent[]>([])

  /** 乐观添加：立即将项目插入列表头部（WebSocket 事件到达时会自动合并） */
  const optimisticAdd = useCallback((item: FileItem) => {
    setFileList((prev) => {
      const key = fileItemKey(item.kind, item.id)
      const exists = prev.some((p) => fileItemKey(p.kind, p.id) === key)
      if (exists) return prev
      return [item, ...prev]
    })
  }, [])

  /** 乐观删除：立即从列表移除项目 */
  const optimisticRemove = useCallback((kind: FileKind, id: string) => {
    setFileList((prev) => {
      const key = fileItemKey(kind, id)
      const filtered = prev.filter((p) => fileItemKey(p.kind, p.id) !== key)
      return filtered.length === prev.length ? prev : filtered
    })
  }, [])

  const refreshFileList = useCallback(
    async (s: string, options?: { silent?: boolean }) => {
      const http = manager?.getHttpClient()
      if (!http) return
      if (!options?.silent) setFileListLoading(true)
      try {
        const [todoLists, documents] = await Promise.all([
          http.getTodoLists(s),
          http.listDocuments({ scope: s })
        ])

        const items: FileItem[] = [
          ...todoLists.map(todoToFileItem),
          ...documents.map(docToFileItem)
        ]

        const sorted = sortByUpdatedAt(items)
        if (options?.silent) {
          // 后台刷新：低优先级，不阻塞动画
          startTransition(() => setFileList(sorted))
        } else {
          setFileList(sorted)
        }
      } catch {
        setFileList([])
      } finally {
        if (!options?.silent) setFileListLoading(false)
      }
    },
    [manager]
  )

  const applyIncrementalUpdate = useCallback(
    async (s: string, events: IncrementalEvent[]) => {
      const http = manager?.getHttpClient()
      if (!http) return

      // 先在主线程外计算 patch（不在 setState updater 内做复杂逻辑）
      // 读取当前 fileList 快照用 ref
      const prevSnapshot = fileListRef.current
      const patch = computeIncrementalPatch(prevSnapshot, events, s)

      // 阶段 1: 低优先级 setState — 不阻塞动画帧
      startTransition(() => {
        setFileList(patch.nextItems)
      })

      // 阶段 2: 异步 fetch 远程数据（仅在需要时）
      const fetches: Promise<FileItem | FileItem[] | null>[] = []

      for (const id of patch.docIdsToFetch) {
        fetches.push(
          http
            .getDocument(id, s)
            .then(docToFileItem)
            .catch(() => null)
        )
      }

      let todoListFetchIndex = -1
      if (patch.needTodoListFetch) {
        todoListFetchIndex = fetches.length
        fetches.push(http.getTodoLists(s).then((lists) => lists.map(todoToFileItem)))
      }

      if (fetches.length === 0) return

      const results = await Promise.all(fetches)

      // 阶段 3: 合并远程数据 — 低优先级 setState
      startTransition(() => {
        setFileList((prev) => {
          const map = toFileMap(prev)

          if (
            patch.needTodoListFetch &&
            todoListFetchIndex >= 0 &&
            Array.isArray(results[todoListFetchIndex]) &&
            (results[todoListFetchIndex] as FileItem[]).length === 0
          ) {
            for (const [key] of map) {
              if (key.startsWith('todoList:')) map.delete(key)
            }
          }

          for (const result of results) {
            if (result == null) continue
            const items = Array.isArray(result) ? result : [result]
            for (const item of items) {
              map.set(fileItemKey(item.kind, item.id), item)
            }
          }

          return sortByUpdatedAt(Array.from(map.values()))
        })
      })
    },
    [manager]
  )

  useEffect(() => {
    if (manager && scope) void refreshFileList(scope)
  }, [manager, scope, refreshFileList])

  useEffect(() => {
    if (!scope) return
    let incrementalTimer: ReturnType<typeof setTimeout> | null = null
    let fullRefreshTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = subscribeSyncEvents((eventType: string, payload?: SyncEventPayload) => {
      if (!isFileSyncEvent(eventType)) return

      const hasPayload = payload && ('id' in payload || 'deleted' in payload)
      const canIncremental =
        hasPayload &&
        (eventType.startsWith('todo_list:') ||
          eventType.startsWith('todo_item:') ||
          eventType.endsWith(':deleted') ||
          eventType.endsWith(':created') ||
          eventType.endsWith(':updated'))

      if (canIncremental) {
        pendingEventsRef.current.push({ eventType, payload })
        if (incrementalTimer) clearTimeout(incrementalTimer)
        incrementalTimer = setTimeout(() => {
          incrementalTimer = null
          const events = pendingEventsRef.current
          pendingEventsRef.current = []
          void applyIncrementalUpdate(scope, events).catch(() => {
            void refreshFileList(scope, { silent: true })
          })
        }, SYNC_INCREMENTAL_DEBOUNCE_MS)
      } else {
        if (fullRefreshTimer) clearTimeout(fullRefreshTimer)
        fullRefreshTimer = setTimeout(() => {
          fullRefreshTimer = null
          void refreshFileList(scope, { silent: true })
        }, SYNC_FULL_REFRESH_DEBOUNCE_MS)
      }
    })

    return () => {
      unsubscribe()
      if (incrementalTimer) clearTimeout(incrementalTimer)
      if (fullRefreshTimer) clearTimeout(fullRefreshTimer)
    }
  }, [scope, refreshFileList, applyIncrementalUpdate])

  return { fileList, fileListLoading, refreshFileList, optimisticAdd, optimisticRemove }
}
