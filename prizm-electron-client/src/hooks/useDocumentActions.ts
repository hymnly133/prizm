/**
 * useDocumentActions — 文档 CRUD 和交互操作的共享 hook
 *
 * 提取 DocumentEditorView 和 DocumentPane 共同的
 * handleSelectDoc / handleCreateDoc / handleSave / handleDelete /
 * handleReloadExternal / handleOverrideExternal / handleSidebarDeleteDoc 逻辑。
 */
import { useCallback } from 'react'
import { App } from 'antd'
import { toast } from '@lobehub/ui'
import type { EnrichedDocument } from '@prizm/client-core'
import type { DocumentDetailContextValue } from '../context/DocumentDetailContext'
import { usePrizmContext } from '../context/PrizmContext'
import { useScopeDataStore } from '../store/scopeDataStore'

export interface UseDocumentActionsOptions {
  scope: string
  activeDocId: string | null
  setActiveDocId: (id: string | null) => void
  ctx: DocumentDetailContextValue
}

export interface DocumentActions {
  handleSelectDoc: (doc: EnrichedDocument) => void
  handleCreateDoc: () => Promise<void>
  handleSave: () => Promise<void>
  handleDelete: () => void
  handleReloadExternal: () => void
  handleOverrideExternal: () => void
  handleSidebarDeleteDoc: (doc: EnrichedDocument) => void
}

export function useDocumentActions({
  scope,
  activeDocId,
  setActiveDocId,
  ctx
}: UseDocumentActionsOptions): DocumentActions {
  const { modal } = App.useApp()
  const { manager } = usePrizmContext()

  const handleSelectDoc = useCallback(
    (doc: EnrichedDocument) => {
      if (doc.id === activeDocId) return
      setActiveDocId(doc.id)
      void ctx.loadDocument(doc.id)
    },
    [activeDocId, setActiveDocId, ctx.loadDocument]
  )

  const handleCreateDoc = useCallback(async () => {
    if (!manager) return
    try {
      const client = manager.getHttpClient()
      const doc = await client.createDocument({ title: '新文档', content: '' }, scope)
      useScopeDataStore.getState().upsertDocument(doc)
      setActiveDocId(doc.id)
      void ctx.loadDocument(doc.id)
      toast.success('文档已创建')
    } catch (e) {
      toast.error(`创建文档失败: ${String(e)}`)
    }
  }, [manager, scope, setActiveDocId, ctx.loadDocument])

  const handleSave = useCallback(async () => {
    const ok = await ctx.save()
    if (ok) {
      toast.success('已保存')
    } else {
      toast.error('保存失败，请重试')
    }
  }, [ctx.save])

  const handleDelete = useCallback(() => {
    if (!ctx.document || !manager) return
    modal.confirm({
      title: '确认删除',
      content: `确定要删除文档「${ctx.document.title}」吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const client = manager.getHttpClient()
          await client.deleteDocument(ctx.document!.id, scope)
          setActiveDocId(null)
          useScopeDataStore.getState().removeDocument(ctx.document!.id)
          toast.success('文档已删除')
        } catch (e) {
          toast.error(`删除失败: ${String(e)}`)
        }
      }
    })
  }, [ctx.document, manager, scope, modal, setActiveDocId])

  const handleReloadExternal = useCallback(() => {
    ctx.clearExternalUpdate()
    void ctx.reload()
  }, [ctx.clearExternalUpdate, ctx.reload])

  const handleOverrideExternal = useCallback(() => {
    ctx.clearExternalUpdate()
  }, [ctx.clearExternalUpdate])

  const handleSidebarDeleteDoc = useCallback(
    (doc: EnrichedDocument) => {
      modal.confirm({
        title: '确认删除',
        content: `确定要删除文档「${doc.title}」吗？此操作不可撤销。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            const client = manager!.getHttpClient()
            await client.deleteDocument(doc.id, scope)
            if (activeDocId === doc.id) setActiveDocId(null)
            useScopeDataStore.getState().removeDocument(doc.id)
            toast.success('文档已删除')
          } catch (e) {
            toast.error(`删除失败: ${String(e)}`)
          }
        }
      })
    },
    [manager, scope, activeDocId, setActiveDocId, modal]
  )

  return {
    handleSelectDoc,
    handleCreateDoc,
    handleSave,
    handleDelete,
    handleReloadExternal,
    handleOverrideExternal,
    handleSidebarDeleteDoc
  }
}
