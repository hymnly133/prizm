/**
 * useCollabInteraction — unified cross-panel interaction API for the
 * session-first collaboration page.
 *
 * Uses collabTabStore to open entity tabs in the right panel.
 * Distributed via CollabInteractionContext so that deeply nested components
 * (tool cards, panel items) can trigger navigation without prop drilling.
 */
import { createContext, useContext, useCallback, useMemo } from 'react'
import type { ResourceURI } from '@prizm/shared'
import type { CollabTab } from '../components/collaboration/collabTabTypes'
import {
  makeEntityTab,
  RESOURCE_TYPE_TO_TAB,
  TAB_TYPE_LABELS
} from '../components/collaboration/collabTabTypes'

export interface CollabInteractionAPI {
  /** Open a document in the right panel as a tab. */
  openDocument(docId: string, label?: string): void
  /** Open a task in the right panel as a tab. */
  openTask(taskId: string, label?: string): void
  /** Open a workflow run in the right panel as a tab. */
  openWorkflow(runId: string, label?: string): void
  /** Open a workflow definition in the right panel as a tab. */
  openWorkflowDef(defId: string, label?: string): void
  /** Open a bg session in the right panel as a tab. */
  openSession(sessionId: string, label?: string): void
  /** Load a session into the main chat area. */
  jumpToSession(sessionId: string): void
  /** Generic open-tab helper. */
  openTab(sessionId: string | null, tab: CollabTab): void
  /** Open a tab from a resource URI (unified resource reference path). */
  openByResourceRef(uri: ResourceURI, label?: string): void
  /** Close the right panel. */
  closeRightPanel(): void
  /** Open the right panel. */
  openRightPanel(): void
}

const noop = () => {}

const defaultAPI: CollabInteractionAPI = {
  openDocument: noop,
  openTask: noop,
  openWorkflow: noop,
  openWorkflowDef: noop,
  openSession: noop,
  jumpToSession: noop,
  openTab: noop,
  openByResourceRef: noop,
  closeRightPanel: noop,
  openRightPanel: noop
}

export const CollabInteractionContext = createContext<CollabInteractionAPI>(defaultAPI)

export function useCollabInteraction(): CollabInteractionAPI {
  return useContext(CollabInteractionContext)
}

/**
 * Build a CollabInteractionAPI value from tab store actions and session loader.
 * Called in CollaborationPage and passed via Context.
 */
export function useCollabInteractionValue(deps: {
  openTab: (sessionId: string | null, tab: CollabTab) => void
  closeRightPanel: () => void
  openRightPanel: () => void
  loadSession: (id: string) => void
  getCurrentSessionId: () => string | null
}): CollabInteractionAPI {
  const { openTab, closeRightPanel, openRightPanel, loadSession, getCurrentSessionId } =
    deps

  const openDocument = useCallback(
    (docId: string, label?: string) =>
      openTab(getCurrentSessionId(), makeEntityTab('document', docId, label ?? '文档')),
    [openTab, getCurrentSessionId]
  )

  const openTask = useCallback(
    (taskId: string, label?: string) =>
      openTab(getCurrentSessionId(), makeEntityTab('task', taskId, label ?? '任务')),
    [openTab, getCurrentSessionId]
  )

  const openWorkflow = useCallback(
    (runId: string, label?: string) =>
      openTab(getCurrentSessionId(), makeEntityTab('workflow', runId, label ?? '工作流运行')),
    [openTab, getCurrentSessionId]
  )

  const openWorkflowDef = useCallback(
    (defId: string, label?: string) =>
      openTab(getCurrentSessionId(), makeEntityTab('workflow-def', defId, label ?? '工作流定义')),
    [openTab, getCurrentSessionId]
  )

  const openSession = useCallback(
    (sessionId: string, label?: string) =>
      openTab(getCurrentSessionId(), makeEntityTab('session', sessionId, label ?? '会话')),
    [openTab, getCurrentSessionId]
  )

  const jumpToSession = useCallback(
    (sessionId: string) => loadSession(sessionId),
    [loadSession]
  )

  const openByResourceRef = useCallback(
    (uri: ResourceURI, label?: string) => {
      const tabType = RESOURCE_TYPE_TO_TAB[uri.type]
      if (!tabType) return
      const defaultLabel =
        TAB_TYPE_LABELS[tabType] ?? (uri.type as string)
      const tab = makeEntityTab(
        tabType as 'document' | 'task' | 'workflow' | 'workflow-def' | 'run' | 'session' | 'schedule' | 'cron',
        uri.id,
        label ?? defaultLabel
      )
      openTab(getCurrentSessionId(), tab)
      openRightPanel()
    },
    [openTab, getCurrentSessionId, openRightPanel]
  )

  return useMemo(
    () => ({
      openDocument,
      openTask,
      openWorkflow,
      openWorkflowDef,
      openSession,
      jumpToSession,
      openTab,
      openByResourceRef,
      closeRightPanel,
      openRightPanel
    }),
    [
      openDocument,
      openTask,
      openWorkflow,
      openWorkflowDef,
      openSession,
      jumpToSession,
      openTab,
      openByResourceRef,
      closeRightPanel,
      openRightPanel
    ]
  )
}
