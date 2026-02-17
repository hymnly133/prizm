/**
 * HTTP 客户端模块 barrel 导出
 *
 * 先导出 PrizmClient 基类，再导入各 mixin 模块（side effects）
 * 以确保 PrizmClient.prototype 在导出前被完整扩展。
 */

export { PrizmClient } from './client'
export type { PrizmClientOptions, HttpRequestOptions } from './client'

// 导入 mixin 模块（side effects：向 PrizmClient.prototype 添加方法）
import './mixins/auth'
import './mixins/files'
import './mixins/todo'
import './mixins/clipboard'
import './mixins/documents'
import './mixins/search'
import './mixins/agent'
import './mixins/memory'
import './mixins/settings'
import './mixins/terminal'
import './mixins/embedding'

// 重导出类型
export * from './clientTypes'
