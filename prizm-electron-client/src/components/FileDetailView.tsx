/**
 * FileDetailView - 文件详情：预览/编辑模式切换
 * 弹出编辑：同一 Modal 内点击「编辑」切换为表单，保存后刷新
 * TodoList：编辑预览一体，结构化编辑
 */
import { useState, useEffect } from 'react'
import {
  ActionIcon,
  Button,
  Empty,
  Flexbox,
  Input,
  Markdown,
  Select,
  Tag,
  Text,
  TextArea,
  toast
} from '@lobehub/ui'
import type { FileItem } from '../hooks/useFileList'
import type { StickyNote, TodoList, Document, TodoItem, TodoItemStatus } from '@prizm/client-core'
import { getKindLabel, STATUS_OPTIONS } from '../constants/todo'
import { Plus, Trash2 } from 'lucide-react'

export type SavePayload =
  | { kind: 'note'; content: string }
  | { kind: 'document'; title: string; content: string }
  | { kind: 'todoList'; title: string; items: TodoItem[] }

interface FileDetailViewProps {
  file: FileItem | null
  onDelete: () => void
  onDone: () => void
  onSave?: (payload: SavePayload) => Promise<void>
  onTodoItemStatus?: (itemId: string, status: string) => void
}

export default function FileDetailView({
  file,
  onDelete,
  onDone,
  onSave,
  onTodoItemStatus
}: FileDetailViewProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // 便签
  const [noteContent, setNoteContent] = useState('')
  // 文档
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')
  // 待办（结构化编辑，编辑预览一体）
  const [todoTitle, setTodoTitle] = useState('')
  const [todoItems, setTodoItems] = useState<TodoItem[]>([])
  const [todoError, setTodoError] = useState<string | null>(null)

  useEffect(() => {
    if (file) {
      setEditing(false)
      if (file.kind === 'note') {
        setNoteContent((file.raw as StickyNote).content || '')
      } else if (file.kind === 'document') {
        const d = file.raw as Document
        setDocTitle(d.title || '')
        setDocContent(d.content ?? '')
      } else if (file.kind === 'todoList') {
        const t = file.raw as TodoList
        setTodoTitle(t.title || '待办')
        setTodoItems([...t.items])
      }
    }
  }, [file])

  useEffect(() => {
    if (editing && file) {
      if (file.kind === 'note') setNoteContent((file.raw as StickyNote).content || '')
      else if (file.kind === 'document') {
        const d = file.raw as Document
        setDocTitle(d.title || '')
        setDocContent(d.content ?? '')
      } else if (file.kind === 'todoList') {
        const t = file.raw as TodoList
        setTodoTitle(t.title || '待办')
        setTodoItems([...t.items])
      }
      setTodoError(null)
    }
  }, [editing, file])

  function addTodoItem() {
    const now = Date.now()
    setTodoItems((prev) => [
      ...prev,
      {
        id: '',
        title: '',
        status: 'todo' as TodoItemStatus,
        createdAt: now,
        updatedAt: now
      }
    ])
  }

  function updateTodoItem(idx: number, patch: Partial<TodoItem>) {
    setTodoItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removeTodoItem(idx: number) {
    setTodoItems((prev) => prev.filter((_, i) => i !== idx))
  }

  if (!file) {
    return (
      <div className="file-detail-empty">
        <Empty title="选择文件" description="在左侧列表中点击一个文件查看详情" />
      </div>
    )
  }

  async function handleSave() {
    if (!onSave || !file) return
    setSaving(true)
    try {
      if (file.kind === 'note') {
        await onSave({ kind: 'note', content: noteContent })
      } else if (file.kind === 'document') {
        const title = docTitle.trim()
        if (!title) {
          toast.error('标题不能为空')
          setSaving(false)
          return
        }
        await onSave({ kind: 'document', title, content: docContent })
      } else if (file.kind === 'todoList') {
        const title = todoTitle.trim()
        if (!title) {
          setTodoError('列表标题不能为空')
          setSaving(false)
          return
        }
        const items = todoItems
          .filter((it) => it.title.trim())
          .map((it) => ({
            ...it,
            title: it.title.trim(),
            id: it.id || ''
          }))
        await onSave({ kind: 'todoList', title, items })
      }
      setEditing(false)
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setTodoError(null)
  }

  return (
    <div className="file-detail">
      <div className="file-detail-header">
        <Tag>{getKindLabel(file.kind)}</Tag>
        <Flexbox horizontal gap={8}>
          {editing && onSave && file.kind !== 'todoList' && (
            <>
              <Button onClick={handleCancel}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                保存
              </Button>
            </>
          )}
          {!editing && onSave && file.kind !== 'todoList' && (
            <Button onClick={() => setEditing(true)}>编辑</Button>
          )}
          {file.kind === 'todoList' && onSave && (
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存
            </Button>
          )}
          <Button type="primary" danger onClick={onDelete}>
            删除
          </Button>
        </Flexbox>
      </div>
      <div className="file-detail-body">
        {editing ? (
          <div className="file-detail-edit">
            {file.kind === 'note' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <TextArea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="便签内容..."
                  rows={6}
                  autoSize={{ minRows: 6, maxRows: 12 }}
                />
              </div>
            )}
            {file.kind === 'document' && (
              <Flexbox gap={16} style={{ flexDirection: 'column' }}>
                <div>
                  <Text style={{ display: 'block', marginBottom: 8 }}>标题 *</Text>
                  <Input
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="文档标题"
                  />
                </div>
                <div>
                  <Text style={{ display: 'block', marginBottom: 8 }}>内容（支持 Markdown）</Text>
                  <TextArea
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    placeholder="文档内容..."
                    rows={10}
                    autoSize={{ minRows: 10, maxRows: 20 }}
                  />
                </div>
              </Flexbox>
            )}
          </div>
        ) : (
          <>
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
              <div className="task-detail task-detail--structured">
                <div style={{ marginBottom: 16 }}>
                  <Text style={{ display: 'block', marginBottom: 8 }}>列表标题 *</Text>
                  <Input
                    value={todoTitle}
                    onChange={(e) => {
                      setTodoTitle(e.target.value)
                      setTodoError(null)
                    }}
                    placeholder="待办"
                  />
                  {todoError && (
                    <Text type="danger" style={{ fontSize: 12, marginTop: 4 }}>
                      {todoError}
                    </Text>
                  )}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ display: 'block', marginBottom: 8 }}>TODO 项</Text>
                  <Flexbox gap={8} style={{ flexDirection: 'column' }}>
                    {todoItems.map((it, idx) => (
                      <Flexbox
                        key={it.id || `temp-${idx}`}
                        horizontal
                        gap={8}
                        align="flex-start"
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--ant-border-radius)',
                          border: '1px solid var(--ant-color-border-secondary)',
                          background: 'var(--ant-color-fill-quaternary)'
                        }}
                      >
                        <Flexbox flex={1} gap={4} style={{ minWidth: 0, flexDirection: 'column' }}>
                          <Input
                            value={it.title}
                            onChange={(e) => updateTodoItem(idx, { title: e.target.value })}
                            placeholder="任务标题"
                            size="small"
                          />
                          <Input
                            value={it.description || ''}
                            onChange={(e) =>
                              updateTodoItem(idx, { description: e.target.value || undefined })
                            }
                            placeholder="描述（可选）"
                            size="small"
                          />
                        </Flexbox>
                        <Select
                          value={it.status}
                          onChange={(v) => updateTodoItem(idx, { status: v as TodoItemStatus })}
                          options={STATUS_OPTIONS}
                          size="small"
                          style={{ minWidth: 90, flexShrink: 0 }}
                        />
                        <ActionIcon
                          icon={Trash2}
                          size="small"
                          onClick={() => removeTodoItem(idx)}
                          title="删除"
                        />
                      </Flexbox>
                    ))}
                  </Flexbox>
                </div>
                <Button
                  type="dashed"
                  icon={<Plus size={14} />}
                  onClick={addTodoItem}
                  style={{ width: '100%' }}
                >
                  添加项
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
