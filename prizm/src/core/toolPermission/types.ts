/**
 * 工具权限系统 — 类型定义
 *
 * 参考 Claude Agent SDK PermissionMode 模式，为 Prizm 提供统一的工具权限控制。
 */

/**
 * 权限模式：
 * - default: 标准模式，写操作需审批
 * - acceptEdits: 自动批准编辑操作（BG Session 默认）
 * - bypassPermissions: 跳过所有权限检查
 * - plan: 只读模式，拒绝所有写操作
 * - dontAsk: 拒绝所有需要审批的操作（不弹窗，直接拒绝）
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'

/** 权限规则行为 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

/** 单条权限规则 */
export interface PermissionRule {
  /** 规则 ID */
  id: string
  /** 工具名 glob 匹配（支持 * 通配） */
  toolPattern: string
  /** 此规则产生的行为 */
  behavior: PermissionBehavior
  /** deny 时的错误消息 */
  denyMessage?: string
  /** 规则优先级，数值越小越先匹配 */
  priority: number
}

/** 权限检查结果 */
export interface PermissionResult {
  allowed: boolean
  /** 如果 ask，需要交互的路径列表 */
  interactPaths?: string[]
  /** 拒绝原因 */
  denyMessage?: string
}
