/**
 * WorkPageToolbar - 工作页工具栏：类别筛选、Scope、搜索、新建与视图切换
 */
import { memo } from 'react'
import { ActionIcon, Checkbox } from '@lobehub/ui'
import ScopeSidebar from './ui/ScopeSidebar'
import SearchSection from './SearchSection'
import { FileText, FolderTree, Import, LayoutGrid, ListTodo } from 'lucide-react'
import type { FileKind } from '../hooks/useFileList'

export interface WorkPageToolbarProps {
  categoryFilter: Record<FileKind, boolean>
  onCategoryFilterChange: (kind: FileKind, checked: boolean) => void
  scopes: string[]
  getScopeLabel: (scope: string) => string
  scopesLoading: boolean
  currentScope: string
  onScopeSelect: (scope: string) => void
  activeTab: string
  onActiveTabChange: (value: string) => void
  onRefreshScope: () => void
  onSelectFile: (payload: { kind: FileKind; id: string }) => void
  onAddTodo: () => void
  onAddDocument: () => void
  onImport: () => void
  viewMode: 'flat' | 'folder'
  onViewModeChange: (mode: 'flat' | 'folder') => void
}

function WorkPageToolbar({
  categoryFilter,
  onCategoryFilterChange,
  scopes,
  getScopeLabel,
  scopesLoading,
  currentScope,
  onScopeSelect,
  activeTab,
  onActiveTabChange,
  onRefreshScope,
  onSelectFile,
  onAddTodo,
  onAddDocument,
  onImport,
  viewMode,
  onViewModeChange
}: WorkPageToolbarProps) {
  return (
    <div className="work-page__toolbar">
      <div className="work-page__toolbar-left">
        <div className="work-page__category-filter">
          <Checkbox
            checked={categoryFilter.todoList}
            onChange={(checked) => onCategoryFilterChange('todoList', checked)}
          >
            TODO
          </Checkbox>
          <Checkbox
            checked={categoryFilter.document}
            onChange={(checked) => onCategoryFilterChange('document', checked)}
          >
            文件
          </Checkbox>
        </div>
        <ScopeSidebar
          scopes={scopes}
          getScopeLabel={getScopeLabel}
          scopesLoading={scopesLoading}
          currentScope={currentScope}
          onSelect={onScopeSelect}
        />
        <SearchSection
          activeTab={activeTab}
          scope={currentScope}
          onActiveTabChange={onActiveTabChange}
          onRefreshFiles={onRefreshScope}
          onRefreshTasks={onRefreshScope}
          onRefreshClipboard={() => {}}
          onSelectFile={onSelectFile}
        />
      </div>
      <div className="work-page__toolbar-actions">
        <ActionIcon icon={ListTodo} title="新建待办" onClick={onAddTodo} size="large" />
        <ActionIcon icon={FileText} title="新建文档" onClick={onAddDocument} size="large" />
        <ActionIcon icon={Import} title="导入文件" onClick={onImport} size="large" />
        <span className="work-page__toolbar-divider" />
        <ActionIcon
          icon={LayoutGrid}
          title="平铺视图"
          size="large"
          className={viewMode === 'flat' ? 'work-page__view-toggle--active' : ''}
          onClick={() => onViewModeChange('flat')}
        />
        <ActionIcon
          icon={FolderTree}
          title="文件夹视图"
          size="large"
          className={viewMode === 'folder' ? 'work-page__view-toggle--active' : ''}
          onClick={() => onViewModeChange('folder')}
        />
      </div>
    </div>
  )
}

export default memo(WorkPageToolbar)
