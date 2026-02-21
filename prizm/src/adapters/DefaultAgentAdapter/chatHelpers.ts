/**
 * DefaultAgentAdapter — 辅助常量、接口与工具函数
 */

export const TOOL_RESULT_STREAM_THRESHOLD = 500
export const TOOL_RESULT_CHUNK_SIZE = 200
export const TOOL_PROGRESS_THRESHOLD_MS = 3000
export const TOOL_PROGRESS_INTERVAL_MS = 3000

import type { InteractDetails } from '../../core/toolPermission/types'

export interface ExecResult {
  tc: { id: string; name: string; arguments: string }
  text: string
  isError: boolean
  needsInteract?: boolean
  interactDetails?: InteractDetails
  parsedArgs?: Record<string, unknown>
  durationMs?: number
}

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('socket hang up') ||
    msg.includes('network timeout')
  )
}
