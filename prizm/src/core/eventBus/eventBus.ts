/**
 * 领域事件总线 - 基于 emittery 的类型安全封装
 *
 * 提供：
 * - 类型安全的 emit / subscribe / subscribeOnce
 * - 错误隔离：单个 handler 异常不影响其他 handler
 * - 开发模式自动事件追踪日志
 * - 优雅关闭支持
 */

import Emittery from 'emittery'
import { createLogger } from '../../logger'
import type { DomainEventMap, DomainEventName } from './types'

const log = createLogger('EventBus')

const bus = new Emittery<DomainEventMap>({
  debug: {
    name: 'prizm-events',
    enabled: process.env.PRIZM_LOG_LEVEL === 'debug'
  }
})

/**
 * 发布领域事件（异步，等待所有 handler 执行完成）。
 * 使用 fire-and-forget 模式时可忽略返回的 Promise。
 */
export async function emit<K extends DomainEventName>(
  event: K,
  data: DomainEventMap[K]
): Promise<void> {
  await bus.emit(event, data)
}

/**
 * 订阅领域事件（带错误隔离）。
 * 返回取消订阅的 unsubscribe 函数。
 */
export function subscribe<K extends DomainEventName>(
  event: K,
  handler: (data: DomainEventMap[K]) => void | Promise<void>,
  label?: string
): () => void {
  const wrapped = async (data: DomainEventMap[K]) => {
    try {
      await handler(data)
    } catch (err) {
      const tag = label ? ` [${label}]` : ''
      log.error(`handler error on "${String(event)}"${tag}:`, err)
    }
  }
  return bus.on(event, wrapped)
}

/**
 * 订阅一次性事件（带错误隔离）。
 */
export function subscribeOnce<K extends DomainEventName>(
  event: K,
  handler: (data: DomainEventMap[K]) => void | Promise<void>,
  label?: string
): void {
  const wrapped = async (data: DomainEventMap[K]) => {
    try {
      await handler(data)
    } catch (err) {
      const tag = label ? ` [${label}]` : ''
      log.error(`once-handler error on "${String(event)}"${tag}:`, err)
    }
  }
  bus.once(event).then(wrapped)
}

/**
 * 订阅所有事件（用于调试/监控）。
 * 返回取消订阅函数。
 */
export function subscribeAny(
  handler: (eventName: DomainEventName, data: unknown) => void | Promise<void>
): () => void {
  return bus.onAny(handler as (eventName: string, data: unknown) => void | Promise<void>)
}

/**
 * 清理所有订阅（优雅关闭时调用）。
 */
export function clearAll(): void {
  bus.clearListeners()
  log.info('All event subscriptions cleared')
}
