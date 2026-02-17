/**
 * DocumentHeader - 文档头部区域
 * 标题编辑（EditableText）、标签管理、更新时间、操作菜单
 */
import { useCallback } from 'react'
import { Button, Dropdown, type MenuProps } from 'antd'
import { EditableText, Flexbox, Hotkey } from '@lobehub/ui'
import { Save, Trash2, MoreHorizontal, History, Download, Circle } from 'lucide-react'
import TagSelector from './ui/TagSelector'

interface DocumentHeaderProps {
  title: string
  tags: string[]
  content: string
  updatedAt?: number
  dirty: boolean
  saving: boolean
  onTitleChange: (title: string) => void
  onTagsChange: (tags: string[]) => void
  onSave: () => void
  onDelete: () => void
  onShowVersions?: () => void
}

export default function DocumentHeader({
  title,
  tags,
  content,
  updatedAt,
  dirty,
  saving,
  onTitleChange,
  onTagsChange,
  onSave,
  onDelete,
  onShowVersions
}: DocumentHeaderProps) {
  const menuItems: MenuProps['items'] = [
    ...(onShowVersions
      ? [{ key: 'versions', icon: <History size={14} />, label: '版本历史' }]
      : []),
    { key: 'export', icon: <Download size={14} />, label: '导出 Markdown' },
    { type: 'divider' as const },
    { key: 'delete', icon: <Trash2 size={14} />, label: '删除文档', danger: true }
  ]

  const handleMenuClick = useCallback(
    ({ key }: { key: string }) => {
      switch (key) {
        case 'versions':
          onShowVersions?.()
          break
        case 'export': {
          const exportContent = `# ${title}\n\n${content}`
          const blob = new Blob([exportContent], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${title || 'document'}.md`
          a.click()
          URL.revokeObjectURL(url)
          break
        }
        case 'delete':
          onDelete()
          break
      }
    },
    [title, content, onDelete, onShowVersions]
  )

  return (
    <div className="doc-header">
      <Flexbox horizontal align="center" gap={8} style={{ minHeight: 40 }}>
        {/* 标题 - 使用 EditableText */}
        <div className="doc-header-title-area" style={{ flex: 1, minWidth: 0 }}>
          <EditableText
            value={title || '无标题'}
            onChangeEnd={(val) => {
              const trimmed = (val ?? '').trim()
              if (trimmed && trimmed !== title) {
                onTitleChange(trimmed)
              }
            }}
            showEditIcon
            style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.4, width: '100%' }}
          />
        </div>

        {/* 状态指示 */}
        {dirty && (
          <span className="doc-header-dirty" title="未保存">
            <Circle size={8} fill="var(--ant-color-warning)" stroke="none" />
          </span>
        )}

        {/* 操作按钮 */}
        <Button
          type="primary"
          size="small"
          icon={<Save size={14} />}
          loading={saving}
          disabled={!dirty}
          onClick={onSave}
          title="Ctrl+S"
        >
          保存 <Hotkey keys="mod+s" compact style={{ marginLeft: 4, opacity: 0.7 }} />
        </Button>

        <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
          <Button type="text" size="small" icon={<MoreHorizontal size={16} />} />
        </Dropdown>
      </Flexbox>

      {/* 元信息行 */}
      <Flexbox horizontal align="center" gap={12} style={{ padding: '4px 0', minHeight: 28 }}>
        <TagSelector value={tags} onChange={onTagsChange} placeholder="添加标签..." />

        {updatedAt && (
          <span className="doc-header-time">
            {new Date(updatedAt).toLocaleString('zh-CN', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        )}
      </Flexbox>
    </div>
  )
}
