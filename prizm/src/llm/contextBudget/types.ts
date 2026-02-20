/**
 * 上下文预算管理 — 类型定义
 *
 * 统一 scopeContext / 记忆注入 / A-B 窗口为 Context Budget 模型，
 * 按优先级自动裁剪各部分以适配 LLM 的 token 窗口。
 */

/** 上下文预算分配区域 */
export interface BudgetAllocation {
  /** 区域名称 */
  name: string
  /** 最大 token 分配量 */
  max: number
  /** 已使用 token */
  used: number
  /** 裁剪优先级（数值越大越先裁剪） */
  trimPriority: number
}

/** 上下文预算配置 */
export interface ContextBudgetConfig {
  /** LLM 模型 context window 总 token */
  totalTokens: number
  /** 系统提示预留 token */
  systemPromptReserved: number
  /** 工具 schema 预留 token */
  toolDefinitionsReserved: number
  /** 回复预留 token */
  responseBufferReserved: number
}

/** 上下文预算快照 */
export interface ContextBudgetSnapshot {
  config: ContextBudgetConfig
  /** 可分配的 token (totalTokens - reserved) */
  available: number
  /** 各区域分配情况 */
  allocations: Record<string, BudgetAllocation>
  /** 是否发生了裁剪 */
  trimmed: boolean
  /** 裁剪详情 */
  trimDetails?: Array<{ name: string; before: number; after: number }>
}

/** 默认裁剪优先级（数值越大越先被裁剪） */
export const TRIM_PRIORITIES = {
  SESSION_MEMORY: 60,
  DOCUMENT_MEMORY: 50,
  SCOPE_MEMORY: 40,
  SCOPE_CONTEXT: 30,
  SKILL_RULES: 20,
  USER_PROFILE: 10,
  CONVERSATION_HISTORY: 5
} as const
