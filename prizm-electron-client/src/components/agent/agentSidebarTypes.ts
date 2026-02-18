/**
 * Shared types and constants for Agent right sidebar (Overview + Session).
 */
import { BookOpen, PlusCircle, Pencil, Trash2, Search, type LucideIcon } from 'lucide-react'
import {
  TOKEN_CATEGORY_LABELS,
  TOKEN_CATEGORY_COLORS,
  TOKEN_CATEGORY_ORDER,
  isMemoryCategory,
  formatTokenCount
} from '@prizm/shared'

export {
  TOKEN_CATEGORY_LABELS,
  TOKEN_CATEGORY_COLORS,
  TOKEN_CATEGORY_ORDER,
  isMemoryCategory,
  formatTokenCount as formatToken
}

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

export const MEMORY_LAYER_DESCRIPTIONS: Record<string, string> = {
  user: '用户画像 / 偏好（跨 Scope 共享）',
  scope: '情景叙事 / 前瞻计划 / 文档记忆（工作区级）',
  session: '事件日志 / 原子事实（会话级，自动清理）'
}

export const ACTION_CONFIG = {
  read: { icon: BookOpen, label: '读取' },
  list: { icon: BookOpen, label: '列出' },
  search: { icon: Search, label: '搜索' },
  create: { icon: PlusCircle, label: '创建' },
  update: { icon: Pencil, label: '更新' },
  delete: { icon: Trash2, label: '删除' }
} as const satisfies Record<string, { icon: LucideIcon; label: string }>
