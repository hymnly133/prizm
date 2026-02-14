import { Button, Empty, Flexbox, Markdown, Tag, Text } from '@lobehub/ui'
import type { FileItem } from '../hooks/useFileList'
import type { StickyNote, TodoList, Document } from '@prizm/client-core'
import { getKindLabel } from '../constants/todo'
import TodoItemRow from './todo/TodoItemRow'

interface FileDetailViewProps {
  file: FileItem | null
  onDelete: () => void
  onDone: () => void
  onTodoItemStatus?: (itemId: string, status: string) => void
}

export default function FileDetailView({
  file,
  onDelete,
  onDone,
  onTodoItemStatus
}: FileDetailViewProps) {
  if (!file) {
    return (
      <div className="file-detail-empty">
        <Empty title="选择文件" description="在左侧列表中点击一个文件查看详情" />
      </div>
    )
  }

  return (
    <div className="file-detail">
      <div className="file-detail-header">
        <Tag>{getKindLabel(file.kind)}</Tag>
        <Button type="primary" danger onClick={onDelete}>
          删除
        </Button>
      </div>
      <div className="file-detail-body">
        {file.kind === 'note' && (
          <div className="note-detail">
            <div className="md-preview-wrap">
              <Markdown>{(file.raw as StickyNote).content || '(空)'}</Markdown>
            </div>
          </div>
        )}
        {file.kind === 'document' && (
          <div className="document-detail">
            <h2 className="document-title">{(file.raw as Document).title || '无标题'}</h2>
            <div className="md-preview-wrap">
              <Markdown>{(file.raw as Document).content ?? '(空)'}</Markdown>
            </div>
          </div>
        )}
        {file.kind === 'todoList' && (
          <div className="task-detail">
            <h2 className="task-title">{(file.raw as TodoList).title || '待办'}</h2>
            <Flexbox gap={8} style={{ flexDirection: 'column' }} className="task-meta">
              {(file.raw as TodoList).items.map((it) => (
                <TodoItemRow
                  key={it.id}
                  item={it}
                  onStatusChange={
                    onTodoItemStatus ? (id, status) => onTodoItemStatus(id, status) : undefined
                  }
                />
              ))}
            </Flexbox>
            {(file.raw as TodoList).items.length === 0 && (
              <Text type="secondary">暂无 TODO 项</Text>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
