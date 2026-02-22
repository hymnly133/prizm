import type {
  FeedbackEntry,
  FeedbackRating,
  FeedbackTargetType,
  FeedbackStats,
  SubmitFeedbackPayload
} from '@prizm/shared'
import { createClientLogger } from '../../logger'
import { PrizmClient } from '../client'

const log = createClientLogger('FeedbackHTTP')

export interface FeedbackQueryParams {
  targetType?: FeedbackTargetType
  targetId?: string
  sessionId?: string
  rating?: FeedbackRating
  since?: number
  until?: number
  limit?: number
  offset?: number
}

declare module '../client' {
  interface PrizmClient {
    submitFeedback(payload: SubmitFeedbackPayload, scope?: string): Promise<FeedbackEntry>
    getFeedback(params?: FeedbackQueryParams, scope?: string): Promise<FeedbackEntry[]>
    getFeedbackStats(params?: { targetType?: string; sessionId?: string }, scope?: string): Promise<FeedbackStats>
    getFeedbackForTarget(targetType: FeedbackTargetType, targetId: string, scope?: string): Promise<FeedbackEntry[]>
    updateFeedback(id: string, updates: { rating?: FeedbackRating; comment?: string }): Promise<FeedbackEntry>
    deleteFeedback(id: string): Promise<void>
  }
}

PrizmClient.prototype.submitFeedback = async function (
  this: PrizmClient,
  payload: SubmitFeedbackPayload,
  scope?: string
): Promise<FeedbackEntry> {
  const s = scope ?? this.defaultScope
  return this.request<FeedbackEntry>('/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope: s
  })
}

PrizmClient.prototype.getFeedback = async function (
  this: PrizmClient,
  params?: FeedbackQueryParams,
  scope?: string
): Promise<FeedbackEntry[]> {
  const qs = new URLSearchParams()
  const s = scope ?? this.defaultScope
  qs.set('scope', s)
  if (params?.targetType) qs.set('targetType', params.targetType)
  if (params?.targetId) qs.set('targetId', params.targetId)
  if (params?.sessionId) qs.set('sessionId', params.sessionId)
  if (params?.rating) qs.set('rating', params.rating)
  if (params?.since != null) qs.set('since', String(params.since))
  if (params?.until != null) qs.set('until', String(params.until))
  if (params?.limit != null) qs.set('limit', String(params.limit))
  if (params?.offset != null) qs.set('offset', String(params.offset))

  try {
    return await this.request<FeedbackEntry[]>(`/feedback?${qs.toString()}`)
  } catch (e) {
    log.error('getFeedback failed:', e)
    return []
  }
}

PrizmClient.prototype.getFeedbackStats = async function (
  this: PrizmClient,
  params?: { targetType?: string; sessionId?: string },
  scope?: string
): Promise<FeedbackStats> {
  const qs = new URLSearchParams()
  const s = scope ?? this.defaultScope
  qs.set('scope', s)
  if (params?.targetType) qs.set('targetType', params.targetType)
  if (params?.sessionId) qs.set('sessionId', params.sessionId)

  try {
    return await this.request<FeedbackStats>(`/feedback/stats?${qs.toString()}`)
  } catch (e) {
    log.error('getFeedbackStats failed:', e)
    return { total: 0, like: 0, neutral: 0, dislike: 0 }
  }
}

PrizmClient.prototype.getFeedbackForTarget = async function (
  this: PrizmClient,
  targetType: FeedbackTargetType,
  targetId: string,
  scope?: string
): Promise<FeedbackEntry[]> {
  const qs = new URLSearchParams()
  const s = scope ?? this.defaultScope
  qs.set('scope', s)

  try {
    return await this.request<FeedbackEntry[]>(
      `/feedback/target/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}?${qs.toString()}`
    )
  } catch (e) {
    log.error('getFeedbackForTarget failed:', e)
    return []
  }
}

PrizmClient.prototype.updateFeedback = async function (
  this: PrizmClient,
  id: string,
  updates: { rating?: FeedbackRating; comment?: string }
): Promise<FeedbackEntry> {
  return this.request<FeedbackEntry>(`/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  })
}

PrizmClient.prototype.deleteFeedback = async function (
  this: PrizmClient,
  id: string
): Promise<void> {
  await this.request<{ ok: boolean }>(`/feedback/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}
