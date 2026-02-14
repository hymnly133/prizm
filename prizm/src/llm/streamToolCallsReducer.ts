/**
 * 流式 tool_calls 累积逻辑
 * 将 delta.tool_calls 按 index 合并为完整 tool_calls，参照 LobeChat / OpenAI Node SDK
 */

export interface ToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
  type?: string
}

export interface AccumulatedToolCall {
  id: string
  name: string
  arguments: string
}

export interface AccumulatedMessage {
  content: string
  toolCalls: AccumulatedToolCall[]
}

/** 空累积状态 */
const EMPTY: AccumulatedMessage = { content: '', toolCalls: [] }

/**
 * 将流式 chunk 的 delta 合并到累积的 message
 * @param prev 上一轮累积结果
 * @param delta 当前 chunk 的 delta（含 content、tool_calls）
 * @returns 合并后的 message
 */
export function reduceStreamDelta(
  prev: AccumulatedMessage,
  delta: {
    content?: string
    tool_calls?: ToolCallDelta[]
  }
): AccumulatedMessage {
  const next: AccumulatedMessage = {
    content: prev.content + (delta.content ?? ''),
    toolCalls: prev.toolCalls.map((tc) => ({ ...tc }))
  }

  const toolDeltas = delta.tool_calls
  if (!toolDeltas?.length) return next

  for (const d of toolDeltas) {
    const idx = d.index ?? next.toolCalls.length
    while (next.toolCalls.length <= idx) {
      next.toolCalls.push({ id: '', name: '', arguments: '' })
    }
    const cur = next.toolCalls[idx]
    if (d.id) cur.id = d.id
    if (d.function?.name) cur.name = d.function.name
    if (d.function?.arguments !== undefined) cur.arguments += d.function.arguments
  }

  return next
}

/**
 * 创建初始累积状态
 */
export function createInitialAccumulator(): AccumulatedMessage {
  return { ...EMPTY }
}
