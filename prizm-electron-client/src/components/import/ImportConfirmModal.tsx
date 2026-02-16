/**
 * ImportConfirmModal - 通用导入确认对话框
 * 支持单项模式（文本/单文件）和多项模式（批量文件）
 * 纯 UI 组件，通过 ImportContext 驱动，与触发方式无关
 */
import { memo, useMemo, useCallback } from 'react'
import { Button, Markdown, Tag } from '@lobehub/ui'
import { Modal, Progress } from 'antd'
import {
  FileText,
  FileWarning,
  Check,
  AlertCircle,
  Sparkles,
  Download,
  Loader2
} from 'lucide-react'
import { useImportContext } from '../../context/ImportContext'
import { useImportActions } from '../../hooks/useImportActions'
import type { ImportItem } from '../../types/import'
import { formatFileSize } from '../../types/import'

/** 截断预览文本 */
function truncatePreview(content: string | null, maxLen = 500): string {
  if (!content) return '(空内容)'
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen) + '\n\n...(内容已截断)'
}

/** 单个导入项状态图标 */
function ItemStatusIcon({ status }: { status: ImportItem['status'] }) {
  switch (status) {
    case 'done':
      return <Check size={14} style={{ color: 'var(--ant-color-success)' }} />
    case 'importing':
      return (
        <Loader2
          size={14}
          className="import-spin-icon"
          style={{ color: 'var(--ant-color-primary)' }}
        />
      )
    case 'error':
      return <AlertCircle size={14} style={{ color: 'var(--ant-color-error)' }} />
    case 'ai-sent':
      return <Sparkles size={14} style={{ color: 'var(--ant-geekblue-6, #2f54eb)' }} />
    default:
      return <FileText size={14} style={{ color: 'var(--ant-color-text-tertiary)' }} />
  }
}

/** 单项导入行 */
const ImportItemRow = memo(
  ({
    item,
    onDirect,
    onAI
  }: {
    item: ImportItem
    onDirect: (item: ImportItem) => void
    onAI: (item: ImportItem) => void
  }) => {
    const isActioned = item.status === 'done' || item.status === 'ai-sent'
    const isProcessing = item.status === 'importing'

    return (
      <div
        className="import-item-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 0',
          borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          opacity: item.unsupported ? 0.5 : 1
        }}
      >
        <ItemStatusIcon status={item.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {item.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ant-color-text-quaternary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {item.size != null && <span>{formatFileSize(item.size)}</span>}
            {item.unsupported && (
              <Tag color="warning" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                不支持
              </Tag>
            )}
            {item.truncated && (
              <Tag
                color="processing"
                style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
              >
                已截断
              </Tag>
            )}
            {item.errorMessage && (
              <span style={{ color: 'var(--ant-color-error)', fontSize: 11 }}>
                {item.errorMessage}
              </span>
            )}
          </div>
        </div>
        {!item.unsupported && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Button
              size="small"
              onClick={() => onDirect(item)}
              disabled={isActioned || isProcessing}
              icon={<Download size={12} />}
              style={{ fontSize: 12 }}
            >
              导入
            </Button>
            <Button
              size="small"
              type="primary"
              ghost
              onClick={() => onAI(item)}
              disabled={isActioned || isProcessing}
              icon={<Sparkles size={12} />}
              style={{ fontSize: 12 }}
            >
              AI 整理
            </Button>
          </div>
        )}
      </div>
    )
  }
)
ImportItemRow.displayName = 'ImportItemRow'

