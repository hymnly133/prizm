/**
 * RightDrawerPanel — expandable right-side panel with Document / Task / Workflow tabs.
 *
 * Lives next to the main Session chat area with a draggable split divider.
 * Receives an entityId to auto-focus a specific document, task or workflow run.
 */
import { memo, useCallback, useEffect, useMemo } from 'react'
import { ActionIcon } from '@lobehub/ui'
import { FileText, GitBranch, X, Zap } from 'lucide-react'
import type { RightPanelTab } from './collabTypes'
import { RIGHT_PANEL_TAB_LABELS } from './collabTypes'
import { Segmented } from '../ui/Segmented'
import { WorkflowPanel } from './WorkflowPanel'
import { TaskPanel } from './TaskPanel'
import DocumentPane from './DocumentPane'
import { useCollabInteraction } from '../../hooks/useCollabInteraction'

const TAB_OPTIONS: Array<{ label: React.ReactNode; value: RightPanelTab }> = [
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <FileText size={12} /> 文档
      </span>
    ),
    value: 'document'
  },
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Zap size={12} /> 任务
      </span>
    ),
    value: 'task'
  },
  {
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <GitBranch size={12} /> 工作流
      </span>
    ),
    value: 'workflow'
  }
]

export interface RightDrawerPanelProps {
  activeTab: RightPanelTab
  entityId: string | null
  onTabChange: (tab: RightPanelTab) => void
  onClose: () => void
  /** Callback when a session should be loaded in the main area. */
  onLoadSession?: (sessionId: string) => void
  /** Active document ID (controlled by parent for Document tab). */
  activeDocId: string | null
  onActiveDocIdChange: (id: string | null) => void
  dirtyRef?: React.MutableRefObject<boolean>
}

export const RightDrawerPanel = memo(function RightDrawerPanel({
  activeTab,
  entityId,
  onTabChange,
  onClose,
  onLoadSession,
  activeDocId,
  onActiveDocIdChange,
  dirtyRef
}: RightDrawerPanelProps) {
  const { jumpToSession } = useCollabInteraction()

  const handleTabChange = useCallback(
    (v: string | number) => onTabChange(v as RightPanelTab),
    [onTabChange]
  )

  const handleLoadSession = useCallback(
    (id: string) => {
      onLoadSession?.(id)
      jumpToSession(id)
    },
    [onLoadSession, jumpToSession]
  )

  useEffect(() => {
    if (!entityId) return
    if (activeTab === 'document' && entityId !== activeDocId) {
      onActiveDocIdChange(entityId)
    }
  }, [entityId, activeTab, activeDocId, onActiveDocIdChange])

  return (
    <div className="collab-right-panel">
      <div className="collab-right-panel__header">
        <Segmented
          size="small"
          value={activeTab}
          onChange={handleTabChange}
          options={TAB_OPTIONS}
        />
        <ActionIcon
          icon={X}
          size="small"
          title="关闭面板"
          onClick={onClose}
        />
      </div>
      <div className="collab-right-panel__body">
        {activeTab === 'document' && (
          <DocumentPane
            sidebarSide="left"
            activeDocId={activeDocId}
            onActiveDocIdChange={onActiveDocIdChange}
            dirtyRef={dirtyRef}
          />
        )}
        {activeTab === 'task' && (
          <TaskPanel onLoadSession={handleLoadSession} />
        )}
        {activeTab === 'workflow' && (
          <WorkflowPanel onLoadSession={handleLoadSession} />
        )}
      </div>
    </div>
  )
})
