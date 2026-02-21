/**
 * @ 引用解析：从用户消息中提取 @(key:value) / @key:id，解析并注入全文上下文
 * 支持三种格式：
 *   1. @(key:value) - chip 序列化格式（推荐），value 可包含路径等特殊字符
 *   2. @(scope:key:value) - 跨 scope 引用格式
 *   3. @key:id - 简写格式（向后兼容），id 仅支持 [a-zA-Z0-9_-]
 */

import path from 'path'
import { getAtReference } from './atReferenceRegistry'
import { resolveResourceType, isResourceType } from '@prizm/shared'
import type { ScopeRefKind } from './scopeItemRegistry'

/** 匹配 @(key:value) 或 @(scope:key:value) chip 格式 */
const AT_REF_PAREN_REGEX = /@\(([\w\u4e00-\u9fa5]+):([^)]+)\)/g

/** 匹配 @key:id 简写格式 —— id 仅限 [a-zA-Z0-9_-] */
const AT_REF_PLAIN_REGEX = /@([\w\u4e00-\u9fa5]+)\s*:\s*([a-zA-Z0-9_-]+)/g

export interface ParsedAtRef {
  key: string
  id: string
  raw: string
  /** 跨 scope 引用时指定的 scope */
  refScope?: string
}

/**
 * 尝试将 @(a:b:c) 拆为 scope:type:id 三段式
 * 如果第二段是有效的 ResourceType，则为跨 scope 引用
 */
function tryParseThreeSegment(
  firstSegment: string,
  rest: string
): { scope: string; key: string; id: string } | null {
  const colonIdx = rest.indexOf(':')
  if (colonIdx <= 0) return null
  const candidateType = rest.slice(0, colonIdx)
  const candidateId = rest.slice(colonIdx + 1)
  if (!candidateId) return null
  const resolvedType = resolveResourceType(candidateType)
  if (resolvedType) {
    return { scope: firstSegment, key: resolvedType, id: candidateId }
  }
  return null
}

/**
 * 从消息中提取所有 @ 引用（两种/三段式格式）
 */
export function extractAtRefs(message: string): ParsedAtRef[] {
  const refs: ParsedAtRef[] = []
  const seen = new Set<string>()

  const addRef = (key: string, id: string, raw: string, refScope?: string) => {
    const dedup = refScope ? `${refScope}:${key}:${id}` : `${key}:${id}`
    if (seen.has(dedup)) return
    seen.add(dedup)
    const def = getAtReference(key)
    if (def) refs.push({ key: def.key, id, raw, refScope })
  }

  let m: RegExpExecArray | null

  // 优先解析 @(key:value) / @(scope:key:value) 格式
  AT_REF_PAREN_REGEX.lastIndex = 0
  while ((m = AT_REF_PAREN_REGEX.exec(message)) !== null) {
    const firstSegment = m[1].toLowerCase()
    const rest = m[2]

    // 尝试三段式 scope:type:id
    const three = tryParseThreeSegment(firstSegment, rest)
    if (three) {
      addRef(three.key, three.id, m[0], three.scope)
    } else {
      addRef(firstSegment, rest, m[0])
    }
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
 * 支持跨 scope 引用（ref.refScope 有值时使用指定 scope 解析）
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

    // 确定解析使用的 scope：显式指定 > 当前 scope
    const resolveScope = ref.refScope ?? scope

    // file 引用特殊处理：id 就是文件路径
    if (ref.key === 'file') {
      const filePath = decodeFilePathFromRef(ref.id)
      const isGranted =
        options?.fileRefPaths?.some((p) => filePath === p || filePath.startsWith(p + path.sep)) ||
        options?.grantedPaths?.some((p) => filePath === p || filePath.startsWith(p + path.sep))
      if (isGranted) {
        newGrantedPaths.push(filePath)
      }
    }

    const detail = await def.resolveRef(resolveScope, ref.id)
    if (!detail) {
      lines.push(`[引用 ${ref.raw} 未找到对应项]`)
      continue
    }
    const kind = REF_KIND_MAP[def.key] ?? (def.key as ScopeRefKind)
    const scopeLabel = ref.refScope ? ` [scope: ${ref.refScope}]` : ''
    resolved.push({
      key: ref.key,
      id: ref.id,
      kind,
      title: detail.title,
      content: detail.content ?? ''
    })
    lines.push(`### @${ref.key}:${ref.id} (${detail.title})${scopeLabel}`)
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
