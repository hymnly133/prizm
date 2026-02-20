/**
 * Agent Hooks 类型定义
 *
 * 参考 Claude Agent SDK HookEvent 模式，为 Prizm Agent 提供
 * 工具执行前后拦截、记忆注入/抽取拦截等扩展点。
 */

import type { MemoryItem } from '@prizm/shared'

/** Hook 事件类型枚举 */
export type AgentHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreMemoryInject'
  | 'PostMemoryExtract'

/** Hook 决策：allow 放行 / deny 拒绝 / ask 需要用户审批 */
export type HookDecisionType = 'allow' | 'deny' | 'ask'

/** PreToolUse hook 的输入 payload */
export interface PreToolUsePayload {
  scope: string
  sessionId: string
  toolName: string
  toolCallId: string
  arguments: Record<string, unknown>
  /** 当前会话已授权的路径 */
  grantedPaths: string[]
}

/** PreToolUse hook 的决策返回 */
export interface PreToolUseDecision {
  decision: HookDecisionType
  /** deny 时给 LLM 的错误消息 */
  denyMessage?: string
  /** ask 时需要授权的路径列表 */
  interactPaths?: string[]
  /** 修改后的参数（undefined 表示不修改） */
  updatedArguments?: Record<string, unknown>
  /** 注入额外上下文给 LLM */
  additionalContext?: string
}

/** PostToolUse hook 的输入 payload */
export interface PostToolUsePayload {
  scope: string
  sessionId: string
  toolName: string
  toolCallId: string
  arguments: Record<string, unknown>
  result: string
  isError: boolean
  /** 执行耗时 ms */
  durationMs: number
}

/** PostToolUse hook 的决策返回 */
export interface PostToolUseDecision {
  /** 修改后的结果（undefined 表示不修改） */
  updatedResult?: string
  /** 注入额外上下文给 LLM */
  additionalContext?: string
}

/** PreMemoryInject hook 的输入 payload */
export interface PreMemoryInjectPayload {
  scope: string
  sessionId: string
  query: string
  memories: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  }
}

/** PreMemoryInject hook 的决策返回 */
export interface PreMemoryInjectDecision {
  /** 过滤后的记忆（undefined 表示不修改） */
  filteredMemories?: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  }
  /** 覆盖检索 query */
  overrideQuery?: string
}

/** PostMemoryExtract hook 的输入 payload */
export interface PostMemoryExtractPayload {
  scope: string
  sessionId: string
  pipeline: 'P1' | 'P2'
  created: Array<{ id: string; type: string; content: string }>
}

/** PostMemoryExtract hook 的决策返回 */
export interface PostMemoryExtractDecision {
  /** 需要排除的记忆 ID 列表 */
  excludeIds?: string[]
}

/** Hook 回调函数类型映射 */
export type HookCallback<E extends AgentHookEvent> =
  E extends 'PreToolUse' ? (payload: PreToolUsePayload) => Promise<PreToolUseDecision | void>
  : E extends 'PostToolUse' ? (payload: PostToolUsePayload) => Promise<PostToolUseDecision | void>
  : E extends 'PreMemoryInject' ? (payload: PreMemoryInjectPayload) => Promise<PreMemoryInjectDecision | void>
  : E extends 'PostMemoryExtract' ? (payload: PostMemoryExtractPayload) => Promise<PostMemoryExtractDecision | void>
  : never

/** Hook 注册条目 */
export interface HookRegistration<E extends AgentHookEvent = AgentHookEvent> {
  /** 唯一 ID */
  id: string
  /** 事件类型 */
  event: E
  /** 工具名 glob 匹配（仅 PreToolUse/PostToolUse 有效） */
  toolMatcher?: string | RegExp
  /** 优先级，数值越小越先执行，默认 100 */
  priority: number
  /** 回调函数 */
  callback: HookCallback<E>
}
