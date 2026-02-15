/**
 * Agent 系统提示词构建
 * 包含工作区上下文摘要、能力说明、工作原则
 */

import { buildScopeContextSummary } from './scopeContext'

export interface SystemPromptOptions {
  scope: string
  sessionId?: string
  includeScopeContext?: boolean
}

/**
 * 构建注入到对话前的 system 内容
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { scope, sessionId, includeScopeContext = true } = options

  const parts: string[] = []

  parts.push('你是用户工作区的 AI 助手，根据工作区数据与用户需求回复，必要时使用工具查询或修改。')

  if (includeScopeContext) {
    const contextSummary = buildScopeContextSummary(scope)
    if (contextSummary) {
      parts.push('')
      parts.push('[工作区 ' + scope + ']')
      parts.push(contextSummary)
      parts.push('---')
    }
  }

  parts.push('')
  parts.push('## 能力与数据')
  parts.push('- 工具：便签/待办/文档的读建改删；@note/@doc/@todo 引用时内容已附上')
  parts.push(
    '- 记忆：每条消息会注入 [User/Scope/Session Memory] 相关片段；需更多时调用 prizm_search_memories / prizm_list_memories'
  )
  parts.push('- 检索：默认混合检索；多步推理检索(agentic)仅复杂查询时用')
  parts.push('- 修改前确认意图，删除需二次确认')
  parts.push('')

  parts.push('## 原则')
  parts.push('1. 用工作区与记忆作答，不重复已有内容')
  parts.push('2. 修改/删除前确认；引用标来源(类型+ID)')

  return parts.join('\n')
}
