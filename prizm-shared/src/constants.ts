/**
 * 共享常量
 */

/** 默认工作区 scope */
export const DEFAULT_SCOPE = 'default'

/** 语义 scope：用户实时上下文，用于常驻显示的 TODO 和便签 */
export const ONLINE_SCOPE = 'online'

/** 内置 scope 列表 */
export const BUILTIN_SCOPES = [DEFAULT_SCOPE, ONLINE_SCOPE] as const

/**
 * 记忆系统统一 userId。
 * 记忆不按客户端隔离，所有客户端共享同一份记忆数据。
 */
export const MEMORY_USER_ID = 'default'
