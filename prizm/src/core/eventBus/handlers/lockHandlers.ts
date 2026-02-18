/**
 * 资源锁事件处理器
 * 订阅 agent:session.deleted 自动释放该会话持有的所有锁
 */

import { subscribe, emit } from '../eventBus'
import { lockManager } from '../../resourceLockManager'
import { createLogger } from '../../../logger'

const log = createLogger('LockHandler')

/**
 * 注册资源锁相关的事件订阅。
 * 在 server 启动时调用一次。
 */
export function registerLockHandlers(): void {
  subscribe(
    'agent:session.deleted',
    async (data) => {
      const { scope, sessionId } = data
      const sessionLocks = lockManager.listSessionLocks(scope, sessionId)
      if (sessionLocks.length === 0) return

      lockManager.releaseSessionLocks(scope, sessionId)

      for (const lk of sessionLocks) {
        await emit('resource:lock.changed', {
          action: 'unlocked',
          scope,
          resourceType: lk.resourceType,
          resourceId: lk.resourceId,
          sessionId
        })
      }

      log.info(
        'Released %d locks for deleted session %s in scope %s',
        sessionLocks.length,
        sessionId,
        scope
      )
    },
    'lockManager.releaseOnSessionDelete'
  )

  log.info('Lock event handlers registered')
}
