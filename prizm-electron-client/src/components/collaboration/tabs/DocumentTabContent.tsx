/**
 * DocumentTabContent — single-document viewer for a tab.
 *
 * Wraps DocumentDetailProvider + DocumentEditorZone for a single entityId.
 * No document list sidebar — just the editor with a compact toolbar.
 */
import { memo, useState, useCallback, useEffect } from 'react'
import { Flexbox } from '@lobehub/ui'
import { BookOpen, Code2, Columns2, Eye } from 'lucide-react'
import { DocumentEditorZone } from '../../editor'
import type { EditorMode } from '../../editor'
import { Segmented } from '../../ui/Segmented'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { DocumentDetailProvider, useDocumentDetail } from '../../../context/DocumentDetailContext'
import { useScope } from '../../../hooks/useScope'
import { useEditorMode } from '../../../hooks/useEditorMode'
import type { TabContentProps } from '../CollabTabContent'

const MODE_OPTIONS: Array<{ label: React.ReactNode; value: EditorMode }> = [
  {
    label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><BookOpen size={11} /> Live</span>,
    value: 'live'
  },
  {
    label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Code2 size={11} /> 源码</span>,
    value: 'source'
  },
  {
    label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Eye size={11} /> 预览</span>,
    value: 'preview'
  },
  {
    label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Columns2 size={11} /> 分栏</span>,
    value: 'split'
  }
]

function DocumentTabInner() {
  const ctx = useDocumentDetail()
  const { editorMode, handleModeChange } = useEditorMode('prizm-collab-tab-doc-mode')

  const handleSave = useCallback(async () => {
    await ctx.save()
  }, [ctx])

  const handleDelete = useCallback(() => {
    // no-op in tab mode: delete is a destructive action requiring full UI
  }, [])

  const handleReloadExternal = useCallback(() => {
    ctx.clearExternalUpdate()
    void ctx.reload()
  }, [ctx])

  const handleOverrideExternal = useCallback(() => {
    ctx.clearExternalUpdate()
  }, [ctx])

  if (ctx.loading && !ctx.document) {
    return <LoadingPlaceholder />
  }

  if (!ctx.document) {
    return <LoadingPlaceholder text="文档未找到" />
  }

  return (
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--ant-color-border-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ant-color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {ctx.document.title || '未命名'}
        </span>
        <Segmented
          size="small"
          value={editorMode}
          onChange={(v) => handleModeChange(v as EditorMode)}
          options={MODE_OPTIONS}
          style={{ fontSize: 11 }}
        />
      </div>
      <DocumentEditorZone
        editorMode={editorMode}
        onModeChange={handleModeChange}
        onSave={handleSave}
        onDelete={handleDelete}
        onReloadExternal={handleReloadExternal}
        onOverrideExternal={handleOverrideExternal}
        contentMaxWidth={680}
        contentPadding="0 24px"
        externalUpdateDesc="其他客户端修改了此文档。"
        loadingPadding="24px 32px"
      />
    </Flexbox>
  )
}

export const DocumentTabContent = memo(function DocumentTabContent({
  entityId
}: TabContentProps) {
  const { currentScope } = useScope()

  if (!entityId) {
    return <LoadingPlaceholder text="缺少文档 ID" />
  }

  return (
    <DocumentDetailProvider documentId={entityId} scope={currentScope}>
      <DocumentTabInner />
    </DocumentDetailProvider>
  )
})
