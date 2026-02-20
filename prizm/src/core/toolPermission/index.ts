/**
 * 工具权限系统 — 统一导出
 */

export type { PermissionMode, PermissionRule, PermissionResult, PermissionBehavior } from './types'
export {
  setSessionPermissionMode,
  getSessionPermissionMode,
  clearSessionPermission,
  addSessionRules,
  checkPermission,
  registerPermissionHook,
  registerPermissionCleanupHandler
} from './permissionManager'
export { getDefaultRules } from './defaultRules'
