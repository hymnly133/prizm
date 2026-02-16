/**
 * FileTreeNode - react-arborist 自定义节点渲染
 * 融合 LobeUI 主题变量，支持拖拽引用和右键菜单
 */
import { memo, useCallback } from 'react'
import type { NodeRendererProps } from 'react-arborist'
import {
  Folder,
  FolderOpen,
  FileText,
  File,
  ListTodo,
  ChevronRight,
  ChevronDown
} from 'lucide-react'
import type { TreeNode } from '../../hooks/useFileTree'

function getIcon(node: TreeNode, isOpen: boolean) {
  if (node.isDir) {
    return isOpen ? (
      <FolderOpen size={14} style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }} />
    ) : (
      <Folder size={14} style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }} />
    )
  }
  if (node.prizmType === 'todo_list') {
    return <ListTodo size={14} style={{ color: 'var(--ant-color-success)', flexShrink: 0 }} />
  }
  if (node.prizmType === 'document') {
    return <FileText size={14} style={{ color: 'var(--ant-color-primary)', flexShrink: 0 }} />
  }
  return <File size={14} style={{ color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }} />
}

export interface FileTreeNodeProps extends NodeRendererProps<TreeNode> {
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  onFileClick?: (node: TreeNode) => void
}

export const FileTreeNode = memo<FileTreeNodeProps>(
  ({ node, style, dragHandle, tree, onContextMenu, onFileClick }) => {
    const data = node.data
    const isOpen = node.isOpen

    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', `@file:${data.id}`)
        e.dataTransfer.effectAllowed = 'copy'
      },
      [data.id]
    )

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e, data)
      },
      [onContextMenu, data]
    )

    const handleClick = useCallback(() => {
      if (data.isDir) {
        node.toggle()
      } else {
        onFileClick?.(data)
      }
    }, [data, node, onFileClick])

    const indent = node.level * 16

    return (
      <div
        ref={dragHandle}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 4 + indent,
          paddingRight: 8,
          height: 28,
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--ant-color-text)',
          borderRadius: 4,
          background: node.isSelected
            ? 'var(--ant-color-primary-bg)'
            : node.isFocused
            ? 'var(--ant-color-fill-tertiary)'
            : 'transparent',
          userSelect: 'none'
        }}
        draggable
        onDragStart={handleDragStart}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if (!node.isSelected) {
            ;(e.currentTarget as HTMLElement).style.background = 'var(--ant-color-fill-quaternary)'
          }
        }}
        onMouseLeave={(e) => {
          if (!node.isSelected) {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          }
        }}
      >
        {data.isDir ? (
          <span style={{ flexShrink: 0, width: 14, display: 'flex', alignItems: 'center' }}>
            {isOpen ? (
              <ChevronDown size={12} style={{ color: 'var(--ant-color-text-tertiary)' }} />
            ) : (
              <ChevronRight size={12} style={{ color: 'var(--ant-color-text-tertiary)' }} />
            )}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        {getIcon(data, isOpen)}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0
          }}
          title={data.id}
        >
          {data.name}
        </span>
        {data.prizmType && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--ant-color-text-quaternary)',
              flexShrink: 0,
              marginLeft: 2
            }}
          >
            {data.prizmType === 'document' ? '文档' : data.prizmType === 'todo_list' ? '待办' : ''}
          </span>
        )}
      </div>
    )
  }
)

FileTreeNode.displayName = 'FileTreeNode'
