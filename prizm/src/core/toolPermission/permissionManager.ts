/**
 * Permission Manager — 统一权限引擎
 *
 * 作为 PreToolUse hook 注册到 HookRegistry，根据 PermissionMode 和规则链决策。
 */

import { createLogger } from '../../logger'
import { matchToolPattern, extractToolPaths } from '../../utils/toolMatcher'
import type { PermissionMode, PermissionRule, PermissionResult } from './types'
import { getDefaultRules } from './defaultRules'
import type { PreToolUsePayload, PreToolUseDecision } from '../agentHooks/types'
import { hookRegistry } from '../agentHooks/hookRegistry'
import { subscribe } from '../eventBus/eventBus'

const log = createLogger('PermissionManager')

/** 会话级权限模式缓存 */
const sessionPermissionModes = new Map<string, PermissionMode>()

/** 会话级自定义规则 */
const sessionCustomRules = new Map<string, PermissionRule[]>()

/**
 * 设置会话的权限模式
 */
export function setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
  sessionPermissionModes.set(sessionId, mode)
  log.info('Session %s permission mode set to: %s', sessionId, mode)
}

/**
 * 获取会话的权限模式
 */
export function getSessionPermissionMode(sessionId: string): PermissionMode {
  return sessionPermissionModes.get(sessionId) ?? 'default'
}

/**
 * 清除会话权限配置
 */
export function clearSessionPermission(sessionId: string): void {
  sessionPermissionModes.delete(sessionId)
  sessionCustomRules.delete(sessionId)
}

/**
 * 添加会话级自定义规则
 */
export function addSessionRules(sessionId: string, rules: PermissionRule[]): void {
  const existing = sessionCustomRules.get(sessionId) ?? []
  sessionCustomRules.set(sessionId, [...existing, ...rules])
}

/**
 * 检查工具权限
 */
export function checkPermission(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  grantedPaths: string[]
): PermissionResult {
  const mode = getSessionPermissionMode(sessionId)

  if (mode === 'bypassPermissions') {
    return { allowed: true }
  }

  const rules = [
    ...getDefaultRules(mode),
    ...(sessionCustomRules.get(sessionId) ?? [])
  ].sort((a, b) => a.priority - b.priority)

  for (const rule of rules) {
    if (!matchToolPattern(rule.toolPattern, toolName)) continue

    if (rule.behavior === 'deny') {
      return { allowed: false, denyMessage: rule.denyMessage ?? `Denied by rule ${rule.id}` }
    }
    if (rule.behavior === 'ask') {
      const paths = extractToolPaths(args)
      const uncoveredPaths = paths.filter((p) => !grantedPaths.includes(p))
      if (uncoveredPaths.length > 0) {
        return { allowed: false, interactPaths: uncoveredPaths }
      }
      return { allowed: true }
    }
    if (rule.behavior === 'allow') {
      return { allowed: true }
    }
  }

  return { allowed: true }
}

/**
 * 注册为默认 PreToolUse hook
 */
export function registerPermissionHook(): void {
  hookRegistry.register({
    id: 'builtin:permission-manager',
    event: 'PreToolUse',
    priority: 10,
    callback: async (payload: PreToolUsePayload): Promise<PreToolUseDecision> => {
      const result = checkPermission(
        payload.sessionId,
        payload.toolName,
        payload.arguments,
        payload.grantedPaths
      )
      if (!result.allowed) {
        if (result.interactPaths?.length) {
          return { decision: 'ask', interactPaths: result.interactPaths }
        }
        return { decision: 'deny', denyMessage: result.denyMessage }
      }
      return { decision: 'allow' }
    }
  })
  log.info('Permission hook registered')
}

/**
 * 订阅 session 删除事件，自动清理 session 权限配置。
 * 在 server.ts 启动时注册。
 */
export function registerPermissionCleanupHandler(): void {
  subscribe('agent:session.deleted', (data) => {
    clearSessionPermission(data.sessionId)
  }, 'permissionCleanup.sessionDeleted')
  log.info('Permission cleanup handler registered')
}

