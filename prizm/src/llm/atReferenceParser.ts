/**
 * @ 引用解析：从用户消息中提取 @(key:value) / @key:id，解析并注入全文上下文
 * 支持两种格式：
 *   1. @(key:value) - chip 序列化格式（推荐），value 可包含路径等特殊字符
 *   2. @key:id - 简写格式（向后兼容），id 仅支持 [a-zA-Z0-9_-]
 */

import path from 'path'
import { getAtReference } from './atReferenceRegistry'
import type { ScopeRefKind } from './scopeItemRegistry'

/** 匹配 @(key:value) chip 格式 —— value 可为任意非 ) 字符 */
const AT_REF_PAREN_REGEX = /@\(([\w\u4e00-\u9fa5]+):([^)]+)\)/g

/** 匹配 @key:id 简写格式 —— id 仅限 [a-zA-Z0-9_-] */
const AT_REF_PLAIN_REGEX = /@([\w\u4e00-\u9fa5]+)\s*:\s*([a-zA-Z0-9_-]+)/g

export interface ParsedAtRef {
  key: string
  id: string
  raw: string
}

/**
 * 从消息中提取所有 @ 引用（两种格式）
 */
export function extractAtRefs(message: string): ParsedAtRef[] {
  const refs: ParsedAtRef[] = []
  const seen = new Set<string>()

  const addRef = (key: string, id: string, raw: string) => {
    const dedup = `${key}:${id}`
    if (seen.has(dedup)) return
    seen.add(dedup)
    const def = getAtReference(key)
    if (def) refs.push({ key: def.key, id, raw })
  }

  // 优先解析 @(key:value) 格式
  let m: RegExpExecArray | null
  AT_REF_PAREN_REGEX.lastIndex = 0
  while ((m = AT_REF_PAREN_REGEX.exec(message)) !== null) {
    addRef(m[1].toLowerCase(), m[2], m[0])
  }

  // 再解析 @key:id 简写格式
  AT_REF_PLAIN_REGEX.lastIndex = 0
  while ((m = AT_REF_PLAIN_REGEX.exec(message)) !== null) {
    addRef(m[1].toLowerCase(), m[2], m[0])
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
  note: 'document',
  doc: 'document',
  todo: 'todo'
}

export interface ResolveOptions {
  /** 来自请求的 fileRefs 路径列表，用于自动授权 */
  fileRefPaths?: string[]
  /** 当前会话已授权的路径列表 */
  grantedPaths?: string[]
}

/**
 * 解析引用并返回可注入的上下文块与解析结果
 * 对于 file 类型引用，会检查路径是否在授权范围内
 */
export async function resolveAtRefs(
  scope: string,
  sessionId: string | undefined,
  refs: ParsedAtRef[],
  options?: ResolveOptions
): Promise<{ injectedPrefix: string; resolved: ResolvedRef[]; newGrantedPaths?: string[] }> {
  const resolved: ResolvedRef[] = []
  const lines: string[] = []
  const newGrantedPaths: string[] = []

  for (const ref of refs) {
    const def = getAtReference(ref.key)
    if (!def) continue

    // file 引用特殊处理：id 就是文件路径
    if (ref.key === 'file') {
      const filePath = decodeFilePathFromRef(ref.id)
      // 检查是否在授权路径中（fileRefs 自动授权 + 已有 grantedPaths）
      const isGranted =
        options?.fileRefPaths?.some((p) => filePath === p || filePath.startsWith(p + path.sep)) ||
        options?.grantedPaths?.some((p) => filePath === p || filePath.startsWith(p + path.sep))
      if (isGranted) {
        newGrantedPaths.push(filePath)
      }
    }

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
    ? '以下为用户引用的内容：\n\n' + lines.join('\n') + '\n---\n\n'
    : ''
  return {
    injectedPrefix,
    resolved,
    newGrantedPaths: newGrantedPaths.length > 0 ? newGrantedPaths : undefined
  }
}

/** 解码 file 引用中的路径（还原 %29 → )） */
function decodeFilePathFromRef(encoded: string): string {
  return encoded.replace(/%29/g, ')')
}

/**
 * 处理用户消息：提取 @ 引用、解析、生成注入前缀
 * 返回注入前缀与原始消息（保留 @ 语法供 LLM 理解）
 */
export async function processMessageAtRefs(
  scope: string,
  sessionId: string | undefined,
  userMessage: string,
  options?: ResolveOptions
): Promise<{ injectedPrefix: string; message: string; newGrantedPaths?: string[] }> {
  const refs = extractAtRefs(userMessage)
  if (!refs.length) return { injectedPrefix: '', message: userMessage }
  const { injectedPrefix, newGrantedPaths } = await resolveAtRefs(scope, sessionId, refs, options)
  return { injectedPrefix, message: userMessage, newGrantedPaths }
}
