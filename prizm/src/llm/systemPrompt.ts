/**
 * Agent 系统提示词构建
 * 包含工作区上下文摘要、能力说明、上下文状态、工作原则
 */

import { buildScopeContextSummary } from './scopeContext'
import { buildProvisionSummary } from './contextTracker'

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

  parts.push(
    '你是用户工作区的 AI 助手。请根据工作区数据与用户需求进行回复，必要时主动使用工具查询或修改数据。'
  )

  if (includeScopeContext) {
    const contextSummary = buildScopeContextSummary(scope, sessionId ? { sessionId } : undefined)
    if (contextSummary) {
      parts.push('')
      parts.push('当前工作区 (scope: ' + scope + ') 包含以下数据：')
      parts.push('')
      parts.push(contextSummary)
      parts.push('')
      parts.push('---')
    }
  }

  parts.push('')
  parts.push('## 你的能力')
  parts.push('- 你可以通过工具读取、创建、修改、删除便签/待办/文档')
  parts.push('- 用户用 @note:id、@doc:id、@todo:id 引用具体项目时，相关内容已附在上下文中')
  parts.push('- 如果需要更多信息，请主动使用搜索和读取工具')
  parts.push('- 进行修改操作时，请先确认用户意图')
  parts.push('')

  if (sessionId) {
    const provisionSummary = buildProvisionSummary(scope, sessionId)
    if (provisionSummary) {
      parts.push('## 上下文状态')
      parts.push(provisionSummary)
      parts.push('- 标记为 [摘要] 的项目可通过工具获取全文')
      parts.push('- 标记为 [已过期] 的项目内容可能已变更')
      parts.push('')
    }
  }

  parts.push('## 工作原则')
  parts.push('1. 主动利用工作区数据回答问题，不要仅凭常识')
  parts.push('2. 修改数据前需确认，删除操作需二次确认')
  parts.push('3. 引用工作区内容时标注来源（类型+ID）')
  parts.push('4. 搜索相关内容以给出更完整的回答')

  return parts.join('\n')
}
