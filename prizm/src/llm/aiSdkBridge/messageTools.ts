/**
 * 将 Prizm LLMChatMessage / LLMTool 转为 AI SDK 的 messages / tools 格式
 */

import type { LLMChatMessage, LLMTool, LLMMessageContentPart } from '../../adapters/interfaces'
import { tool as aiTool, jsonSchema } from 'ai'

/** AI SDK user/system 多模态 content： string 或 文本+图片 段落数组 */
export type AISDKUserContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }>

/** AI SDK tool message: content must be an array of tool-result parts (ModelMessage schema) */
export type AISDKMessage =
  | { role: 'system'; content: AISDKUserContent }
  | { role: 'user'; content: AISDKUserContent }
  | {
      role: 'assistant'
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
          >
    }
  | {
      role: 'tool'
      content: Array<{
        type: 'tool-result'
        toolCallId: string
        toolName: string
        output: { type: 'text'; value: string } | { type: 'error-text'; value: string }
      }>
    }

function getToolNameForCallId(messages: LLMChatMessage[], toolCallId: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && 'tool_calls' in msg && Array.isArray(msg.tool_calls)) {
      const tc = msg.tool_calls.find((c) => c.id === toolCallId)
      if (tc) return tc.function?.name ?? ''
    }
  }
  return ''
}

function mapContentPartsToAISDK(parts: LLMMessageContentPart[]): AISDKUserContent {
  const arr: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }
  > = []
  for (const p of parts) {
    if (p.type === 'text') arr.push({ type: 'text', text: p.text })
    if (p.type === 'image') arr.push({ type: 'image', image: p.image, mimeType: p.mimeType })
  }
  return arr.length === 0 ? '' : arr.length === 1 && arr[0].type === 'text' ? arr[0].text : arr
}

export function mapMessagesToAISDK(messages: LLMChatMessage[]): AISDKMessage[] {
  return messages.map((m, index) => {
    if (m.role === 'system' || m.role === 'user') {
      const content =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content) && m.content.length > 0
          ? mapContentPartsToAISDK(m.content)
          : ''
      return { role: m.role, content }
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
      // AI SDK / OpenAI 兼容层用 part.input 序列化为 function.arguments，须用 input 而非 args
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      > = []
      if (content) parts.push({ type: 'text', text: content })
      for (const tc of toolCalls) {
        let input: unknown = {}
        try {
          input = JSON.parse(tc.arguments || '{}')
        } catch {
          input = {}
        }
        parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input })
      }
      return { role: 'assistant', content: parts }
    }
    if (m.role === 'tool' && 'tool_call_id' in m) {
      const toolCallId = m.tool_call_id
      const text = typeof m.content === 'string' ? m.content : ''
      const toolName = getToolNameForCallId(messages.slice(0, index), toolCallId)
      const isError = text.startsWith('Failed to execute')
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            output: isError ? { type: 'error-text', value: text } : { type: 'text', value: text }
          }
        ]
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
