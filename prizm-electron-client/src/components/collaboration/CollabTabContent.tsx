/**
 * CollabTabContent — routes the active tab to the correct single-entity renderer.
 *
 * Uses a component registry to map tab type to the appropriate React component.
 * Entity tabs render on-demand fetched data; list tabs render browse-all views.
 */
import { memo, Suspense, useMemo } from 'react'
import type { CollabTab } from './collabTabTypes'
import { DocumentTabContent } from './tabs/DocumentTabContent'
import { TaskTabContent } from './tabs/TaskTabContent'
import { WorkflowTabContent } from './tabs/WorkflowTabContent'
import { WorkflowDefTabContent } from './tabs/WorkflowDefTabContent'
import { SessionTabContent } from './tabs/SessionTabContent'
import { DocumentListTab, TaskListTab, WorkflowListTab } from './tabs/EntityListTab'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'
import { EmptyState } from '../ui/EmptyState'

export interface TabContentProps {
  entityId?: string
  onClose?: () => void
  /** Open a new tab from within this tab (e.g. list → entity). */
  onOpenEntity?: (
    type: 'document' | 'task' | 'workflow' | 'workflow-def' | 'session',
    entityId: string,
    label: string
  ) => void
  onLoadSession?: (sessionId: string) => void
}

type ContentComponent = React.ComponentType<TabContentProps>

const TAB_CONTENT_MAP: Record<string, ContentComponent> = {
  document: DocumentTabContent,
  task: TaskTabContent,
  workflow: WorkflowTabContent,
  'workflow-def': WorkflowDefTabContent,
  session: SessionTabContent,
  'document-list': DocumentListTab,
  'task-list': TaskListTab,
  'workflow-list': WorkflowListTab
}

export interface CollabTabContentProps {
  activeTab: CollabTab | null
  onClose?: () => void
  onOpenEntity?: (
    type: 'document' | 'task' | 'workflow' | 'workflow-def' | 'session',
    entityId: string,
    label: string
  ) => void
  onLoadSession?: (sessionId: string) => void
}

export const CollabTabContent = memo(function CollabTabContent({
  activeTab,
  onClose,
  onOpenEntity,
  onLoadSession
}: CollabTabContentProps) {
  if (!activeTab) {
    return (
      <div className="collab-tab-content collab-tab-content--empty">
        <EmptyState description="打开标签页以查看内容" />
      </div>
    )
  }

  if (activeTab.type === 'session-detail') {
    return (
      <div className="collab-tab-content collab-tab-content--empty">
        <EmptyState description="会话详情仅在协作页显示" />
      </div>
    )
  }

  const Component = TAB_CONTENT_MAP[activeTab.type]
  if (!Component) {
    return (
      <div className="collab-tab-content collab-tab-content--empty">
        <EmptyState description={`未知的标签页类型: ${activeTab.type}`} />
      </div>
    )
  }

  return (
    <div className="collab-tab-content">
      <Suspense fallback={<LoadingPlaceholder />}>
        <Component
          entityId={activeTab.entityId}
          onClose={onClose}
          onOpenEntity={onOpenEntity}
          onLoadSession={onLoadSession}
        />
      </Suspense>
    </div>
  )
})
