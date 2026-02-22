/**
 * 内置工具：文件 list/read/write/move/delete/grep/glob 执行逻辑
 * 写操作通过 FileService 统一处理（事件发射 + 审计）
 */

import path from 'path'
import * as mdStore from '../../core/mdStore'
import * as fileService from '../../services/fileService'
import { captureFileSnapshot } from '../../core/checkpointStore'
import { ripgrepSearch } from '../../search/ripgrepSearch'
import {
  resolvePath,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import type { BuiltinToolContext, BuiltinToolResult } from './types'
import type { FileEntry } from '../../types'

export async function executeFileList(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg, ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const entries = mdStore.listDirectory(resolved.fileRoot, resolved.relativePath)
  if (!entries.length) return { text: `目录为空或不存在。${wsTypeLabel(resolved.wsType)}` }
  const lines = entries.map((e) => {
    const type = e.isDir ? '[目录]' : '[文件]'
    const extra = e.prizmType ? ` (${e.prizmType})` : ''
    return `- ${type} ${e.relativePath}${extra}`
  })
  return { text: lines.join('\n') + wsTypeLabel(resolved.wsType) }
}

export async function executeFileRead(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg, ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  const result = mdStore.readFileByPath(resolved.fileRoot, resolved.relativePath)
  if (!result)
    return {
      text: `文件不存在或无法读取: ${pathArg}${wsTypeLabel(resolved.wsType)}`,
      isError: true
    }
  ctx.record(resolved.relativePath, 'file', 'read')
  return { text: result.content ?? '(空或二进制文件)' }
}

export async function executeFileWrite(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path : ''
  const content = typeof ctx.args.content === 'string' ? ctx.args.content : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg, ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }

  // 写入前捕获快照（用于 checkpoint 回退）
  if (ctx.sessionId) {
    const existing = mdStore.readFileByPath(resolved.fileRoot, resolved.relativePath)
    captureFileSnapshot(ctx.sessionId, resolved.relativePath, existing?.content ?? null)
  }

  const opCtx = {
    scope: ctx.scope,
    actor: {
      type: 'agent' as const,
      sessionId: ctx.sessionId,
      source: `tool:${ctx.toolName}`
    }
  }

  const ok = await fileService.writeFile(opCtx, resolved.fileRoot, resolved.relativePath, content)
  if (!ok) return { text: `写入失败: ${pathArg}${wsTypeLabel(resolved.wsType)}`, isError: true }

  ctx.record(resolved.relativePath, 'file', 'create')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'create',
    resourceType: 'file',
    resourceId: resolved.relativePath,
    result: 'success'
  })
  return { text: `已写入 ${pathArg}${wsTypeLabel(resolved.wsType)}` }
}

export async function executeFileMove(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const from = typeof ctx.args.from === 'string' ? ctx.args.from : ''
  const to = typeof ctx.args.to === 'string' ? ctx.args.to : ''
  const resolvedFrom = resolvePath(ctx.wsCtx, from, ctx.wsArg, ctx.grantedPaths)
  const resolvedTo = resolvePath(ctx.wsCtx, to, ctx.wsArg, ctx.grantedPaths)
  if (!resolvedFrom || !resolvedTo)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  if (resolvedFrom.fileRoot !== resolvedTo.fileRoot)
    return {
      text: '移动失败：源路径和目标路径必须在同一工作区内。跨工作区请先 read 再 write + delete。',
      isError: true
    }

  if (ctx.sessionId) {
    const existing = mdStore.readFileByPath(resolvedFrom.fileRoot, resolvedFrom.relativePath)
    captureFileSnapshot(ctx.sessionId, resolvedFrom.relativePath, existing?.content ?? null)
  }

  const opCtx = {
    scope: ctx.scope,
    actor: {
      type: 'agent' as const,
      sessionId: ctx.sessionId,
      source: `tool:${ctx.toolName}`
    }
  }

  const ok = await fileService.moveFile(
    opCtx,
    resolvedFrom.fileRoot,
    resolvedFrom.relativePath,
    resolvedTo.relativePath
  )
  if (!ok)
    return {
      text: `移动失败: ${from} -> ${to}${wsTypeLabel(resolvedFrom.wsType)}`,
      isError: true
    }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'update',
    resourceType: 'file',
    resourceId: resolvedTo.relativePath,
    detail: `moved from ${resolvedFrom.relativePath}`,
    result: 'success'
  })
  return { text: `已移动 ${from} -> ${to}${wsTypeLabel(resolvedFrom.wsType)}` }
}

