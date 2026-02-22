/**
 * 反馈系统 — 内部类型定义
 */

import type { FeedbackRating, FeedbackTargetType } from '@prizm/shared'

/** 反馈条目（与 shared 的 FeedbackEntry 对齐，此处用于存储层） */
export interface FeedbackRecord {
  id: string
  scope: string
  targetType: FeedbackTargetType
  targetId: string
  sessionId?: string
  rating: FeedbackRating
  comment?: string
  clientId?: string
  metadata?: string
  createdAt: number
  updatedAt: number
}

/** 反馈查询过滤器 */
export interface FeedbackQueryFilter {
  scope?: string
  targetType?: FeedbackTargetType
  targetId?: string
  sessionId?: string
  rating?: FeedbackRating
  since?: number
  until?: number
  limit?: number
  offset?: number
}

/** 反馈聚合统计（内部） */
export interface FeedbackStatsRow {
  total: number
  like: number
  neutral: number
  dislike: number
}
