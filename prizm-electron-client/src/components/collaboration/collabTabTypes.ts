/**
 * Collaboration tab model — type definitions.
 *
 * Each tab represents a single data item (document, task, workflow run, session,
 * schedule, cron) or a browse-all list view. Tabs are scoped per-session so each
 * conversation maintains its own set of open tabs.
 *
 * Entity tab types are aligned with ResourceType from @prizm/shared.
 */

import type { ResourceType } from '@prizm/shared'

export type CollabTabType =
  | 'document'
  | 'task'
  | 'workflow'
  | 'workflow-def'
  | 'run'
  | 'session'
  | 'schedule'
  | 'cron'
  | 'document-list'
  | 'task-list'
  | 'workflow-list'
  | 'schedule-list'
  | 'cron-list'

export const ENTITY_TAB_TYPES = new Set<CollabTabType>([
  'document',
  'task',
  'workflow',
  'workflow-def',
  'run',
  'session',
  'schedule',
  'cron'
])

export const LIST_TAB_TYPES = new Set<CollabTabType>([
  'document-list',
  'task-list',
  'workflow-list',
  'schedule-list',
  'cron-list'
])

export interface CollabTab {
  /** Unique tab ID — convention: `${type}:${entityId}` or `${type}-list` */
  id: string
  type: CollabTabType
  /** Entity ID for single-item tabs; absent for list tabs. */
  entityId?: string
  label: string
  /** Lucide icon name hint (resolved by the tab bar). */
  icon?: string
  /** Whether the tab can be closed. Default true. */
  closeable?: boolean
  /** Unsaved-changes indicator. */
  dirty?: boolean
}

/** Build a deterministic tab ID from type + optional entityId. */
export function makeTabId(type: CollabTabType, entityId?: string): string {
  return entityId ? `${type}:${entityId}` : `${type}-list`
}

/** All entity tab types that can be opened for a single item. */
type EntityTabType = 'document' | 'task' | 'workflow' | 'workflow-def' | 'run' | 'session' | 'schedule' | 'cron'

/** Create a CollabTab for a single entity. */
export function makeEntityTab(
  type: EntityTabType,
  entityId: string,
  label: string
): CollabTab {
  return {
    id: makeTabId(type, entityId),
    type,
    entityId,
    label,
    closeable: true
  }
}

/** All list tab types. */
type ListTabType = 'document-list' | 'task-list' | 'workflow-list' | 'schedule-list' | 'cron-list'

/** Create a CollabTab for a list (browse-all) view. */
export function makeListTab(type: ListTabType): CollabTab {
  return {
    id: makeTabId(type),
    type,
    label: LIST_TAB_LABELS[type],
    closeable: true
  }
}

export const TAB_TYPE_ICONS: Record<CollabTabType, string> = {
  document: 'FileText',
  task: 'Zap',
  workflow: 'GitBranch',
  'workflow-def': 'Blocks',
  run: 'GitBranch',
  session: 'MessageSquare',
  schedule: 'Calendar',
  cron: 'Clock',
  'document-list': 'FileText',
  'task-list': 'Zap',
  'workflow-list': 'GitBranch',
  'schedule-list': 'Calendar',
  'cron-list': 'Clock'
}

export const LIST_TAB_LABELS: Record<string, string> = {
  'document-list': '文档列表',
  'task-list': '任务列表',
  'workflow-list': '工作流列表',
  'schedule-list': '日程列表',
  'cron-list': '定时任务列表'
}

export const TAB_TYPE_LABELS: Record<CollabTabType, string> = {
  document: '文档',
  task: '任务',
  workflow: '工作流运行',
  'workflow-def': '工作流定义',
  run: '运行',
  session: '会话',
  schedule: '日程',
  cron: '定时任务',
  'document-list': '文档列表',
  'task-list': '任务列表',
  'workflow-list': '工作流列表',
  'schedule-list': '日程列表',
  'cron-list': '定时任务列表'
}

/** Map ResourceType → CollabTabType for entity tabs */
export const RESOURCE_TYPE_TO_TAB: Partial<Record<ResourceType, CollabTabType>> = {
  doc: 'document',
  todo: 'task',
  workflow: 'workflow-def',
  run: 'run',
  task: 'task',
  session: 'session',
  schedule: 'schedule',
  cron: 'cron'
}

/** Map CollabTabType → ResourceType for reverse lookup */
export const TAB_TO_RESOURCE_TYPE: Partial<Record<CollabTabType, ResourceType>> = {
  document: 'doc',
  task: 'task',
  'workflow-def': 'workflow',
  run: 'run',
  workflow: 'run',
  session: 'session',
  schedule: 'schedule',
  cron: 'cron'
}
