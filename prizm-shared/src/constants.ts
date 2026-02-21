/**
 * 共享常量
 */

/** 工作流管理会话来源（tool 会话派生），统一使用连字符 */
export const WORKFLOW_MANAGEMENT_SOURCE = 'workflow-management' as const

/** 工作流管理会话未绑定定义时的展示名（与后端 label 统一） */
export const WORKFLOW_MANAGEMENT_SESSION_LABEL_PENDING = '待创建' as const

/** 工作流管理工具：创建并注册工作流定义（未绑定会话） */
export const WORKFLOW_MANAGEMENT_TOOL_CREATE_WORKFLOW = 'workflow-management-create-workflow' as const

/** 工作流管理工具：更新已绑定工作流定义 */
export const WORKFLOW_MANAGEMENT_TOOL_UPDATE_WORKFLOW = 'workflow-management-update-workflow' as const

/** Token 使用 / 会话分类：工作流管理聊天 */
export const CHAT_CATEGORY_WORKFLOW_MANAGEMENT = 'chat:workflow-management' as const

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