export async function executeFileDelete(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg, ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }

  if (ctx.sessionId) {
    const existing = mdStore.readFileByPath(resolved.fileRoot, resolved.relativePath)
    captureFileSnapshot(ctx.sessionId, resolved.relativePath, existing?.content ?? null)
  }

  const opCtx = {
    scope: ctx.scope,
    actor: {
      type: 'agent' as const,
      sessionId: ctx.sessionId,
      source: `tool:${ctx.toolName}`
    }
  }

  const ok = await fileService.deleteFile(opCtx, resolved.fileRoot, resolved.relativePath)
  if (!ok) return { text: `删除失败: ${pathArg}${wsTypeLabel(resolved.wsType)}`, isError: true }

  ctx.record(resolved.relativePath, 'file', 'delete')
  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'delete',
    resourceType: 'file',
    resourceId: resolved.relativePath,
    result: 'success'
  })
  return { text: `已删除 ${pathArg}${wsTypeLabel(resolved.wsType)}` }
}

/** 递归展平 listDirectory(recursive) 结果为相对路径列表（仅文件） */
function flattenFilePaths(entries: FileEntry[]): string[] {
  const out: string[] = []
  for (const e of entries) {
    if (e.isFile) out.push(e.relativePath)
    if (e.children?.length) out.push(...flattenFilePaths(e.children))
  }
  return out
}

/**
 * 简单 glob 匹配：* 匹配单段内任意字符，** 匹配任意多段。
 * 例：*.ts；** 加 *.md；src 下递归 .ts 等。
 */
function matchGlob(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  const normalizedPattern = pattern.trim().replace(/\\/g, '/')
  if (!normalizedPattern) return true
  const regex = globToRegex(normalizedPattern)
  return regex.test(normalizedPath)
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?')
  return new RegExp(`^${escaped}$`)
}

export async function executeFileGrep(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path.trim() : ''
  const patternArg = typeof ctx.args.pattern === 'string' ? ctx.args.pattern.trim() : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg || '.', ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  if (!patternArg)
    return { text: 'grep 需要指定 pattern（要搜索的文本）', isError: true }

  const searchRoot = path.join(resolved.fileRoot, resolved.relativePath)
  const caseSensitive = ctx.args.caseSensitive === true
  const fileGlob =
    typeof ctx.args.fileGlob === 'string' && ctx.args.fileGlob.trim()
      ? ctx.args.fileGlob.trim()
      : '*.md'
  const maxFiles = Math.min(
    Math.max(0, Number(ctx.args.maxFiles) || 50),
    200
  )
  const maxMatchesPerFile = Math.min(
    Math.max(1, Number(ctx.args.maxMatchesPerFile) || 5),
    20
  )

  const results = await ripgrepSearch(patternArg, searchRoot, {
    glob: fileGlob,
    ignoreCase: !caseSensitive,
    maxFiles,
    maxMatchesPerFile,
    timeoutMs: 10000
  })

  const lines: string[] = []
  for (const file of results) {
    const relPath = path.relative(searchRoot, file.filePath).replace(/\\/g, '/')
    lines.push(`${relPath}:`)
    for (const m of file.matches) {
      lines.push(`  ${m.lineNumber}: ${m.lineText}`)
    }
  }
  if (lines.length === 0)
    return { text: `未找到匹配 "${patternArg}"${wsTypeLabel(resolved.wsType)}` }
  return { text: lines.join('\n') + wsTypeLabel(resolved.wsType) }
}

export async function executeFileGlob(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const pathArg = typeof ctx.args.path === 'string' ? ctx.args.path.trim() : ''
  const pattern = typeof ctx.args.pattern === 'string' ? ctx.args.pattern.trim() : ''
  const resolved = resolvePath(ctx.wsCtx, pathArg || '.', ctx.wsArg, ctx.grantedPaths)
  if (!resolved)
    return { text: `[${OUT_OF_BOUNDS_ERROR_CODE}] ${OUT_OF_BOUNDS_MSG}`, isError: true }
  if (!pattern) return { text: 'glob 需要指定 pattern（如 *.ts、**/*.md）', isError: true }

  const entries = mdStore.listDirectory(resolved.fileRoot, resolved.relativePath, {
    recursive: true,
    includeSystem: false
  })
  const allPaths = flattenFilePaths(entries)
  const matched = allPaths.filter((p) => matchGlob(p, pattern))
  if (matched.length === 0)
    return { text: `未找到匹配 "${pattern}" 的文件。${wsTypeLabel(resolved.wsType)}` }
  const lines = matched.slice(0, 500).map((p) => `- ${p}`)
  const tail = matched.length > 500 ? `\n... 共 ${matched.length} 个文件，仅显示前 500 个` : ''
  return { text: lines.join('\n') + tail + wsTypeLabel(resolved.wsType) }
}
