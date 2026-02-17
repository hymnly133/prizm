/**
 * Prizm Server 默认通知适配器（控制台日志）
 */

import { createLogger } from '../logger'
import type { INotificationAdapter } from './interfaces'

const log = createLogger('Adapter')

export class DefaultNotificationAdapter implements INotificationAdapter {
  notify(title: string, body?: string): void {
    log.info('Notify:', title, body ?? '')
  }
}
