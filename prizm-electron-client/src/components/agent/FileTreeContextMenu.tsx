/**
 * FileTreeContextMenu - 文件树右键菜单
 * 使用 antd Dropdown 的 open 控制 + 固定位置锚点
 */
import { memo, useCallback, useMemo, useEffect } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { Eye, MessageSquare, Copy, Trash2, FolderOpen } from 'lucide-react'
import type { TreeNode } from '../../hooks/useFileTree'

export interface FileTreeContextMenuProps {
  open: boolean
  position: { x: number; y: number }
  node: TreeNode | null
  onClose: () => void
  onPreview?: (node: TreeNode) => void
  onSendToChat?: (node: TreeNode) => void
  onCopyPath?: (node: TreeNode) => void
  onDelete?: (node: TreeNode) => void
  onOpenFolder?: (node: TreeNode) => void
}

export const FileTreeContextMenu = memo<FileTreeContextMenuProps>(
  ({
    open,
    position,
    node,
    onClose,
    onPreview,
    onSendToChat,
    onCopyPath,
    onDelete,
    onOpenFolder
  }) => {
    const handleClick = useCallback(
      ({ key }: { key: string }) => {
        if (!node) return
        switch (key) {
          case 'preview':
            onPreview?.(node)
            break
          case 'sendToChat':
            onSendToChat?.(node)
            break
          case 'copyPath':
            onCopyPath?.(node)
            break
          case 'openFolder':
            onOpenFolder?.(node)
            break
          case 'delete':
            onDelete?.(node)
            break
        }
        onClose()
      },
      [node, onPreview, onSendToChat, onCopyPath, onDelete, onOpenFolder, onClose]
    )

    const items: MenuProps['items'] = useMemo(() => {
      if (!node) return []
      const result: MenuProps['items'] = []

      if (!node.isDir) {
        result.push({
          key: 'preview',
          icon: <Eye size={14} />,
          label: '预览文件'
        })
        result.push({
          key: 'sendToChat',
          icon: <MessageSquare size={14} />,
          label: '发送到对话'
        })
      }

      if (node.isDir) {
        result.push({
          key: 'openFolder',
          icon: <FolderOpen size={14} />,
          label: '展开文件夹'
        })
      }

      result.push({
        key: 'copyPath',
        icon: <Copy size={14} />,
        label: '复制路径'
      })

      result.push({ type: 'divider' })

      result.push({
        key: 'delete',
        icon: <Trash2 size={14} />,
        label: '删除',
        danger: true
      })

      return result
    }, [node])

    // Close on click outside
    useEffect(() => {
      if (!open) return
      const handler = () => onClose()
      document.addEventListener('click', handler)
      return () => document.removeEventListener('click', handler)
    }, [open, onClose])

    if (!open || !node) return null

    return (
      <div
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 9999
        }}
      >
        <Dropdown
          open
          onOpenChange={(v) => !v && onClose()}
          menu={{ items, onClick: handleClick }}
          trigger={[]}
          overlayStyle={{ minWidth: 160 }}
        >
          <span />
        </Dropdown>
      </div>
    )
  }
)

FileTreeContextMenu.displayName = 'FileTreeContextMenu'
