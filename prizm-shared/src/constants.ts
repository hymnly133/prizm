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
 * 统一 userId（用于 token 统计等非记忆场景）。
 * 记忆系统已迁移到 @prizm/evermemos 的 DEFAULT_USER_ID，不再需要显式传递。
 * @see DEFAULT_USER_ID from @prizm/evermemos
 */
export const MEMORY_USER_ID = 'default'
