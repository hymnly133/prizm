/**
 * DocumentEditorZone — 文档编辑器主区域复合组件
 *
 * 封装 Loading skeleton、外部更新 Alert、错误 Alert、
 * EditorToolbar（可选）、编辑器渲染分支、EditorStatusBar。
 * 从 useDocumentDetail() context 读取文档数据。
 * 被 DocumentEditorView 和 DocumentPane 共享。
 */
import { memo, useMemo, useState, useCallback } from 'react'
import { Alert, Button, Flexbox, Skeleton } from '@lobehub/ui'
import { PrizmMarkdown as Markdown } from '../agent/PrizmMarkdown'
import ImagePreviewModal from '../ImagePreviewModal'
import { createStyles } from 'antd-style'
import { useDocumentDetailSafe } from '../../context/DocumentDetailContext'
import { MarkdownEditor, EditorToolbar, SplitEditor, EditorStatusBar } from './index'
import type { EditorMode } from './MarkdownEditor'
import DocumentHeader from '../DocumentHeader'
import { FeedbackWidget } from '../ui/FeedbackWidget'

const useStyles = createStyles(({ css }) => ({
  editorMain: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  editorScrollArea: css`
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `
}))

export interface DocumentEditorZoneProps {
  editorMode: EditorMode
  onModeChange?: (mode: EditorMode) => void
  onSave: () => void
  onDelete: () => void
  onReloadExternal: () => void
  onOverrideExternal: () => void
  /** Show the EditorToolbar (full page = true, collab panel = false) */
  showToolbar?: boolean
  contentMaxWidth?: number
  contentPadding?: string
  externalUpdateDesc?: string
  loadingPadding?: string
}

export const DocumentEditorZone = memo(function DocumentEditorZone({
  editorMode,
  onModeChange,
  onSave,
  onDelete,
  onReloadExternal,
  onOverrideExternal,
  showToolbar = false,
  contentMaxWidth = 760,
  contentPadding = '0 48px',
  externalUpdateDesc = '其他客户端修改了此文档，您可以重新加载最新内容或覆盖保存。',
  loadingPadding = '48px 64px'
}: DocumentEditorZoneProps) {
  const ctx = useDocumentDetailSafe()
  const { styles } = useStyles()
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const handleImageClick = useCallback((src: string) => setPreviewImageSrc(src), [])

  const centeredStyle = useMemo(
    () => ({
      maxWidth: contentMaxWidth,
      width: '100%',
      margin: '0 auto',
      padding: contentPadding,
      flexShrink: 0 as const
    }),
    [contentMaxWidth, contentPadding]
  )

  if (!ctx) return null

  if (ctx.loading) {
    return (
      <div style={{ padding: loadingPadding }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    )
  }

  if (!ctx.document) return null

  const headerElement = (
    <div style={centeredStyle}>
      <DocumentHeader onSave={onSave} onDelete={onDelete} />
    </div>
  )

  return (
    <div className={styles.editorMain}>
      {ctx.externalUpdate && (
        <Alert
          type="warning"
          banner
          showIcon
          message="文档已被外部修改"
          description={externalUpdateDesc}
          extra={
            <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
              <Button size="small" onClick={onReloadExternal}>
                重新加载
              </Button>
              <Button size="small" onClick={onOverrideExternal}>
                忽略
              </Button>
            </Flexbox>
          }
        />
      )}

      {ctx.error && <Alert type="error" banner showIcon closable message={ctx.error} />}

      {showToolbar && onModeChange && (
        <EditorToolbar
          mode={editorMode}
          onModeChange={onModeChange}
          editorRef={ctx.editorRef}
          readOnly={false}
        />
      )}

      <div className={styles.editorScrollArea}>
        {editorMode === 'preview' ? (
          <div className="doc-preview-pane">
            <div style={centeredStyle}>
              {headerElement}
              <Markdown onImageClick={handleImageClick}>{ctx.content || ' '}</Markdown>
            </div>
          </div>
        ) : editorMode === 'split' ? (
          <SplitEditor
            value={ctx.content}
            onChange={ctx.setContent}
            onSave={onSave}
            editorRef={ctx.editorRef}
            header={headerElement}
          />
        ) : (
          <div className="doc-page-editor">
            {headerElement}
            <MarkdownEditor
              value={ctx.content}
              onChange={ctx.setContent}
              mode={editorMode}
              onSave={onSave}
              editorRef={ctx.editorRef}
            />
          </div>
        )}
      </div>

      <Flexbox horizontal align="center" justify="space-between" style={{ padding: '0 8px' }}>
        <EditorStatusBar
          dirty={ctx.dirty}
          saving={ctx.saving}
          charCount={ctx.charCount}
          wordCount={ctx.wordCount}
          editorRef={ctx.editorRef}
        />
        {ctx.document?.id && (
          <FeedbackWidget
            targetType="document"
            targetId={ctx.document.id}
            variant="inline"
          />
        )}
      </Flexbox>

      <ImagePreviewModal
        open={!!previewImageSrc}
        src={previewImageSrc}
        title="图片预览"
        onClose={() => setPreviewImageSrc(null)}
      />
    </div>
  )
})
