/**
 * Shared types and constants for Agent right sidebar (Overview + Session).
 */
import { BookOpen, PlusCircle, Pencil, Trash2, Search, type LucideIcon } from 'lucide-react'

/** 会话级统计（与 @prizm/client-core SessionStats 对齐） */
export interface SessionStats {
  sessionId: string
  scope: string
  tokenUsage: {
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    rounds: number
    byModel: Record<string, { input: number; output: number; total: number; count: number }>
    byCategory?: Record<string, { input: number; output: number; total: number; count: number }>
  }
  memoryCreated: {
    totalCount: number
    ids: { user: string[]; scope: string[]; session: string[] }
  }
  memoryInjectedTotal: number
}

/** 统一活动记录（与 API 返回一致） */
export interface ActivityItem {
  toolName: string
  action: string
  itemKind?: string
  itemId?: string
  title?: string
  timestamp: number
}

export const TOKEN_CATEGORY_LABELS: Record<string, string> = {
  chat: '对话',
  conversation_summary: '对话摘要',
  'memory:conversation_extract': '记忆提取（对话）',
  'memory:document_extract': '记忆提取（文档）',
  'memory:document_migration': '文档迁移记忆',
  'memory:dedup': '记忆去重',
  'memory:profile_merge': '画像合并',
  'memory:query_expansion': '查询扩展',
  document_summary: '文档摘要'
}

export const TOKEN_CATEGORY_ORDER = [
  'chat',
  'conversation_summary',
  'memory:conversation_extract',
  'memory:document_extract',
  'memory:document_migration',
  'memory:dedup',
  'memory:profile_merge',
  'memory:query_expansion',
  'document_summary'
] as const

export const MEMORY_LAYER_DESCRIPTIONS: Record<string, string> = {
  user: '用户画像 / 偏好（跨 Scope 共享）',
  scope: '情景叙事 / 前瞻计划 / 文档记忆（工作区级）'
}

export const ACTION_CONFIG = {
  read: { icon: BookOpen, label: '读取' },
  list: { icon: BookOpen, label: '列出' },
  search: { icon: Search, label: '搜索' },
  create: { icon: PlusCircle, label: '创建' },
  update: { icon: Pencil, label: '更新' },
  delete: { icon: Trash2, label: '删除' }
} as const satisfies Record<string, { icon: LucideIcon; label: string }>

export function formatToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
