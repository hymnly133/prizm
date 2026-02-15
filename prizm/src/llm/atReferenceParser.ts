/**
 * @ 引用解析：从用户消息中提取 @key:id / @alias:id，解析并注入全文上下文
 */

import { getAtReference } from './atReferenceRegistry'
import type { ScopeRefKind } from './scopeItemRegistry'

/** 匹配 @key:id 或 @key: id，key 可为字母、数字、中文等 */
const AT_REF_REGEX = /@([\w\u4e00-\u9fa5]+)\s*:\s*([a-zA-Z0-9_-]+)/g

export interface ParsedAtRef {
  key: string
  id: string
  raw: string
}

/**
 * 从消息中提取所有 @key:id 引用
 */
export function extractAtRefs(message: string): ParsedAtRef[] {
  const refs: ParsedAtRef[] = []
  let m: RegExpExecArray | null
  AT_REF_REGEX.lastIndex = 0
  while ((m = AT_REF_REGEX.exec(message)) !== null) {
    const key = m[1].toLowerCase()
    const id = m[2]
    const def = getAtReference(key)
    if (def) refs.push({ key: def.key, id, raw: m[0] })
  }
  return refs
}

export interface ResolvedRef {
  key: string
  id: string
  kind: ScopeRefKind
  title: string
  content: string
}

const REF_KIND_MAP: Record<string, ScopeRefKind> = {
  note: 'note',
  doc: 'document',
  todo: 'todo'
}

/**
 * 解析引用并返回可注入的上下文块与解析结果；同时记录 provision
 */
export async function resolveAtRefs(
  scope: string,
  sessionId: string | undefined,
  refs: ParsedAtRef[]
): Promise<{ injectedPrefix: string; resolved: ResolvedRef[] }> {
  const resolved: ResolvedRef[] = []
  const lines: string[] = []

  for (const ref of refs) {
    const def = getAtReference(ref.key)
    if (!def) continue
    const detail = await def.resolveRef(scope, ref.id)
    if (!detail) {
      lines.push(`[引用 ${ref.raw} 未找到对应项]`)
      continue
    }
    const kind = REF_KIND_MAP[def.key] ?? (def.key as ScopeRefKind)
    resolved.push({
      key: ref.key,
      id: ref.id,
      kind,
      title: detail.title,
      content: detail.content ?? ''
    })
    lines.push(`### @${ref.key}:${ref.id} (${detail.title})`)
    lines.push(detail.content?.trim() || '(空)')
    lines.push('')
  }

  const injectedPrefix = lines.length
    ? '以下为用户引用的工作区内容：\n\n' + lines.join('\n') + '\n---\n\n'
    : ''
  return { injectedPrefix, resolved }
}

/**
 * 处理用户消息：提取 @ 引用、解析、生成注入前缀；返回注入前缀与原始消息（保留 @ 语法供 LLM 理解）
 */
export async function processMessageAtRefs(
  scope: string,
  sessionId: string | undefined,
  userMessage: string
): Promise<{ injectedPrefix: string; message: string }> {
  const refs = extractAtRefs(userMessage)
  if (!refs.length) return { injectedPrefix: '', message: userMessage }
  const { injectedPrefix } = await resolveAtRefs(scope, sessionId, refs)
  return { injectedPrefix, message: userMessage }
}
