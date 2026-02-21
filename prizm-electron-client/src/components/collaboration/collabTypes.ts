/**
 * Collaboration page — shared type definitions.
 *
 * Session-first layout: Session chat is the main area,
 * Document/Task/Workflow live in an expandable right panel.
 */

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