/** 单项模式内容 */
function SingleItemView({
  item,
  onDirect,
  onAI
}: {
  item: ImportItem
  onDirect: () => void
  onAI: () => void
}) {
  const isProcessing = item.status === 'importing'

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12
        }}
      >
        {item.type === 'file' ? <FileText size={18} /> : <FileText size={18} />}
        <span style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</span>
        {item.size != null && (
          <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
            ({formatFileSize(item.size)})
          </span>
        )}
        {item.truncated && (
          <Tag color="processing" style={{ fontSize: 10 }}>
            已截断到 1MB
          </Tag>
        )}
      </div>

      {item.unsupported ? (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: 'var(--ant-color-text-quaternary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          <FileWarning size={20} />
          <span>不支持的文件类型，无法导入</span>
        </div>
      ) : (
        <>
          <div
            style={{
              maxHeight: 280,
              overflow: 'auto',
              borderRadius: 8,
              border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
              padding: '8px 12px',
              marginBottom: 16,
              fontSize: 13,
              background: 'var(--ant-color-fill-quaternary, #fafafa)'
            }}
          >
            <Markdown variant="chat">{truncatePreview(item.content)}</Markdown>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              onClick={onDirect}
              loading={isProcessing}
              disabled={item.status === 'done'}
              icon={<Download size={14} />}
            >
              {item.status === 'done' ? '已导入' : '直接导入为文档'}
            </Button>
            <Button
              type="primary"
              onClick={onAI}
              disabled={isProcessing || item.status === 'ai-sent'}
              icon={<Sparkles size={14} />}
            >
              {item.status === 'ai-sent' ? '已发送' : '交给 AI 整理'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** 多项模式内容 */
function MultiItemView({
  items,
  onDirectItem,
  onAIItem,
  onDirectAll,
  onAIAll
}: {
  items: ImportItem[]
  onDirectItem: (item: ImportItem) => void
  onAIItem: (item: ImportItem) => void
  onDirectAll: () => void
  onAIAll: () => void
}) {
  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'ai-sent').length
  const validCount = items.filter((i) => !i.unsupported).length
  const allDone = doneCount >= validCount
  const isAnyProcessing = items.some((i) => i.status === 'importing')

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          justifyContent: 'flex-end'
        }}
      >
        <Button
          onClick={onDirectAll}
          disabled={allDone || isAnyProcessing}
          loading={isAnyProcessing}
          icon={<Download size={14} />}
        >
          全部直接导入
        </Button>
        <Button
          type="primary"
          ghost
          onClick={onAIAll}
          disabled={allDone || isAnyProcessing}
          icon={<Sparkles size={14} />}
        >
          全部交给 AI 整理
        </Button>
      </div>

      <div
        style={{
          maxHeight: 360,
          overflow: 'auto',
          borderRadius: 8,
          border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          padding: '0 12px'
        }}
      >
        {items.map((item) => (
          <ImportItemRow key={item.id} item={item} onDirect={onDirectItem} onAI={onAIItem} />
        ))}
      </div>

      {doneCount > 0 && (
        <div style={{ marginTop: 12 }}>
          <Progress
            percent={Math.round((doneCount / validCount) * 100)}
            size="small"
            format={() => `${doneCount}/${validCount}`}
          />
        </div>
      )}
    </div>
  )
}

/** 导入确认对话框 */
const ImportConfirmModal = memo(() => {
  const { importState, updateItemStatus, closeImport } = useImportContext()
  const { importDirect, importWithAI, importAllDirect, importAllWithAI } = useImportActions()

  const { open, items } = importState
  const isSingle = items.length === 1

  const title = useMemo(() => {
    if (items.length === 0) return '导入确认'
    if (isSingle) return '导入确认'
    return `导入确认 (${items.length} 个文件)`
  }, [items.length, isSingle])

  const handleDirectSingle = useCallback(async () => {
    const item = items[0]
    if (!item) return
    updateItemStatus(item.id, 'importing')
    try {
      await importDirect(item)
      updateItemStatus(item.id, 'done')
    } catch (e) {
      updateItemStatus(item.id, 'error', String(e))
    }
  }, [items, importDirect, updateItemStatus])

  const handleAISingle = useCallback(() => {
    const item = items[0]
    if (!item) return
    importWithAI(item)
    updateItemStatus(item.id, 'ai-sent')
    closeImport()
  }, [items, importWithAI, updateItemStatus, closeImport])

  const handleDirectItem = useCallback(
    async (item: ImportItem) => {
      updateItemStatus(item.id, 'importing')
      try {
        await importDirect(item)
        updateItemStatus(item.id, 'done')
      } catch (e) {
        updateItemStatus(item.id, 'error', String(e))
      }
    },
    [importDirect, updateItemStatus]
  )

  const handleAIItem = useCallback(
    (item: ImportItem) => {
      importWithAI(item)
      updateItemStatus(item.id, 'ai-sent')
      closeImport()
    },
    [importWithAI, updateItemStatus, closeImport]
  )

  const handleDirectAll = useCallback(async () => {
    await importAllDirect(
      items,
      (id) => updateItemStatus(id, 'done'),
      (id, error) => updateItemStatus(id, 'error', error)
    )
  }, [items, importAllDirect, updateItemStatus])

  const handleAIAll = useCallback(() => {
    importAllWithAI(items)
    items.forEach((item) => {
      if (!item.unsupported && item.content) {
        updateItemStatus(item.id, 'ai-sent')
      }
    })
    closeImport()
  }, [items, importAllWithAI, updateItemStatus, closeImport])

  const allDone = items.every((i) => i.unsupported || i.status === 'done' || i.status === 'ai-sent')

  return (
    <Modal
      open={open}
      title={title}
      onCancel={closeImport}
      footer={null}
      width={isSingle ? 520 : 600}
      destroyOnClose
      afterClose={() => {}}
    >
      {isSingle && items[0] ? (
        <SingleItemView item={items[0]} onDirect={handleDirectSingle} onAI={handleAISingle} />
      ) : items.length > 1 ? (
        <MultiItemView
          items={items}
          onDirectItem={handleDirectItem}
          onAIItem={handleAIItem}
          onDirectAll={handleDirectAll}
          onAIAll={handleAIAll}
        />
      ) : null}

      {allDone && items.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button type="primary" onClick={closeImport}>
            完成
          </Button>
        </div>
      )}
    </Modal>
  )
})

ImportConfirmModal.displayName = 'ImportConfirmModal'

export default ImportConfirmModal
