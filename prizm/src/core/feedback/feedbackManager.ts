/**
 * 反馈系统管理器 — 核心逻辑
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '../../logger'
import * as feedbackStore from './feedbackStore'
import type { FeedbackQueryFilter } from './types'
import type { FeedbackEntry, FeedbackRating, FeedbackTargetType, FeedbackStats, SubmitFeedbackPayload } from '@prizm/shared'

const log = createLogger('FeedbackManager')

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
let _pruneTimer: ReturnType<typeof setInterval> | null = null

export function init(): void {
  feedbackStore.initFeedbackStore()
  pruneOldEntries()
  if (!_pruneTimer) {
    _pruneTimer = setInterval(pruneOldEntries, PRUNE_INTERVAL_MS)
    if (_pruneTimer.unref) _pruneTimer.unref()
  }
}

export function shutdown(): void {
  if (_pruneTimer) {
    clearInterval(_pruneTimer)
    _pruneTimer = null
  }
  feedbackStore.closeFeedbackStore()
}

/** 提交反馈（upsert：同一 scope+target+client 只保留一条） */
export function submit(
  scope: string,
  clientId: string | undefined,
  payload: SubmitFeedbackPayload
): FeedbackEntry {
  const now = Date.now()
  const id = randomUUID()
  feedbackStore.upsertFeedback({
    id,
    scope,
    targetType: payload.targetType,
    targetId: payload.targetId,
    sessionId: payload.sessionId,
    rating: payload.rating,
    comment: payload.comment,
    clientId: clientId ?? 'anonymous',
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : undefined,
    createdAt: now,
    updatedAt: now
  })

  const existing = feedbackStore.getFeedbackForTarget(scope, payload.targetType, payload.targetId)
  const entry = existing.find((e) => e.clientId === (clientId ?? 'anonymous'))
  return entry ?? {
    id,
    scope,
    targetType: payload.targetType,
    targetId: payload.targetId,
    sessionId: payload.sessionId,
    rating: payload.rating,
    comment: payload.comment,
    clientId: clientId ?? 'anonymous',
    metadata: payload.metadata,
    createdAt: now,
    updatedAt: now
  }
}

export function getById(id: string): FeedbackEntry | undefined {
  return feedbackStore.getFeedbackById(id)
}

export function getForTarget(
  scope: string,
  targetType: FeedbackTargetType,
  targetId: string
): FeedbackEntry[] {
  return feedbackStore.getFeedbackForTarget(scope, targetType, targetId)
}

export function query(filter?: FeedbackQueryFilter): FeedbackEntry[] {
  return feedbackStore.queryFeedback(filter)
}

export function getStats(filter?: {
  scope?: string
  targetType?: string
  sessionId?: string
}): FeedbackStats {
  return feedbackStore.getStats(filter)
}

export function update(
  id: string,
  updates: { rating?: FeedbackRating; comment?: string }
): boolean {
  return feedbackStore.updateFeedback(id, updates)
}

export function remove(id: string): boolean {
  return feedbackStore.deleteFeedback(id)
}

function pruneOldEntries(retentionDays = 365): void {
  try {
    const count = feedbackStore.pruneOldFeedback(retentionDays)
    if (count > 0) {
      log.info('Pruned %d feedback entries older than %d days', count, retentionDays)
    }
  } catch (err) {
    log.warn('Failed to prune feedback entries:', err)
  }
}
