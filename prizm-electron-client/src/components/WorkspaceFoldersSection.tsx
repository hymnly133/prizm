/**
 * WorkspaceFoldersSection - 平铺视图底部的工作区文件夹列表
 * 显示顶层非系统文件夹，点击可切换到文件夹视图
 */
import { memo, useState, useMemo } from 'react'
import { Folder, ChevronDown, ChevronRight } from 'lucide-react'
import { useFileTree } from '../hooks/useFileTree'
import type { TreeNode } from '../hooks/useFileTree'

export interface WorkspaceFoldersSectionProps {
  scope: string
  onNavigateToFolder?: (folder: TreeNode) => void
}

export const WorkspaceFoldersSection = memo<WorkspaceFoldersSectionProps>(
  ({ scope, onNavigateToFolder }) => {
    const { workspaceTree } = useFileTree(scope)
    const [expanded, setExpanded] = useState(false)

    const topLevelFolders = useMemo(() => {
      return workspaceTree.filter((node) => node.isDir)
    }, [workspaceTree])

    const topLevelFiles = useMemo(() => {
      return workspaceTree.filter((node) => !node.isDir && !node.prizmType)
    }, [workspaceTree])

    const totalItems = topLevelFolders.length + topLevelFiles.length
    if (totalItems === 0) return null

    return (
      <div className="workspace-folders-section">
        <div
          className="workspace-folders-section__header"
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded((prev) => !prev)
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="workspace-folders-section__title">工作区文件夹</span>
          <span className="workspace-folders-section__count">{totalItems}</span>
        </div>

        {expanded && (
          <div className="workspace-folders-section__list">
            {topLevelFolders.map((folder) => (
              <div
                key={folder.id}
                className="workspace-folders-section__item"
                role="button"
                tabIndex={0}
                onClick={() => onNavigateToFolder?.(folder)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onNavigateToFolder?.(folder)
                }}
              >
                <Folder size={14} style={{ color: 'var(--ant-color-warning)', flexShrink: 0 }} />
                <span className="workspace-folders-section__item-name">{folder.name}</span>
                {folder.children && folder.children.length > 0 && (
                  <span className="workspace-folders-section__item-count">
                    {folder.children.length} 项
                  </span>
                )}
              </div>
            ))}
            {topLevelFiles.map((file) => (
              <div
                key={file.id}
                className="workspace-folders-section__item workspace-folders-section__item--file"
              >
                <span className="workspace-folders-section__item-name">{file.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
)

WorkspaceFoldersSection.displayName = 'WorkspaceFoldersSection'
