/**
 * UnifiedRightPanel — generic right-side panel with per-context tabs.
 *
 * Used by both CollaborationPage (contextId = sessionId) and WorkflowPage (contextId = tabContextId).
 * Tab state from collabTabStore; optional renderSessionTabContent for workflow page session tabs.
 */
import { memo, useCallback, useMemo, useEffect } from 'react'
import type { EnrichedSession } from '@prizm/client-core'
import type { CollabTab, CollabTabType } from './collabTabTypes'
import { makeEntityTab, makeListTab, LIST_TAB_TYPES } from './collabTabTypes'
import { CollabTabBar } from './CollabTabBar'
import { CollabTabContent } from './CollabTabContent'
import { useCollabTabStore, EMPTY_TABS } from '../../store/collabTabStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'

export interface UnifiedRightPanelProps {
  /** Tab context id (session id or e.g. wfp:def:xx). */
  contextId: string | null
  onClose: () => void
  onLoadSession?: (sessionId: string) => void
  /** Current scope (for session tab content when used on workflow page). */
  scope?: string | null
  /** When active tab is session, render this instead of CollabTabContent (e.g. WorkflowChatZone). */
  renderSessionTabContent?: (
    sessionId: string,
    scope: string,
    session: EnrichedSession | null
  ) => React.ReactNode
  /** When active tab is session-detail, render current session detail panel (e.g. AgentDetailSidebar). */
  renderSessionDetailContent?: () => React.ReactNode
  /** Extra class name (e.g. wfp-right-panel). */
  className?: string
}

export const UnifiedRightPanel = memo(function UnifiedRightPanel({
  contextId,
  onClose,
  onLoadSession,
  scope,
  renderSessionTabContent,
  renderSessionDetailContent,
  className
}: UnifiedRightPanelProps) {
  const tabs = useCollabTabStore((s) =>
    contextId ? (s.tabsBySession[contextId] ?? EMPTY_TABS) : s.globalTabs
  )
  const activeTabId = useCollabTabStore((s) =>
    contextId ? (s.activeTabBySession[contextId] ?? null) : s.globalActiveTab
  )
  const ensureLoaded = useCollabTabStore((s) => s.ensureLoaded)
  const openTab = useCollabTabStore((s) => s.openTab)
  const closeTab = useCollabTabStore((s) => s.closeTab)
  const activateTab = useCollabTabStore((s) => s.activateTab)
  const reorderTabs = useCollabTabStore((s) => s.reorderTabs)

  useEffect(() => {
    if (contextId) ensureLoaded(contextId)
  }, [contextId, ensureLoaded])

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  )

  const handleActivate = useCallback(
    (tabId: string) => activateTab(contextId, tabId),
    [activateTab, contextId]
  )

  const handleClose = useCallback(
    (tabId: string) => closeTab(contextId, tabId),
    [closeTab, contextId]
  )

  const handleReorder = useCallback(
    (reordered: CollabTab[]) => reorderTabs(contextId, reordered),
    [reorderTabs, contextId]
  )

  const handleAddListTab = useCallback(
    (type: CollabTabType) => {
      if (LIST_TAB_TYPES.has(type)) {
        openTab(
          contextId,
          makeListTab(
            type as
              | 'document-list'
              | 'task-list'
              | 'workflow-list'
              | 'schedule-list'
              | 'cron-list'
          )
        )
      }
    },
    [openTab, contextId]
  )

  const handleOpenEntity = useCallback(
    (
      type: 'document' | 'task' | 'workflow' | 'workflow-def' | 'session',
      entityId: string,
      label: string
    ) => {
      openTab(contextId, makeEntityTab(type, entityId, label))
    },
    [openTab, contextId]
  )

  const handleCloseActiveTab = useCallback(() => {
    if (activeTabId) closeTab(contextId, activeTabId)
  }, [closeTab, contextId, activeTabId])

  const handleLoadSession = useCallback(
    (id: string) => onLoadSession?.(id),
    [onLoadSession]
  )

  const isSessionTab = activeTab?.type === 'session' && activeTab?.entityId
  const sessionForTab = useAgentSessionStore((s) =>
    activeTab?.entityId
      ? s.sessions.find((x) => x.id === activeTab.entityId) ?? null
      : null
  )
  const showSessionSlot =
    isSessionTab && scope && typeof renderSessionTabContent === 'function'
  const showSessionDetailSlot =
    activeTab?.type === 'session-detail' &&
    typeof renderSessionDetailContent === 'function'

  return (
    <div
      className={
        className ? `collab-right-panel ${className}`.trim() : 'collab-right-panel'
      }
    >
      <CollabTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={handleActivate}
        onClose={handleClose}
        onReorder={handleReorder}
        onAddTab={handleAddListTab}
        onClosePanel={onClose}
      />
      <div className="collab-right-panel__body">
        {showSessionSlot && activeTab?.entityId ? (
          <div
            className="unified-right-panel__session-slot"
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            {renderSessionTabContent!(
              activeTab.entityId,
              scope!,
              sessionForTab
            )}
          </div>
        ) : showSessionDetailSlot ? (
          <div
            className="unified-right-panel__session-detail-slot"
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            {renderSessionDetailContent!()}
          </div>
        ) : (
          <CollabTabContent
            activeTab={activeTab}
            onClose={handleCloseActiveTab}
            onOpenEntity={handleOpenEntity}
            onLoadSession={handleLoadSession}
          />
        )}
      </div>
    </div>
  )
})
