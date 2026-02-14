/**
 * useFileList - 工作区内的文件列表（便签 + 任务 + 文档）
 * 支持增量更新：根据 WebSocket 事件类型与 payload 做 add/update/remove，减少全量拉取
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import type { StickyNote, TodoList, Document } from '@prizm/client-core'

const SYNC_INCREMENTAL_DEBOUNCE_MS = 100
const SYNC_FULL_REFRESH_DEBOUNCE_MS = 400

export type FileKind = 'note' | 'todoList' | 'document'

export interface FileItem {
  kind: FileKind
  id: string
  title: string
  updatedAt: number
  raw: StickyNote | TodoList | Document
}

function noteToTitle(n: StickyNote): string {
  const firstLine = (n.content || '').split('\n')[0]?.trim()
  return firstLine || '(无标题)'
}

function docToTitle(d: Document): string {
  return d.title || '(无标题文档)'
}

function isFileSyncEvent(eventType: string): boolean {
  return (
    eventType.startsWith('note:') ||
    eventType === 'todo_list:updated' ||
    eventType.startsWith('document:')
  )
}

function toFileItem(note: StickyNote): FileItem {
  return {
    kind: 'note',
    id: note.id,
    title: noteToTitle(note),
    updatedAt: note.updatedAt,
    raw: note
  }
}

function todoToFileItem(todoList: TodoList): FileItem {
  return {
    kind: 'todoList',
    id: todoList.id,
    title: todoList.title || '(待办)',
    updatedAt: todoList.updatedAt,
    raw: todoList
  }
}

function docToFileItem(doc: Document): FileItem {
  return {
    kind: 'document',
    id: doc.id,
    title: docToTitle(doc),
    updatedAt: doc.updatedAt,
    raw: doc
  }
}

function sortByUpdatedAt(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function useFileList(scope: string) {
  const { manager } = usePrizmContext()
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [fileListLoading, setFileListLoading] = useState(false)
  const pendingEventsRef = useRef<Array<{ eventType: string; payload?: SyncEventPayload }>>([])

  const refreshFileList = useCallback(
    async (s: string, options?: { silent?: boolean }) => {
      const http = manager?.getHttpClient()
      if (!http) return
      if (!options?.silent) setFileListLoading(true)
      try {
        const [notes, todoList, documents] = await Promise.all([
          http.listNotes({ scope: s }),
          http.getTodoList(s),
          http.listDocuments({ scope: s })
        ])

        const items: FileItem[] = [
          ...notes.map(toFileItem),
          ...(todoList && todoList.items.length > 0 ? [todoToFileItem(todoList)] : []),
          ...documents.map(docToFileItem)
        ]

        setFileList(sortByUpdatedAt(items))
      } catch {
        setFileList([])
      } finally {
        setFileListLoading(false)
      }
    },
    [manager]
  )

  const applyIncrementalUpdate = useCallback(
    async (s: string, events: Array<{ eventType: string; payload?: SyncEventPayload }>) => {
      const http = manager?.getHttpClient()
      if (!http) return

      const toDelete = new Set<string>()
      const toFetchNote = new Set<string>()
      const toFetchDoc = new Set<string>()
      let fetchTodoList = false

      for (const { eventType, payload } of events) {
        const eventScope = payload?.scope ?? s
        if (eventScope !== s) continue

        const id = payload?.id

        if (eventType === 'note:deleted' && id) toDelete.add(`note:${id}`)
        else if (eventType === 'document:deleted' && id) toDelete.add(`document:${id}`)
        else if ((eventType === 'note:created' || eventType === 'note:updated') && id)
          toFetchNote.add(id)
        else if ((eventType === 'document:created' || eventType === 'document:updated') && id)
          toFetchDoc.add(id)
        else if (eventType === 'todo_list:updated') fetchTodoList = true
      }

      for (const k of toDelete) {
        const [kind, id] = k.split(':')
        if (kind === 'note') toFetchNote.delete(id)
        else if (kind === 'document') toFetchDoc.delete(id)
      }

      setFileList((prev) => {
        let next = prev.filter((p) => !toDelete.has(`${p.kind}:${p.id}`))
        return sortByUpdatedAt(next)
      })

      const fetches: Promise<FileItem | null>[] = []
      for (const id of toFetchNote) {
        fetches.push(
          http
            .getNote(id, s)
            .then(toFileItem)
            .catch(() => null)
        )
      }
      for (const id of toFetchDoc) {
        fetches.push(
          http
            .getDocument(id, s)
            .then(docToFileItem)
            .catch(() => null)
        )
      }
      let todoListFetched = false
      let todoListResult: TodoList | null = null
      if (fetchTodoList) {
        todoListFetched = true
        fetches.push(
          http.getTodoList(s).then((tl) => {
            todoListResult = tl
            return tl ? todoToFileItem(tl) : null
          })
        )
      }

      if (fetches.length === 0) return

      const results = await Promise.all(fetches)
      const newItems = results.filter((x): x is FileItem => x !== null)

      setFileList((prev) => {
        const prevMap = new Map(prev.map((p) => [`${p.kind}:${p.id}`, p]))
        if (todoListFetched && todoListResult === null) {
          for (const k of prevMap.keys()) {
            if (k.startsWith('todoList:')) prevMap.delete(k)
          }
        }
        for (const item of newItems) {
          prevMap.set(`${item.kind}:${item.id}`, item)
        }
        return sortByUpdatedAt(Array.from(prevMap.values()))
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

      const hasPayload = payload && 'id' in payload
      const canIncremental =
        hasPayload &&
        (eventType.endsWith(':deleted') ||
          eventType.endsWith(':created') ||
          eventType.endsWith(':updated'))

      if (canIncremental) {
        pendingEventsRef.current.push({ eventType, payload })
        if (incrementalTimer) clearTimeout(incrementalTimer)
        incrementalTimer = setTimeout(async () => {
          incrementalTimer = null
          const events = pendingEventsRef.current
          pendingEventsRef.current = []
          try {
            await applyIncrementalUpdate(scope, events)
          } catch {
            void refreshFileList(scope, { silent: true })
          }
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

  return { fileList, fileListLoading, refreshFileList }
}
