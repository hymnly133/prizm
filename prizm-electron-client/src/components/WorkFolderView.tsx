/**
 * WorkFolderView - 文件夹视图
 * 使用 react-arborist 渲染完整工作区文件树，复用 FileTreeNode 和 FileTreeContextMenu
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Tree } from 'react-arborist'
import { Input, Flexbox, ActionIcon } from '@lobehub/ui'
import { Search, RefreshCw } from 'lucide-react'
import { Modal } from 'antd'
import { useFileTree } from '../hooks/useFileTree'
import type { TreeNode } from '../hooks/useFileTree'
import { FileTreeNode } from './agent/FileTreeNode'
import { FileTreeContextMenu } from './agent/FileTreeContextMenu'
import { usePrizmContext } from '../context/PrizmContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import type { NodeRendererProps } from 'react-arborist'

function useContainerHeight(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(400)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, height]
}

export interface WorkFolderViewProps {
  scope: string
  onSelectFile?: (node: TreeNode) => void
}

export const WorkFolderView = memo<WorkFolderViewProps>(({ scope, onSelectFile }) => {
  const { workspaceTree, loading, refresh } = useFileTree(scope)
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const { chatWith } = useChatWithFile()

  const [searchTerm, setSearchTerm] = useState('')
  const [containerRef, containerHeight] = useContainerHeight()

  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean
    position: { x: number; y: number }
    node: TreeNode | null
  }>({ open: false, position: { x: 0, y: 0 }, node: null })

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    setCtxMenu({
      open: true,
      position: { x: e.clientX, y: e.clientY },
      node
    })
  }, [])

  const handleCloseCtxMenu = useCallback(() => {
    setCtxMenu((prev) => ({ ...prev, open: false }))
  }, [])

  const handleFileClick = useCallback(
    (node: TreeNode) => {
      if (node.isDir) return
      onSelectFile?.(node)
    },
    [onSelectFile]
  )

  const handlePreview = useCallback(
    (node: TreeNode) => {
      if (node.isDir) return
      onSelectFile?.(node)
    },
    [onSelectFile]
  )

  const handleSendToChat = useCallback(
    (node: TreeNode) => {
      if (node.prizmType && node.prizmId) {
        const kind = node.prizmType as import('../hooks/useFileList').FileKind
        chatWith({ files: [{ kind, id: node.prizmId, title: node.name }] })
      } else {
        chatWith({ files: [{ kind: 'document', id: node.id, title: node.name }] })
      }
    },
    [chatWith]
  )

  const handleCopyPath = useCallback((node: TreeNode) => {
    void navigator.clipboard.writeText(node.id)
  }, [])

  const handleDelete = useCallback(
    (node: TreeNode) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除 "${node.name}" 吗？此操作不可撤销。`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!http) return
          try {
            await http.fileDelete(node.id, scope)
            void refresh()
          } catch {
            // silently ignore
          }
        }
      })
    },
    [http, scope, refresh]
  )

  const renderNode = useCallback(
    (props: NodeRendererProps<TreeNode>) => (
      <FileTreeNode {...props} onContextMenu={handleContextMenu} onFileClick={handleFileClick} />
    ),
    [handleContextMenu, handleFileClick]
  )

  return (
    <Flexbox className="work-folder-view" style={{ flex: 1, overflow: 'hidden' }} gap={0}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{ padding: '12px 24px 8px', flexShrink: 0 }}
      >
        <Input
          size="small"
          placeholder="搜索文件..."
          prefix={<Search size={12} style={{ color: 'var(--ant-color-text-tertiary)' }} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          allowClear
          style={{ maxWidth: 300, fontSize: 12 }}
        />
        <ActionIcon
          icon={RefreshCw}
          size="small"
          title="刷新"
          onClick={() => void refresh()}
          loading={loading}
        />
      </Flexbox>

      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: '0 16px' }}
      >
        {workspaceTree.length === 0 && !loading ? (
          <div
            style={{
              padding: '32px 8px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--ant-color-text-quaternary)'
            }}
          >
            {searchTerm ? '无匹配结果' : '工作区为空'}
          </div>
        ) : (
          <Tree<TreeNode>
            data={workspaceTree}
            openByDefault={false}
            width="100%"
            height={containerHeight}
            indent={16}
            rowHeight={32}
            overscanCount={10}
            searchTerm={searchTerm}
            searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
            disableDrag
            disableDrop
          >
            {renderNode}
          </Tree>
        )}
      </div>

      <FileTreeContextMenu
        open={ctxMenu.open}
        position={ctxMenu.position}
        node={ctxMenu.node}
        onClose={handleCloseCtxMenu}
        onPreview={handlePreview}
        onSendToChat={handleSendToChat}
        onCopyPath={handleCopyPath}
        onDelete={handleDelete}
      />
    </Flexbox>
  )
})

WorkFolderView.displayName = 'WorkFolderView'
