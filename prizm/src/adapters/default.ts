/**
 * Prizm Server 默认适配器实现
 * 用于独立运行或测试场景。各适配器类在独立文件中实现，此处聚合并导出。
 */

import type { PrizmAdapters } from './interfaces'
import { DefaultNotificationAdapter } from './DefaultNotificationAdapter'
import { DefaultTodoListAdapter } from './DefaultTodoListAdapter'
import { DefaultClipboardAdapter } from './DefaultClipboardAdapter'
import { DefaultDocumentsAdapter } from './DefaultDocumentsAdapter'
import { DefaultAgentAdapter } from './DefaultAgentAdapter'

export { DefaultNotificationAdapter } from './DefaultNotificationAdapter'
export { DefaultTodoListAdapter } from './DefaultTodoListAdapter'
export { DefaultClipboardAdapter } from './DefaultClipboardAdapter'
export { DefaultDocumentsAdapter } from './DefaultDocumentsAdapter'
export { DefaultAgentAdapter } from './DefaultAgentAdapter'

export function createDefaultAdapters(): PrizmAdapters {
  return {
    notification: new DefaultNotificationAdapter(),
    todoList: new DefaultTodoListAdapter(),
    clipboard: new DefaultClipboardAdapter(),
    documents: new DefaultDocumentsAdapter(),
    agent: new DefaultAgentAdapter()
  }
}
