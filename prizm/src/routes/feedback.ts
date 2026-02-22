/**
 * 反馈路由 — 用户对创造性输出的评价收集
 */

import type { Router, Request, Response } from 'express'
import { createLogger } from '../logger'
import { feedbackManager } from '../core/feedback'
import { emit } from '../core/eventBus'
import { getScopeFromQuery, hasScopeAccess } from '../scopeUtils'
import type { FeedbackTargetType, FeedbackRating } from '@prizm/shared'

const log = createLogger('FeedbackRoutes')

function toStr(val: unknown): string | undefined {
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val[0] as string | undefined
  return undefined
}

const DEFAULT_SCOPE = 'default'
const VALID_RATINGS: FeedbackRating[] = ['like', 'neutral', 'dislike']
const VALID_TARGET_TYPES: FeedbackTargetType[] = [
  'chat_message',
  'document',
  'workflow_run',
  'workflow_step',
  'task_run'
]

function resolveScope(req: Request): string {
  const scope = getScopeFromQuery(req) ?? DEFAULT_SCOPE
  return hasScopeAccess(req, scope) ? scope : DEFAULT_SCOPE
}

export function createFeedbackRoutes(router: Router): void {
  // POST /feedback — 提交反馈（upsert）
  router.post('/feedback', (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req)
      const { targetType, targetId, sessionId, rating, comment, metadata } = req.body

      if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
        return res.status(400).json({ error: `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}` })
      }
      if (!targetId || typeof targetId !== 'string') {
        return res.status(400).json({ error: 'targetId is required' })
      }
      if (!rating || !VALID_RATINGS.includes(rating)) {
        return res.status(400).json({ error: `rating must be one of: ${VALID_RATINGS.join(', ')}` })
      }
      if (comment !== undefined && typeof comment !== 'string') {
        return res.status(400).json({ error: 'comment must be a string' })
      }
      if (comment && comment.length > 2000) {
        return res.status(400).json({ error: 'comment must not exceed 2000 characters' })
      }

      const clientId = req.prizmClient?.clientId
      const entry = feedbackManager.submit(scope, clientId, {
        targetType,
        targetId,
        sessionId,
        rating,
        comment: comment?.trim() || undefined,
        metadata
      })

      emit('feedback:submitted', {
        scope,
        feedbackId: entry.id,
        targetType,
        targetId,
        rating,
        comment: entry.comment,
        sessionId,
        actor: {
          type: 'user',
          clientId
        }
      })

      res.json(entry)
    } catch (err) {
      log.error('POST /feedback failed:', err)
      res.status(500).json({ error: 'Failed to submit feedback' })
    }
  })

  // GET /feedback — 查询反馈列表
  router.get('/feedback', (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req)
      const targetType = toStr(req.query.targetType)
      const targetId = toStr(req.query.targetId)
      const sessionId = toStr(req.query.sessionId)
      const rating = toStr(req.query.rating)
      const since = toStr(req.query.since)
      const until = toStr(req.query.until)
      const limit = toStr(req.query.limit)
      const offset = toStr(req.query.offset)

      const entries = feedbackManager.query({
        scope,
        targetType: targetType as FeedbackTargetType | undefined,
        targetId,
        sessionId,
        rating: rating as FeedbackRating | undefined,
        since: since ? Number(since) : undefined,
        until: until ? Number(until) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined
      })

      res.json(entries)
    } catch (err) {
      log.error('GET /feedback failed:', err)
      res.status(500).json({ error: 'Failed to query feedback' })
    }
  })

  // GET /feedback/stats — 聚合统计
  router.get('/feedback/stats', (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req)
      const targetType = toStr(req.query.targetType)
      const sessionId = toStr(req.query.sessionId)

      const stats = feedbackManager.getStats({
        scope,
        targetType,
        sessionId
      })

      res.json(stats)
    } catch (err) {
      log.error('GET /feedback/stats failed:', err)
      res.status(500).json({ error: 'Failed to get feedback stats' })
    }
  })

  // GET /feedback/target/:targetType/:targetId — 获取某目标的反馈
  router.get('/feedback/target/:targetType/:targetId', (req: Request, res: Response) => {
    try {
      const scope = resolveScope(req)
      const targetType = String(req.params.targetType)
      const targetId = String(req.params.targetId)

      if (!VALID_TARGET_TYPES.includes(targetType as FeedbackTargetType)) {
        return res.status(400).json({ error: `Invalid targetType: ${targetType}` })
      }

      const entries = feedbackManager.getForTarget(
        scope,
        targetType as FeedbackTargetType,
        targetId
      )

      res.json(entries)
    } catch (err) {
      log.error('GET /feedback/target failed:', err)
      res.status(500).json({ error: 'Failed to get feedback for target' })
    }
  })

  // PATCH /feedback/:id — 更新反馈
  router.patch('/feedback/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id)
      const { rating, comment } = req.body

      if (rating !== undefined && !VALID_RATINGS.includes(rating)) {
        return res.status(400).json({ error: `rating must be one of: ${VALID_RATINGS.join(', ')}` })
      }
      if (comment !== undefined && typeof comment !== 'string') {
        return res.status(400).json({ error: 'comment must be a string' })
      }

      if (!feedbackManager.getById(id)) {
        return res.status(404).json({ error: 'Feedback not found' })
      }

      const updated = feedbackManager.update(id, {
        rating,
        comment: comment?.trim()
      })

      if (!updated) {
        return res.status(404).json({ error: 'Failed to update feedback' })
      }

      const entry = feedbackManager.getById(id)
      res.json(entry)
    } catch (err) {
      log.error('PATCH /feedback/:id failed:', err)
      res.status(500).json({ error: 'Failed to update feedback' })
    }
  })

  // DELETE /feedback/:id — 删除反馈
  router.delete('/feedback/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id)
      const deleted = feedbackManager.remove(id)
      if (!deleted) {
        return res.status(404).json({ error: 'Feedback not found' })
      }
      res.json({ ok: true })
    } catch (err) {
      log.error('DELETE /feedback/:id failed:', err)
      res.status(500).json({ error: 'Failed to delete feedback' })
    }
  })

  log.info('Feedback routes registered')
}
