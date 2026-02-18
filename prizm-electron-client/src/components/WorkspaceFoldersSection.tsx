/**
 * WorkspaceFoldersSection - 平铺视图底部的工作区文件夹列表
 * 使用 LobeUI List 统一列表风格
 */
import { memo, useState, useMemo } from 'react'
import { Folder, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { ListItemProps } from '@lobehub/ui'
import { AccentList } from './ui/AccentList'
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

    const listItems: ListItemProps[] = useMemo(() => {
      const folderItems: ListItemProps[] = topLevelFolders.map((folder) => ({
        key: folder.id,
        avatar: <Folder size={14} style={{ color: 'var(--ant-color-warning)' }} />,
        title: folder.name,
        addon:
          folder.children && folder.children.length > 0 ? (
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>
              {folder.children.length} 项
            </span>
          ) : undefined,
        onClick: () => onNavigateToFolder?.(folder)
      }))
      const fileItems: ListItemProps[] = topLevelFiles.map((file) => ({
        key: file.id,
        avatar: <FileText size={14} />,
        title: file.name
      }))
      return [...folderItems, ...fileItems]
    }, [topLevelFolders, topLevelFiles, onNavigateToFolder])

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

        {expanded && <AccentList items={listItems} />}
      </div>
    )
  }
)

WorkspaceFoldersSection.displayName = 'WorkspaceFoldersSection'
