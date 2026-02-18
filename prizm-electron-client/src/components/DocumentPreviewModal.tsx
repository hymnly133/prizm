/**
 * DocumentPreviewModal - 文档只读预览模态
 * 点击卡片弹出，Markdown 渲染预览，底部提供编辑跳转按钮
 */
import { useState, useEffect, useRef, memo } from 'react'
import { Button, Flexbox, Markdown, Skeleton, Tag } from '@lobehub/ui'
import { Modal } from 'antd'
import { Icon } from '@lobehub/ui'
import { FileText, Pencil } from 'lucide-react'
import { usePrizmContext } from '../context/PrizmContext'
import type { Document as PrizmDocument } from '@prizm/client-core'

export interface DocumentPreviewModalProps {
  open: boolean
  documentId: string | null
  scope: string
  onClose: () => void
  onEdit: (docId: string) => void
}

function DocumentPreviewModal({
  open,
  documentId,
  scope,
  onClose,
  onEdit
}: DocumentPreviewModalProps) {
  const { manager } = usePrizmContext()
  const [doc, setDoc] = useState<PrizmDocument | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !documentId || !manager) {
      setDoc(null)
      setError(null)
      fetchingRef.current = null
      return
    }
    if (fetchingRef.current === documentId) return
    fetchingRef.current = documentId
    setLoading(true)
    setError(null)
    setDoc(null)

    const http = manager.getHttpClient()
    http
      .getDocument(documentId, scope)
      .then((result) => {
        if (fetchingRef.current === documentId) {
          setDoc(result)
        }
      })
      .catch((e) => {
        if (fetchingRef.current === documentId) {
          setError(String(e))
        }
      })
      .finally(() => {
        if (fetchingRef.current === documentId) {
          setLoading(false)
        }
      })
  }, [open, documentId, scope, manager])

  const handleEdit = () => {
    if (documentId) {
      onClose()
      onEdit(documentId)
    }
  }

  return (
    <Modal
      destroyOnHidden
      open={open}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={FileText} size="middle" />
          <span>{doc?.title || '文档预览'}</span>
        </Flexbox>
      }
      width={720}
      onCancel={onClose}
      footer={
        <Flexbox horizontal justify="space-between" align="center">
          <div />
          <Flexbox horizontal gap={8}>
            <Button
              icon={<Icon icon={Pencil} size="middle" />}
              type="primary"
              onClick={handleEdit}
              disabled={!documentId}
            >
              编辑
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </Flexbox>
        </Flexbox>
      }
    >
      <div style={{ paddingTop: 8, maxHeight: '70vh', overflowY: 'auto' }}>
        {loading && <Skeleton active paragraph={{ rows: 6 }} />}

        {error && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            加载失败: {error}
          </div>
        )}

        {!loading && !error && doc && (
          <>
            {doc.tags && doc.tags.length > 0 && (
              <Flexbox horizontal gap={4} style={{ marginBottom: 12 }}>
                {doc.tags.map((tag) => (
                  <Tag key={tag} size="small">
                    {tag}
                  </Tag>
                ))}
              </Flexbox>
            )}
            <div className="doc-preview-modal__content">
              {doc.content ? (
                <Markdown>{doc.content}</Markdown>
              ) : (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--ant-color-text-quaternary)'
                  }}
                >
                  (空文档)
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default memo(DocumentPreviewModal)
