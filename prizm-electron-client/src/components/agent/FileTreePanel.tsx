/**
 * FileTreePanel - 文件结构面板
 * 包含搜索框 + 主工作区文件树 + 临时工作区文件树（可折叠）
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Tree } from 'react-arborist'
import { Input } from '@lobehub/ui'
import { Flexbox } from '@lobehub/ui'
import { Search, ChevronDown, ChevronRight, RefreshCw, FolderTree, Clock } from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import { Modal } from 'antd'
import { useFileTree } from '../../hooks/useFileTree'
import type { TreeNode } from '../../hooks/useFileTree'
import { FileTreeNode } from './FileTreeNode'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import { usePrizmContext } from '../../context/PrizmContext'
import { useChatWithFile } from '../../context/ChatWithFileContext'
import type { NodeRendererProps } from 'react-arborist'

export interface FileTreePanelProps {
  scope: string
  sessionId?: string
  onPreviewFile?: (relativePath: string) => void
}

/** Hook to track the height of an element via ResizeObserver */
function useContainerHeight(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(300)

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

export const FileTreePanel = memo<FileTreePanelProps>(({ scope, sessionId, onPreviewFile }) => {
  const { workspaceTree, sessionTree, loading, refresh } = useFileTree(scope, sessionId)
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const { chatWith } = useChatWithFile()

  const [searchTerm, setSearchTerm] = useState('')
  const [sessionExpanded, setSessionExpanded] = useState(true)

  const [wsContainerRef, wsHeight] = useContainerHeight()
  const [sessionContainerRef, sessionHeight] = useContainerHeight()

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean
    position: { x: number; y: number }
    node: TreeNode | null
    isSession: boolean
  }>({ open: false, position: { x: 0, y: 0 }, node: null, isSession: false })

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    setCtxMenu({
      open: true,
      position: { x: e.clientX, y: e.clientY },
      node,
      isSession: false
    })
  }, [])

  const handleSessionContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    setCtxMenu({
      open: true,
      position: { x: e.clientX, y: e.clientY },
      node,
      isSession: true
    })
  }, [])

  const handleCloseCtxMenu = useCallback(() => {
    setCtxMenu((prev) => ({ ...prev, open: false }))
  }, [])

  const handlePreview = useCallback(
    (node: TreeNode) => {
      if (node.isDir) return
      onPreviewFile?.(node.id)
    },
    [onPreviewFile]
  )

  const handleFileClick = useCallback(
    (node: TreeNode) => {
      if (node.isDir) return
      onPreviewFile?.(node.id)
    },
    [onPreviewFile]
  )

  const handleSendToChat = useCallback(
    (node: TreeNode) => {
      if (node.prizmType && node.prizmId) {
        const kind = node.prizmType as import('../../hooks/useFileList').FileKind
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

  // Render prop for workspace tree
  const renderWorkspaceNode = useCallback(
    (props: NodeRendererProps<TreeNode>) => (
      <FileTreeNode {...props} onContextMenu={handleContextMenu} onFileClick={handleFileClick} />
    ),
    [handleContextMenu, handleFileClick]
  )

  // Render prop for session tree
  const renderSessionNode = useCallback(
    (props: NodeRendererProps<TreeNode>) => (
      <FileTreeNode
        {...props}
        onContextMenu={handleSessionContextMenu}
        onFileClick={handleFileClick}
      />
    ),
    [handleSessionContextMenu, handleFileClick]
  )

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }} gap={0}>
      {/* Search bar + refresh */}
      <Flexbox horizontal align="center" gap={4} style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <Input
          size="small"
          placeholder="搜索文件..."
          prefix={<Search size={12} style={{ color: 'var(--ant-color-text-tertiary)' }} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          allowClear
          style={{ flex: 1, fontSize: 12 }}
        />
        <ActionIcon
          icon={RefreshCw}
          size="small"
          title="刷新"
          onClick={() => void refresh()}
          loading={loading}
        />
      </Flexbox>

      {/* Main workspace tree */}
      <Flexbox style={{ flex: 1, overflow: 'hidden' }} gap={0}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ant-color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            flexShrink: 0
          }}
        >
          <FolderTree size={12} />
          <span>工作区</span>
        </div>
        <div ref={wsContainerRef} style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {workspaceTree.length === 0 && !loading ? (
            <div
              style={{
                padding: '16px 8px',
                textAlign: 'center',
                fontSize: 12,
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
              height={wsHeight}
              indent={16}
              rowHeight={28}
              overscanCount={5}
              searchTerm={searchTerm}
              searchMatch={(node, term) =>
                node.data.name.toLowerCase().includes(term.toLowerCase())
              }
              disableDrag
              disableDrop
            >
              {renderWorkspaceNode}
            </Tree>
          )}
        </div>
      </Flexbox>

      {/* Session workspace tree (collapsible) */}
      {sessionId && (
        <Flexbox style={{ flexShrink: 0, maxHeight: '40%', overflow: 'hidden' }} gap={0}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSessionExpanded((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSessionExpanded((prev) => !prev)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ant-color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              cursor: 'pointer',
              borderTop: '1px solid var(--ant-color-border)',
              flexShrink: 0,
              userSelect: 'none'
            }}
          >
            {sessionExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Clock size={12} />
            <span>临时工作区</span>
          </div>
          {sessionExpanded && (
            <div ref={sessionContainerRef} style={{ flex: 1, overflow: 'hidden', minHeight: 80 }}>
              {sessionTree.length === 0 ? (
                <div
                  style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--ant-color-text-quaternary)'
                  }}
                >
                  暂无临时文件
                </div>
              ) : (
                <Tree<TreeNode>
                  data={sessionTree}
                  openByDefault={false}
                  width="100%"
                  height={sessionHeight}
                  indent={16}
                  rowHeight={28}
                  overscanCount={5}
                  searchTerm={searchTerm}
                  searchMatch={(node, term) =>
                    node.data.name.toLowerCase().includes(term.toLowerCase())
                  }
                  disableDrag
                  disableDrop
                >
                  {renderSessionNode}
                </Tree>
              )}
            </div>
          )}
        </Flexbox>
      )}

      {/* Context menu */}
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

FileTreePanel.displayName = 'FileTreePanel'
