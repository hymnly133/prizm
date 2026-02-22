/**
 * 反馈事件处理器
 *
 * - feedback:submitted → 审计记录
 * - feedback:submitted → 偏好记忆提取（like/dislike 时写入 profile 记忆）
 * - WebSocket 广播由 wsBridgeHandlers 统一处理
 */

import { subscribe } from '../eventBus'
import { auditManager } from '../../agentAuditLog'
import {
  isMemoryEnabled,
  addMemoryInteraction
} from '../../../llm/EverMemService'
import { createLogger } from '../../../logger'

const log = createLogger('FeedbackHandler')

const TARGET_TYPE_LABELS: Record<string, string> = {
  chat_message: '对话回复',
  document: '知识库文档',
  workflow_run: '工作流运行',
  workflow_step: '工作流步骤',
  task_run: '后台任务'
}

const RATING_LABELS: Record<string, string> = {
  like: '喜欢',
  neutral: '一般',
  dislike: '不喜欢'
}

export function registerFeedbackHandlers(): void {
  subscribe(
    'feedback:submitted',
    (data) => {
      try {
        auditManager.record(
          data.scope,
          {
            actorType: data.actor?.type ?? 'user',
            sessionId: data.actor?.sessionId,
            clientId: data.actor?.clientId
          },
          {
            toolName: 'feedback',
            action: 'create',
            resourceType: 'feedback',
            resourceId: data.feedbackId,
            detail: `${RATING_LABELS[data.rating] ?? data.rating}: ${data.comment ?? '(无评语)'}`,
            result: 'success'
          }
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('feedback audit record failed:', msg)
      }
    },
    'feedbackHandler.audit'
  )

  subscribe(
    'feedback:submitted',
    async (data) => {
      if (!isMemoryEnabled()) return
      if (data.rating === 'neutral') return

      try {
        const targetLabel = TARGET_TYPE_LABELS[data.targetType] ?? data.targetType
        const ratingLabel = RATING_LABELS[data.rating] ?? data.rating
        const commentPart = data.comment ? `\n用户评语：${data.comment}` : ''
        const avoidHint = data.rating === 'dislike' ? '\n应避免此类风格或方式。' : ''

        const preferenceText =
          `用户对「${targetLabel}」(ID: ${data.targetId}) 的评价为：${ratingLabel}。${commentPart}${avoidHint}`

        await addMemoryInteraction(
          [
            { role: 'user', content: '（系统反馈记录）' },
            { role: 'assistant', content: preferenceText }
          ],
          data.scope,
          data.sessionId
        )
        log.debug('Feedback preference memory created for %s/%s', data.targetType, data.targetId)
      } catch (err) {
        log.warn('Failed to extract preference memory from feedback:', err)
      }
    },
    'feedbackHandler.memory'
  )

  log.info('Feedback event handlers registered')
}
