/**
 * 将 Prizm LLMChatMessage / LLMTool 转为 AI SDK 的 messages / tools 格式
 */

import type { LLMChatMessage, LLMTool } from '../../adapters/interfaces'
import { tool as aiTool, jsonSchema } from 'ai'

export type AISDKMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string | Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }>
    }
  | { role: 'tool'; toolCallId: string; content: string }

export function mapMessagesToAISDK(messages: LLMChatMessage[]): AISDKMessage[] {
  return messages.map((m) => {
    if (m.role === 'system' || m.role === 'user') {
      return { role: m.role, content: typeof m.content === 'string' ? m.content : '' }
    }
    if (m.role === 'assistant') {
      const content = typeof m.content === 'string' ? m.content : (m.content ?? '') || ''
      const toolCalls =
        'tool_calls' in m && Array.isArray(m.tool_calls)
          ? m.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.function?.name ?? '',
              arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : '{}'
            }))
          : []
      if (toolCalls.length === 0) {
        return { role: 'assistant', content }
      }
      const parts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }> = []
      if (content) parts.push({ type: 'text', text: content })
      for (const tc of toolCalls) {
        let args: unknown = {}
        try {
          args = JSON.parse(tc.arguments || '{}')
        } catch {
          args = {}
        }
        parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, args })
      }
      return { role: 'assistant', content: parts }
    }
    if (m.role === 'tool' && 'tool_call_id' in m) {
      return {
        role: 'tool',
        toolCallId: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : ''
      }
    }
    return { role: 'user', content: String((m as { content?: unknown }).content ?? '') }
  }) as AISDKMessage[]
}

/**
 * 将 Prizm LLMTool[] 转为 AI SDK 的 tools 对象（无 execute，由上层执行）
 */
export function mapToolsToAISDK(tools: LLMTool[]): Record<string, ReturnType<typeof aiTool>> {
  const out: Record<string, ReturnType<typeof aiTool>> = {}
  for (const t of tools) {
    const fn = t.function
    if (!fn?.name) continue
    const schema = (fn.parameters as object) || { type: 'object', properties: {} }
    out[fn.name] = aiTool({
      description: fn.description ?? '',
      inputSchema: jsonSchema(schema as { type: string; properties?: unknown; required?: string[] })
    })
  }
  return out
}
