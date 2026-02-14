/**
 * DataCard - 大卡片展示便签/任务/文档，支持点击、删除、完成等操作
 */
import { memo } from 'react'
import { Button, Markdown, Tag } from '@lobehub/ui'
import type { FileItem } from '../hooks/useFileList'
import type { StickyNote, TodoList, Document } from '@prizm/client-core'
import { FileText, StickyNote as StickyNoteIcon, ListTodo } from 'lucide-react'
import { Icon } from '@lobehub/ui'

function getKindIcon(kind: FileItem['kind']) {
  switch (kind) {
    case 'note':
      return StickyNoteIcon
    case 'todoList':
      return ListTodo
    case 'document':
      return FileText
    default:
      return FileText
  }
}

function getKindLabel(kind: FileItem['kind']) {
  switch (kind) {
    case 'note':
      return '便签'
    case 'todoList':
      return 'TODO'
    case 'document':
      return '文档'
  }
}

interface DataCardProps {
  file: FileItem
  onClick: () => void
  onDelete?: () => void
  onDone?: () => void
}

function DataCard({ file, onClick, onDelete, onDone }: DataCardProps) {
  const IconComponent = getKindIcon(file.kind)
  const isTodoList = file.kind === 'todoList'
  const todoList = file.raw as TodoList | undefined

  return (
    <div
      className={`data-card data-card--${file.kind}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="data-card__header">
        <span className="data-card__icon">
          <Icon icon={IconComponent} size="small" />
        </span>
        <Tag size="small">{getKindLabel(file.kind)}</Tag>
        {isTodoList && todoList && (
          <span className="data-card__status">{todoList.items.length} 项</span>
        )}
      </div>

      <div className="data-card__body">
        {file.kind === 'note' && (
          <div className="data-card__preview">
            <Markdown>
              {((file.raw as StickyNote).content || '(空)')
                .slice(0, 200)
                .concat(((file.raw as StickyNote).content || '').length > 200 ? '…' : '')}
            </Markdown>
          </div>
        )}
        {file.kind === 'document' && (
          <>
            <h3 className="data-card__title">{(file.raw as Document).title || '无标题'}</h3>
            <div className="data-card__preview">
              <Markdown>
                {((file.raw as Document).content ?? '')
                  .slice(0, 120)
                  .concat(((file.raw as Document).content ?? '').length > 120 ? '…' : '') || '(空)'}
              </Markdown>
            </div>
          </>
        )}
        {file.kind === 'todoList' && (
          <>
            <h3 className="data-card__title">{(file.raw as TodoList).title || '待办'}</h3>
            <p className="data-card__desc">
              {(file.raw as TodoList).items
                .map((it) => it.title)
                .slice(0, 3)
                .join(' · ')}
              {(file.raw as TodoList).items.length > 3 ? ' …' : ''}
            </p>
          </>
        )}
      </div>

      <div className="data-card__actions">
        {onDelete && (
          <Button
            type="text"
            danger
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            删除
          </Button>
        )}
      </div>
    </div>
  )
}

export default memo(DataCard, (prev, next) => prev.file === next.file)
