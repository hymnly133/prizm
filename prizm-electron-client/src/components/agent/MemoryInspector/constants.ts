import type { MemoryPartition } from './types'

export const MEMORY_TYPE_OPTIONS = [
  { value: 'narrative', label: '叙事记忆' },
  { value: 'foresight', label: '前瞻记忆' },
  { value: 'document', label: '文档记忆' },
  { value: 'event_log', label: '事件日志' },
  { value: 'profile', label: '用户画像' }
]

export const PARTITION_LABELS: Record<MemoryPartition, string> = {
  user: 'User 层（用户画像/偏好）',
  scope: 'Scope 层（工作区叙事/计划/文档记忆）',
  session: 'Session 层（本次会话原子事实）'
}

export const MEMORY_TYPE_LABELS: Record<string, string> = {
  narrative: '叙事记忆',
  foresight: '前瞻记忆',
  document: '文档记忆',
  event_log: '事件日志',
  profile: '用户画像'
}

export const MEMORY_TYPE_COLORS: Record<string, string> = {
  narrative: 'blue',
  foresight: 'purple',
  document: 'green',
  event_log: 'cyan',
  profile: 'gold'
}

export const DOC_SUB_TYPE_LABELS: Record<string, string> = {
  overview: '总览',
  fact: '事实',
  migration: '变更'
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  conversation: '对话',
  document: '文档',
  compression: '压缩',
  manual: '手动'
}

const USER_SUBCAT_LABELS: Record<string, string> = {
  profile: '用户画像'
}

export { USER_SUBCAT_LABELS }
