/**
 * useFileList - 工作区内的文件列表（任务 + 文档）
 * 纯派生 hook：从 scopeDataStore 的 documents + todoLists 计算 FileItem[]，
 * 不持有独立状态，不订阅 WS 事件（增量更新由 scopeDataStore 统一处理）。
 */
import { useMemo, useCallback } from 'react'
import { useScopeDataStore } from '../store/scopeDataStore'
import type { TodoList, Document } from '@prizm/client-core'

export type FileKind = 'note' | 'todoList' | 'document'

export interface FileItem {
  kind: FileKind
  id: string
  title: string
  updatedAt: number
  raw: TodoList | Document
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

function sortByUpdatedAt(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function useFileList(_scope: string) {
  const documents = useScopeDataStore((s) => s.documents)
  const todoLists = useScopeDataStore((s) => s.todoLists)
  const documentsLoading = useScopeDataStore((s) => s.documentsLoading)
  const todoListsLoading = useScopeDataStore((s) => s.todoListsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)
  const refreshTodoLists = useScopeDataStore((s) => s.refreshTodoLists)

  const fileList = useMemo(() => {
    const items: FileItem[] = [...todoLists.map(todoToFileItem), ...documents.map(docToFileItem)]
    return sortByUpdatedAt(items)
  }, [documents, todoLists])

  const fileListLoading = documentsLoading || todoListsLoading

  const optimisticAdd = useCallback((item: FileItem) => {
    if (item.kind === 'todoList') {
      useScopeDataStore.getState().upsertTodoList(item.raw as TodoList)
    } else {
      useScopeDataStore.getState().upsertDocument(item.raw as Document)
    }
  }, [])

  const optimisticRemove = useCallback((kind: FileKind, id: string) => {
    if (kind === 'todoList') {
      useScopeDataStore.getState().removeTodoList(id)
    } else {
      useScopeDataStore.getState().removeDocument(id)
    }
  }, [])

  const refreshFileList = useCallback(
    async (_s: string, _options?: { silent?: boolean }) => {
      await Promise.allSettled([refreshDocuments(), refreshTodoLists()])
    },
    [refreshDocuments, refreshTodoLists]
  )

  return { fileList, fileListLoading, refreshFileList, optimisticAdd, optimisticRemove }
}
