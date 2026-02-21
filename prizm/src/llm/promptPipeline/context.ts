/**
 * promptPipeline — 构建上下文
 *
 * 从 scope、session、以及调用方提供的选项组装 PromptBuildContext。
 */

import type { AgentSession } from '@prizm/shared'
import { scopeStore } from '../../core/ScopeStore'
import type { PromptBuildContext } from './types'

/** 供 pipeline 使用的上下文输入（由 adapter/chatCore 传入） */
export interface PromptContextInput {
  scope: string
  sessionId: string
  session: AgentSession | null
  includeScopeContext?: boolean
  rulesContent?: string
  customRulesContent?: string
  skillMetadataForDiscovery?: Array<{ name: string; description: string }>
  activeSkillInstructions?: Array<{ name: string; instructions: string }>
  memoryTexts?: string[]
  promptInjection?: string
  grantedPaths?: string[]
  workflowEditContext?: string
  /** 由 BG/ToolLLM 传入的 systemPreamble，作为 callerPreamble */
  callerPreamble?: string
}

/**
 * 组装 PromptBuildContext。
 * scopeRoot 从 scopeStore 读取，其余来自 input。
 */
export function buildPromptContext(input: PromptContextInput): PromptBuildContext {
  const scopeRoot = scopeStore.getScopeRootPath(input.scope)
  return {
    scope: input.scope,
    sessionId: input.sessionId,
    session: input.session,
    scopeRoot,
    includeScopeContext: input.includeScopeContext !== false,
    rulesContent: input.rulesContent,
    customRulesContent: input.customRulesContent,
    skillMetadataForDiscovery: input.skillMetadataForDiscovery,
    activeSkillInstructions: input.activeSkillInstructions,
    memoryTexts: input.memoryTexts,
    promptInjection: input.promptInjection,
    grantedPaths: input.grantedPaths,
    workflowEditContext: input.workflowEditContext,
    callerPreamble: input.callerPreamble
  }
}
