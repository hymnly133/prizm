/**
 * Hook Executor — 链式执行 hooks，合并决策
 *
 * deny 优先原则：只要有一个 hook 返回 deny，最终决策即为 deny。
 * ask 次优先：所有 hook 均允许或请求 ask 时，使用第一个 ask 的 interactDetails。
 */

import { createLogger } from '../../logger'
import { hookRegistry } from './hookRegistry'
import type { InteractDetails } from '../toolPermission/types'
import type {
  PreToolUsePayload,
  PreToolUseDecision,
  PostToolUsePayload,
  PostToolUseDecision,
  PreMemoryInjectPayload,
  PreMemoryInjectDecision,
  PostMemoryExtractPayload,
  PostMemoryExtractDecision
} from './types'

const log = createLogger('HookExecutor')

/**
 * 执行 PreToolUse hooks 链
 * @returns 合并后的决策（deny 优先 > ask > allow）
 */
export async function executePreToolUseHooks(
  payload: PreToolUsePayload
): Promise<PreToolUseDecision> {
  const hooks = hookRegistry.getMatchingHooks('PreToolUse', payload.toolName)
  if (hooks.length === 0) return { decision: 'allow' }

  let finalDecision: PreToolUseDecision = { decision: 'allow' }
  let currentArgs = payload.arguments
  let firstInteractDetails: InteractDetails | undefined
  const additionalContextParts: string[] = []

  for (const hook of hooks) {
    try {
      const result = await hook.callback({
        ...payload,
        arguments: currentArgs
      })
      if (!result) continue

      if (result.decision === 'deny') {
        return {
          decision: 'deny',
          denyMessage: result.denyMessage ?? `Hook ${hook.id} denied tool ${payload.toolName}`
        }
      }

      if (result.decision === 'ask') {
        finalDecision = { decision: 'ask' }
        if (result.interactDetails && !firstInteractDetails) {
          firstInteractDetails = result.interactDetails
        }
      }

      if (result.updatedArguments) currentArgs = result.updatedArguments
      if (result.additionalContext) additionalContextParts.push(result.additionalContext)
    } catch (err) {
      log.warn('PreToolUse hook %s threw error for tool %s:', hook.id, payload.toolName, err)
    }
  }

  if (finalDecision.decision === 'ask' && firstInteractDetails) {
    finalDecision.interactDetails = firstInteractDetails
  }
  if (currentArgs !== payload.arguments) {
    finalDecision.updatedArguments = currentArgs
  }
  if (additionalContextParts.length > 0) {
    finalDecision.additionalContext = additionalContextParts.join('\n')
  }
  return finalDecision
}

/**
 * 执行 PostToolUse hooks 链
 */
export async function executePostToolUseHooks(
  payload: PostToolUsePayload
): Promise<PostToolUseDecision> {
  const hooks = hookRegistry.getMatchingHooks('PostToolUse', payload.toolName)
  if (hooks.length === 0) return {}

  let currentResult = payload.result
  const additionalContextParts: string[] = []

  for (const hook of hooks) {
    try {
      const result = await hook.callback({
        ...payload,
        result: currentResult
      })
      if (!result) continue

      if (result.updatedResult !== undefined) currentResult = result.updatedResult
      if (result.additionalContext) additionalContextParts.push(result.additionalContext)
    } catch (err) {
      log.warn('PostToolUse hook %s threw error for tool %s:', hook.id, payload.toolName, err)
    }
  }

  const decision: PostToolUseDecision = {}
  if (currentResult !== payload.result) decision.updatedResult = currentResult
  if (additionalContextParts.length > 0) {
    decision.additionalContext = additionalContextParts.join('\n')
  }
  return decision
}

/**
 * 执行 PreMemoryInject hooks 链
 */
export async function executePreMemoryInjectHooks(
  payload: PreMemoryInjectPayload
): Promise<PreMemoryInjectDecision> {
  const hooks = hookRegistry.getMatchingHooks('PreMemoryInject')
  if (hooks.length === 0) return {}

  let currentMemories = payload.memories
  let overrideQuery: string | undefined

  for (const hook of hooks) {
    try {
      const result = await hook.callback({
        ...payload,
        memories: currentMemories
      })
      if (!result) continue

      if (result.filteredMemories) currentMemories = result.filteredMemories
      if (result.overrideQuery) overrideQuery = result.overrideQuery
    } catch (err) {
      log.warn('PreMemoryInject hook %s threw error:', hook.id, err)
    }
  }

  const decision: PreMemoryInjectDecision = {}
  if (currentMemories !== payload.memories) decision.filteredMemories = currentMemories
  if (overrideQuery) decision.overrideQuery = overrideQuery
  return decision
}

/**
 * 执行 PostMemoryExtract hooks 链
 */
export async function executePostMemoryExtractHooks(
  payload: PostMemoryExtractPayload
): Promise<PostMemoryExtractDecision> {
  const hooks = hookRegistry.getMatchingHooks('PostMemoryExtract')
  if (hooks.length === 0) return {}

  const allExcludeIds: string[] = []

  for (const hook of hooks) {
    try {
      const result = await hook.callback(payload)
      if (!result) continue
      if (result.excludeIds) allExcludeIds.push(...result.excludeIds)
    } catch (err) {
      log.warn('PostMemoryExtract hook %s threw error:', hook.id, err)
    }
  }

  if (allExcludeIds.length > 0) {
    return { excludeIds: [...new Set(allExcludeIds)] }
  }
  return {}
}
