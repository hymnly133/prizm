/**
 * DocumentDetailContext — 单文档编辑状态的 Provider
 *
 * 将 useDocument + useDocumentVersions 的数据集中提供给子组件树，
 * 消除 DocumentOutlinePanel / VersionHistoryDrawer / DocumentHeader 等
 * 组件的 props 逐层传递问题。
 *
 * 不包含文档列表（仍由 scopeDataStore 管理）和布局/UI 状态（各页面自行管理）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { EnrichedDocument, ResourceLockInfo } from '@prizm/client-core'
import { useDocument } from '../hooks/useDocument'
import { useDocumentVersions } from '../hooks/useDocumentVersions'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import { usePrizmContext } from './PrizmContext'
import { useNavigation } from './NavigationContext'

function countWords(text: string): number {
  if (!text) return 0
  const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const english = text
    .replace(/[\u4e00-\u9fff]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0).length
  return chinese + english
}

export interface DocumentDetailContextValue {
  /** 当前文档 ID（null 表示未选中） */
  documentId: string | null
  scope: string

  // --- useDocument 返回值 ---
  document: EnrichedDocument | null
  loading: boolean
  saving: boolean
  error: string | null
  dirty: boolean
  externalUpdate: boolean
  content: string
  title: string
  tags: string[]
  setContent: (v: string) => void
  setTitle: (v: string) => void
  setTags: (v: string[]) => void
  save: () => Promise<boolean>
  reload: () => Promise<void>
  loadDocument: (id: string) => Promise<void>
  clearExternalUpdate: () => void

  // --- 派生统计 ---
  charCount: number
  wordCount: number

  // --- 版本管理 ---
  versionCount: number
  versionDrawerOpen: boolean
  setVersionDrawerOpen: (open: boolean) => void
  showVersions: () => void

  // --- 锁信息 ---
  lockInfo: ResourceLockInfo | null

  // --- 编辑器引用（供大纲导航） ---
  editorRef: MutableRefObject<ReactCodeMirrorRef | null>

  // --- 导航 ---
  navigateToSession: (sessionId: string) => void

  // --- 强制释放锁 ---
  forceReleaseLock: () => Promise<void>
}

const DocumentDetailContext = createContext<DocumentDetailContextValue | null>(null)

export function useDocumentDetail(): DocumentDetailContextValue {
  const ctx = useContext(DocumentDetailContext)
  if (!ctx) throw new Error('useDocumentDetail must be used within DocumentDetailProvider')
  return ctx
}

export function useDocumentDetailSafe(): DocumentDetailContextValue | null {
  return useContext(DocumentDetailContext)
}

export interface DocumentDetailProviderProps {
  documentId: string | null
  scope: string
  autoSaveMs?: number
  children: React.ReactNode
}

export function DocumentDetailProvider({
  documentId,
  scope,
  autoSaveMs = 8000,
  children
}: DocumentDetailProviderProps) {
  const { manager } = usePrizmContext()
  const { chatWith } = useNavigation()
  const editorRef = useRef<ReactCodeMirrorRef | null>(null)

  const docHook = useDocument({ scope, autoSaveMs })
  const { versions, fetchVersions } = useDocumentVersions()
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)

  const prevDocIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (documentId && documentId !== prevDocIdRef.current) {
      prevDocIdRef.current = documentId
      void docHook.loadDocument(documentId)
      void fetchVersions(documentId, scope)
    } else if (!documentId) {
      prevDocIdRef.current = null
    }
  }, [documentId, scope, docHook.loadDocument, fetchVersions])

  const charCount = docHook.content.length
  const wordCount = useMemo(() => countWords(docHook.content), [docHook.content])

  const lockInfo = docHook.document?.lockInfo ?? null

  const versionCount = docHook.document?.versionCount ?? versions.length

  const showVersions = useCallback(() => {
    if (documentId) {
      void fetchVersions(documentId, scope)
    }
    setVersionDrawerOpen(true)
  }, [documentId, scope, fetchVersions])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      chatWith({ sessionId })
    },
    [chatWith]
  )

  const forceReleaseLock = useCallback(async () => {
    if (!manager || !documentId) return
    try {
      const http = manager.getHttpClient()
      await http.forceReleaseLock('document', documentId, scope)
      void docHook.reload()
    } catch {
      /* ignore */
    }
  }, [manager, documentId, scope, docHook.reload])

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const LOCK_EVENTS = new Set(['resource:locked', 'resource:unlocked'])
    const unsub = subscribeSyncEvents((eventType) => {
      if (LOCK_EVENTS.has(eventType) && documentId) {
        if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = setTimeout(() => {
          reloadTimerRef.current = null
          void docHook.reload()
        }, 300)
      }
    })
    return () => {
      unsub()
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [documentId, docHook.reload])

  const value = useMemo<DocumentDetailContextValue>(
    () => ({
      documentId,
      scope,
      document: docHook.document,
      loading: docHook.loading,
      saving: docHook.saving,
      error: docHook.error,
      dirty: docHook.dirty,
      externalUpdate: docHook.externalUpdate,
      content: docHook.content,
      title: docHook.title,
      tags: docHook.tags,
      setContent: docHook.setContent,
      setTitle: docHook.setTitle,
      setTags: docHook.setTags,
      save: docHook.save,
      reload: docHook.reload,
      loadDocument: docHook.loadDocument,
      clearExternalUpdate: docHook.clearExternalUpdate,
      charCount,
      wordCount,
      versionCount,
      versionDrawerOpen,
      setVersionDrawerOpen,
      showVersions,
      lockInfo,
      editorRef,
      navigateToSession,
      forceReleaseLock
    }),
    [
      documentId,
      scope,
      docHook.document,
      docHook.loading,
      docHook.saving,
      docHook.error,
      docHook.dirty,
      docHook.externalUpdate,
      docHook.content,
      docHook.title,
      docHook.tags,
      docHook.setContent,
      docHook.setTitle,
      docHook.setTags,
      docHook.save,
      docHook.reload,
      docHook.loadDocument,
      docHook.clearExternalUpdate,
      charCount,
      wordCount,
      versionCount,
      versionDrawerOpen,
      showVersions,
      lockInfo,
      navigateToSession,
      forceReleaseLock
    ]
  )

  return <DocumentDetailContext.Provider value={value}>{children}</DocumentDetailContext.Provider>
}
