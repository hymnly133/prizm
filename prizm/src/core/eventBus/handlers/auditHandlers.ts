/**
 * 审计事件处理器
 * 订阅 tool:executed 事件，自动将审计数据写入 auditManager
 * 支持 Agent 和 User 双来源
 */

import { subscribe } from '../eventBus'
import { auditManager } from '../../agentAuditLog'
import { createLogger } from '../../../logger'

const log = createLogger('AuditHandler')

/**
 * 注册审计相关的事件订阅。
 * 在 server 启动时调用一次。
 */
export function registerAuditHandlers(): void {
  subscribe(
    'tool:executed',
    (data) => {
      try {
        if (data.actor) {
          auditManager.record(
            data.scope,
            {
              actorType: data.actor.type,
              sessionId: data.actor.sessionId,
              clientId: data.actor.clientId
            },
            data.auditInput
          )
        } else {
          // 向后兼容：无 actor 信息时退回到 sessionId
          auditManager.record(data.scope, data.sessionId, data.auditInput)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('audit record failed:', msg)
      }
    },
    'auditManager.record'
  )

  log.info('Audit event handlers registered')
}
