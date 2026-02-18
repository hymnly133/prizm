/**
 * useDocument - 单文档状态管理 hook
 * 加载、保存（debounce）、自动保存、dirty 标记、草稿管理
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import type { EnrichedDocument } from '@prizm/client-core'

interface UseDocumentOptions {
  scope?: string
  /** 自动保存间隔(ms)，0 禁用，默认 5000 */
  autoSaveMs?: number
}

interface UseDocumentReturn {
  document: EnrichedDocument | null
  loading: boolean
  saving: boolean
  error: string | null
  dirty: boolean
  /** 外部变更检测标记（WebSocket 推送的其他客户端变更） */
  externalUpdate: boolean
  content: string
  title: string
  tags: string[]
  setContent: (content: string) => void
  setTitle: (title: string) => void
  setTags: (tags: string[]) => void
  save: () => Promise<boolean>
  reload: () => Promise<void>
  loadDocument: (id: string) => Promise<void>
  /** 清除外部变更标记 */
  clearExternalUpdate: () => void
}

const DRAFT_PREFIX = 'prizm-doc-draft:'

function saveDraft(docId: string, content: string): void {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${docId}`, content)
  } catch {
    // localStorage full or unavailable
  }
}

function loadDraft(docId: string): string | null {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${docId}`)
  } catch {
    return null
  }
}

function clearDraft(docId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${docId}`)
  } catch {
    // ignore
  }
}

export function useDocument(options: UseDocumentOptions = {}): UseDocumentReturn {
  const { manager } = usePrizmContext()
  const { scope, autoSaveMs = 5000 } = options

  const [document, setDocument] = useState<EnrichedDocument | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [externalUpdate, setExternalUpdate] = useState(false)

  const [content, setContentState] = useState('')
  const [title, setTitleState] = useState('')
  const [tags, setTagsState] = useState<string[]>([])

  const docIdRef = useRef<string | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedContentRef = useRef('')

  const setContent = useCallback((val: string) => {
    setContentState(val)
    const isDirty = val !== savedContentRef.current
    setDirty(isDirty)
    if (docIdRef.current && isDirty) {
      saveDraft(docIdRef.current, val)
    }
  }, [])

  const setTitle = useCallback((val: string) => {
    setTitleState(val)
    setDirty(true)
  }, [])

  const setTags = useCallback((val: string[]) => {
    setTagsState(val)
    setDirty(true)
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    if (!manager || !docIdRef.current) return false
    setSaving(true)
    setError(null)
    try {
      const client = manager.getHttpClient()
      const updated = await client.updateDocument(
        docIdRef.current,
        { title: title.trim() || undefined, content, tags },
        scope
      )
      setDocument(updated)
      savedContentRef.current = updated.content ?? ''
      setDirty(false)
      clearDraft(docIdRef.current)
      return true
    } catch (e) {
      setError(String(e))
      return false
    } finally {
      setSaving(false)
    }
  }, [manager, title, content, tags, scope])

  const loadDocument = useCallback(
    async (id: string) => {
      if (!manager) return
      docIdRef.current = id
      setLoading(true)
      setError(null)
      setDirty(false)
      try {
        const client = manager.getHttpClient()
        const doc = await client.getDocument(id, scope)
        setDocument(doc)
        setTitleState(doc.title)
        setTagsState(doc.tags ?? [])

        const draft = loadDraft(id)
        const contentToUse = draft ?? doc.content ?? ''
        setContentState(contentToUse)
        savedContentRef.current = doc.content ?? ''
        if (draft && draft !== (doc.content ?? '')) {
          setDirty(true)
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [manager, scope]
  )

  const reload = useCallback(async () => {
    if (docIdRef.current) {
      clearDraft(docIdRef.current)
      await loadDocument(docIdRef.current)
    }
  }, [loadDocument])

  const clearExternalUpdate = useCallback(() => setExternalUpdate(false), [])

  // 自动保存
  useEffect(() => {
    if (!dirty || !autoSaveMs || autoSaveMs <= 0) return

    autoSaveTimer.current = setTimeout(() => {
      void save()
    }, autoSaveMs)

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [dirty, autoSaveMs, save])

  // WebSocket: 监听外部文档变更
  useEffect(() => {
    const unsub = subscribeSyncEvents((eventType, payload) => {
      if (eventType !== 'document:updated' && eventType !== 'document:deleted') return
      if (!docIdRef.current || !payload?.id) return
      if (payload.id !== docIdRef.current) return

      if (eventType === 'document:deleted') {
        setError('此文档已被删除')
        return
      }

      // 外部变更检测：仅在非本客户端触发时标记
      if (!saving) {
        setExternalUpdate(true)
      }
    })
    return unsub
  }, [saving])

  return {
    document,
    loading,
    saving,
    error,
    dirty,
    externalUpdate,
    content,
    title,
    tags,
    setContent,
    setTitle,
    setTags,
    save,
    reload,
    loadDocument,
    clearExternalUpdate
  }
}
