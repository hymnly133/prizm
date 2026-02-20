/**
 * Hook Registry — 全局 hook 注册表
 *
 * 按 event 类型管理注册的 hooks，支持 matcher 过滤和优先级排序。
 */

import { createLogger } from '../../logger'
import { matchToolPattern } from '../../utils/toolMatcher'
import type {
  AgentHookEvent,
  HookCallback,
  HookRegistration
} from './types'

const log = createLogger('HookRegistry')

class HookRegistryImpl {
  private hooks = new Map<AgentHookEvent, HookRegistration[]>()

  /**
   * 注册一个 hook
   */
  register<E extends AgentHookEvent>(registration: HookRegistration<E>): void {
    const list = this.hooks.get(registration.event) ?? []
    const existing = list.findIndex((h) => h.id === registration.id)
    if (existing >= 0) {
      list[existing] = registration as HookRegistration
      log.info('Hook updated: %s (event=%s)', registration.id, registration.event)
    } else {
      list.push(registration as HookRegistration)
      log.info('Hook registered: %s (event=%s, priority=%d)', registration.id, registration.event, registration.priority)
    }
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(registration.event, list)
  }

  /**
   * 注销一个 hook
   */
  unregister(id: string): boolean {
    for (const [event, list] of this.hooks) {
      const idx = list.findIndex((h) => h.id === id)
      if (idx >= 0) {
        list.splice(idx, 1)
        log.info('Hook unregistered: %s (event=%s)', id, event)
        return true
      }
    }
    return false
  }

  /**
   * 获取匹配的 hooks（按优先级排序）
   * @param event 事件类型
   * @param toolName 工具名（仅 PreToolUse/PostToolUse 需要匹配）
   */
  getMatchingHooks<E extends AgentHookEvent>(
    event: E,
    toolName?: string
  ): HookRegistration<E>[] {
    const list = (this.hooks.get(event) ?? []) as HookRegistration<E>[]
    if (!toolName) return list

    return list.filter((h) => {
      if (!h.toolMatcher) return true
      if (typeof h.toolMatcher === 'string') {
        return matchToolPattern(h.toolMatcher, toolName)
      }
      return h.toolMatcher.test(toolName)
    })
  }

  /**
   * 清除所有 hooks
   */
  clear(): void {
    this.hooks.clear()
    log.info('All hooks cleared')
  }

  /**
   * 获取注册的 hook 数量
   */
  get size(): number {
    let count = 0
    for (const list of this.hooks.values()) count += list.length
    return count
  }
}

/** 全局单例 */
export const hookRegistry = new HookRegistryImpl()
