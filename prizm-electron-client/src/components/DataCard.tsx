/**
 * DataCard - 大卡片展示便签/任务/文档，支持点击、删除、完成等操作
 */
import { memo, useMemo } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Icon } from '@lobehub/ui'
import type { FileItem } from '../hooks/useFileList'
import type { TodoList, Document } from '@prizm/client-core'
import { FileText, ListTodo } from 'lucide-react'
import { getKindLabel } from '../constants/todo'
import TodoListPreview from './todo/TodoListPreview'

function getKindIcon(kind: FileItem['kind']) {
  switch (kind) {
    case 'todoList':
      return ListTodo
    case 'document':
    case 'note':
    default:
      return FileText
  }
}

interface DataCardProps {
  file: FileItem
  onClick: () => void
  onDelete?: () => void
  onDone?: () => void
}

function stripMarkdown(text: string): string {
  return text
    .replace(/[#*_~`>|[\]()!-]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function DataCard({ file, onClick, onDelete, onDone }: DataCardProps) {
  const IconComponent = getKindIcon(file.kind)
  const isTodoList = file.kind === 'todoList'
  const todoList = file.raw as TodoList | undefined

  const previewText = useMemo(() => {
    if (file.kind !== 'document') return ''
    const raw = ((file.raw as Document).content ?? '').slice(0, 200)
    const stripped = stripMarkdown(raw)
    return stripped.length > 120 ? stripped.slice(0, 120) + '…' : stripped || '(空)'
  }, [file.kind, (file.raw as Document).content])

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
        {file.kind === 'document' && (
          <>
            <h3 className="data-card__title">{(file.raw as Document).title || '无标题'}</h3>
            <p className="data-card__preview data-card__desc">{previewText}</p>
          </>
        )}
        {file.kind === 'todoList' && (
          <>
            <h3 className="data-card__title">{(file.raw as TodoList).title || '待办'}</h3>
            <TodoListPreview items={(file.raw as TodoList).items} maxItems={3} />
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
