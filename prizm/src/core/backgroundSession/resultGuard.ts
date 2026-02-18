/**
 * BG Session 结果守卫
 *
 * 在对话流结束后检查 bgResult 是否已设置，
 * 若未设置则注入提醒消息触发第二轮，最终降级兜底。
 */

import type { AgentSession } from '@prizm/shared'

export const RESULT_GUARD_PROMPT =
  '你的任务已执行完毕，但尚未提交结果。请立即调用 prizm_set_result 工具提交你的执行结果摘要。'

/** 检查 BG Session 是否需要结果守卫干预 */
export function needsResultGuard(session: AgentSession): boolean {
  return session.kind === 'background' && !session.bgResult && session.bgStatus === 'running'
}

/** 从 session 最后一条 assistant 消息中提取文本作为降级兜底结果 */
export function extractFallbackResult(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    if (msg.role === 'assistant') {
      const textParts = msg.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; content: string }).content)
        .join('\n')
      if (textParts.trim()) return textParts.trim()
    }
  }
  return '（后台任务已执行，但未产生明确输出）'
}
