/**
 * 文件内嵌预览面板：便签 / 文档 / 待办列表内容预览，支持点击图片放大
 */
import { ActionIcon, Flexbox, Tag } from '@lobehub/ui'
import { PrizmMarkdown as Markdown } from './PrizmMarkdown'
import type { Document as PrizmDocument, TodoList } from '@prizm/client-core'
import { X } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import ImagePreviewModal from '../ImagePreviewModal'
import type { FileKind } from '../../hooks/useFileList'

const KIND_LABELS: Record<FileKind, string> = {
  note: '便签',
  document: '文档',
  todoList: '待办列表'
}

export interface FilePreviewPanelProps {
  fileRef: { kind: FileKind; id: string }
  scope: string
  onClose: () => void
}

export function FilePreviewPanel({ fileRef, scope, onClose }: FilePreviewPanelProps) {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const handleImageClick = useCallback((src: string) => setPreviewImageSrc(src), [])

  useEffect(() => {
    if (!http) return
    setLoading(true)
    setError(null)

    const fetchFile = async () => {
      try {
        if (fileRef.kind === 'document' || fileRef.kind === 'note') {
          const doc = await http.getDocument(fileRef.id, scope)
          const titleStr = (doc as PrizmDocument).title
          const contentStr = (doc as PrizmDocument).content ?? ''
          setTitle(
            fileRef.kind === 'note'
              ? contentStr.split('\n')[0]?.trim() || '便签'
              : titleStr || '无标题文档'
          )
          setContent(contentStr)
        } else if (fileRef.kind === 'todoList') {
          const list = await http.getTodoList(scope, fileRef.id)
          if (list) {
            setTitle((list as TodoList).title || '待办列表')
            const items = (list as TodoList).items ?? []
            const md = items
              .map((it) => `- [${it.status === 'done' ? 'x' : ' '}] ${it.title}`)
              .join('\n')
            setContent(md || '(空列表)')
          } else {
            setError('未找到该待办列表')
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    void fetchFile()
  }, [http, fileRef.kind, fileRef.id, scope])

  return (
    <div className="file-preview-panel">
      <div className="file-preview-panel__header">
        <Flexbox horizontal align="center" gap={8} flex={1} style={{ minWidth: 0 }}>
          <Tag size="small">{KIND_LABELS[fileRef.kind]}</Tag>
          <span className="file-preview-panel__title">{title || '加载中…'}</span>
        </Flexbox>
        <ActionIcon icon={X} size="small" title="关闭" onClick={onClose} />
      </div>
      <div className="file-preview-panel__body">
        {loading ? (
          <LoadingPlaceholder />
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            {error}
          </div>
        ) : (
          <div className="md-preview-wrap">
            <Markdown onImageClick={handleImageClick}>{content || '(空)'}</Markdown>
          </div>
        )}
      </div>
      <ImagePreviewModal
        open={!!previewImageSrc}
        src={previewImageSrc}
        title="图片预览"
        onClose={() => setPreviewImageSrc(null)}
      />
    </div>
  )
}
