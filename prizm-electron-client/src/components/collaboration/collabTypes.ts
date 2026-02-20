/**
 * Collaboration page — shared type definitions.
 *
 * Session-first layout: Session chat is the main area,
 * Document/Task/Workflow live in an expandable right panel.
 */

/** @deprecated kept for migration — use RightPanelTab instead */
export type CollabPanelType = 'hub' | 'agent' | 'workflow' | 'task' | 'document'

/** Tabs available inside the right drawer panel. */
export type RightPanelTab = 'document' | 'task' | 'workflow'

/** Layout state for the session-first collaboration page. */
export interface CollabLayoutState {
  /** Whether the right panel is open. */
  rightPanelOpen: boolean
  /** Which tab is active in the right panel. */
  rightPanelTab: RightPanelTab
  /** Optional entity ID to focus in the right panel (docId / taskId / runId). */
  rightPanelEntityId: string | null
  /** Split percentage between main area and right panel (20–80). */
  splitPct: number
}

/** Describes a cross-panel navigation request. */
export interface CollabInteraction {
  target: RightPanelTab
  entityId?: string
  fromSessionId?: string
}

export const RIGHT_PANEL_TAB_LABELS: Record<RightPanelTab, string> = {
  document: '文档',
  task: '任务',
  workflow: '工作流'
}

/** @deprecated kept for CollabHub drawer */
export const COLLAB_PANEL_LABELS: Record<CollabPanelType, string> = {
  hub: '总览',
  agent: 'Agent',
  workflow: '工作流',
  task: '后台任务',
  document: '文档'
}
