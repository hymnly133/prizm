import { Button, Empty, Markdown, Tag } from '@lobehub/ui'
import type { FileItem } from '../hooks/useFileList'
import type { StickyNote, TodoList, Document } from '@prizm/client-core'

interface FileDetailViewProps {
  file: FileItem | null
  onDelete: () => void
  onDone: () => void
  onTodoItemStatus?: (itemId: string, status: string) => void
}

const STATUS_LABELS: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成' }

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
        <Tag>{file.kind === 'note' ? '便签' : file.kind === 'todoList' ? 'TODO' : '文档'}</Tag>
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
            <h2 className="task-title">{(file.raw as TodoList).title}</h2>
            <ul className="task-meta space-y-2">
              {(file.raw as TodoList).items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start justify-between gap-2 rounded border border-zinc-600/50 p-2"
                >
                  <span>
                    <span className="text-zinc-100">{it.title}</span>
                    {it.description && (
                      <p className="mt-1 text-sm text-zinc-400">{it.description}</p>
                    )}
                  </span>
                  {onTodoItemStatus ? (
                    <select
                      value={it.status}
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onTodoItemStatus(it.id, e.target.value)}
                    >
                      <option value="todo">{STATUS_LABELS.todo}</option>
                      <option value="doing">{STATUS_LABELS.doing}</option>
                      <option value="done">{STATUS_LABELS.done}</option>
                    </select>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      {STATUS_LABELS[it.status] ?? it.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {(file.raw as TodoList).items.length === 0 && (
              <p className="text-zinc-500">暂无 TODO 项</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
