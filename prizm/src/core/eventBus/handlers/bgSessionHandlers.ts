/**
 * BG Session 事件处理器
 *
 * - bg:session.completed → announce 结果回传到父会话
 * - bg:session.* → 审计日志记录
 */

import { subscribe } from '../eventBus'
import * as auditManager from '../../agentAuditLog/auditManager'
import { scopeStore } from '../../ScopeStore'
import type { AgentMessage } from '@prizm/shared'
import { createLogger } from '../../../logger'

const log = createLogger('BgSessionHandlers')

export function registerBgSessionHandlers(): void {
  subscribe(
    'bg:session.completed',
    async (data) => {
      try {
        auditManager.record(
          data.scope,
          { actorType: 'system' },
          {
            toolName: 'bg:session',
            action: 'bg_set_result',
            resourceType: 'session',
            resourceId: data.sessionId,
            result: 'success',
            detail: `durationMs=${data.durationMs}, resultLength=${data.result?.length ?? 0}`
          }
        )
      } catch (err) {
        log.error('Failed to record bg:session.completed audit:', err)
      }

      // announce 回传：将结果注入父会话
      try {
        const scopeData = scopeStore.getScopeData(data.scope)
        const bgSession = scopeData.agentSessions.find((s) => s.id === data.sessionId)
        const announceTarget = bgSession?.bgMeta?.announceTarget
        if (announceTarget) {
          const parentData = scopeStore.getScopeData(announceTarget.scope)
          const parentSession = parentData.agentSessions.find(
            (s) => s.id === announceTarget.sessionId
          )
          if (parentSession) {
            const announceContent =
              `[后台任务完成] ${bgSession?.bgMeta?.label ?? data.sessionId}\n` +
              `状态: 完成 | 耗时: ${data.durationMs}ms\n` +
              `---\n${data.result ?? '(无输出)'}`
            const announceMsg: AgentMessage = {
              id: `bg-announce-${data.sessionId}`,
              role: 'system',
              parts: [{ type: 'text', content: announceContent }],
              createdAt: Date.now()
            }
            parentSession.messages.push(announceMsg)
            parentSession.updatedAt = Date.now()
            scopeStore.saveScope(announceTarget.scope)
            log.info(
              'BG announce injected to parent session:',
              announceTarget.sessionId,
              'from:',
              data.sessionId
            )
          }
        }
      } catch (err) {
        log.error('Failed to inject announce to parent session:', err)
      }
    },
    'bgSession.completed.audit'
  )

  subscribe(
    'bg:session.failed',
    (data) => {
      try {
        auditManager.record(
          data.scope,
          { actorType: 'system' },
          {
            toolName: 'bg:session',
            action: 'bg_trigger',
            resourceType: 'session',
            resourceId: data.sessionId,
            result: 'error',
            errorMessage: data.error,
            detail: `durationMs=${data.durationMs}`
          }
        )
      } catch (err) {
        log.error('Failed to record bg:session.failed audit:', err)
      }
    },
    'bgSession.failed.audit'
  )

  subscribe(
    'bg:session.timeout',
    (data) => {
      try {
        auditManager.record(
          data.scope,
          { actorType: 'system' },
          {
            toolName: 'bg:session',
            action: 'bg_trigger',
            resourceType: 'session',
            resourceId: data.sessionId,
            result: 'error',
            errorMessage: `Timeout after ${data.timeoutMs}ms`
          }
        )
      } catch (err) {
        log.error('Failed to record bg:session.timeout audit:', err)
      }
    },
    'bgSession.timeout.audit'
  )

  subscribe(
    'bg:session.cancelled',
    (data) => {
      try {
        auditManager.record(
          data.scope,
          { actorType: 'system' },
          {
            toolName: 'bg:session',
            action: 'bg_cancel',
            resourceType: 'session',
            resourceId: data.sessionId,
            result: 'success'
          }
        )
      } catch (err) {
        log.error('Failed to record bg:session.cancelled audit:', err)
      }
    },
    'bgSession.cancelled.audit'
  )

  log.info('BG Session event handlers registered')
}
