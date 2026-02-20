/**
 * useCollabInteraction — unified cross-panel interaction API for the
 * session-first collaboration page.
 *
 * Provides openDocument / openTask / openWorkflow / jumpToSession helpers
 * that coordinate layout state (right panel) with session store.
 *
 * Distributed via CollabInteractionContext so that deeply nested components
 * (tool cards, panel items) can trigger navigation without prop drilling.
 */
import { createContext, useContext, useCallback, useMemo } from 'react'
import type { RightPanelTab } from '../components/collaboration/collabTypes'

export interface CollabInteractionAPI {
  /** Open a document in the right panel. */
  openDocument(docId: string): void
  /** Open a task in the right panel. */
  openTask(taskId: string): void
  /** Open a workflow run in the right panel. */
  openWorkflow(runId: string): void
  /** Load a session into the main chat area. */
  jumpToSession(sessionId: string): void
  /** Generic open-right-panel helper. */
  openRightPanel(tab: RightPanelTab, entityId?: string): void
  /** Close the right panel. */
  closeRightPanel(): void
}

const noop = () => {}

const defaultAPI: CollabInteractionAPI = {
  openDocument: noop,
  openTask: noop,
  openWorkflow: noop,
  jumpToSession: noop,
  openRightPanel: noop,
  closeRightPanel: noop
}

export const CollabInteractionContext = createContext<CollabInteractionAPI>(defaultAPI)

export function useCollabInteraction(): CollabInteractionAPI {
  return useContext(CollabInteractionContext)
}

/**
 * Build a CollabInteractionAPI value from layout actions and session loader.
 * Intended to be called in CollaborationPage and passed via Context.
 */
export function useCollabInteractionValue(deps: {
  openRightPanel: (tab: RightPanelTab, entityId?: string) => void
  closeRightPanel: () => void
  loadSession: (id: string) => void
}): CollabInteractionAPI {
  const { openRightPanel, closeRightPanel, loadSession } = deps

  const openDocument = useCallback(
    (docId: string) => openRightPanel('document', docId),
    [openRightPanel]
  )

  const openTask = useCallback(
    (taskId: string) => openRightPanel('task', taskId),
    [openRightPanel]
  )

  const openWorkflow = useCallback(
    (runId: string) => openRightPanel('workflow', runId),
    [openRightPanel]
  )

  const jumpToSession = useCallback(
    (sessionId: string) => loadSession(sessionId),
    [loadSession]
  )

  return useMemo(
    () => ({
      openDocument,
      openTask,
      openWorkflow,
      jumpToSession,
      openRightPanel,
      closeRightPanel
    }),
    [openDocument, openTask, openWorkflow, jumpToSession, openRightPanel, closeRightPanel]
  )
}
