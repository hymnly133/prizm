/**
 * 片段：active_locks（当前锁列表，perTurn）
 */

import { lockManager } from '../../../core/resourceLockManager'
import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

export const active_locks: SegmentBuilder = (
  ctx: PromptBuildContext,
  _scenario: PromptScenario
): string => {
  if (!ctx.sessionId) return ''
  const locks = lockManager.listSessionLocks(ctx.scope, ctx.sessionId)
  if (locks.length === 0) return ''
  const lockLines = locks.map(
    (l) => `- ${l.resourceType}/${l.resourceId}${l.reason ? ` (${l.reason})` : ''}`
  )
  return (
    '<active_locks>\n' +
    '当前会话已签出的资源：\n' +
    lockLines.join('\n') +
    '\n编辑完成后务必 checkin/release 释放锁。\n' +
    '</active_locks>'
  )
}
