/**
 * 内置工具：文件 list/read/write/move/delete 执行逻辑
 * 写操作通过 FileService 统一处理（事件发射 + 审计）
 */

import * as mdStore from '../../core/mdStore'
import * as fileService from '../../services/fileService'
import { captureFileSnapshot } from '../../core/checkpointStore'
import {
  resolvePath,
  wsTypeLabel,
  OUT_OF_BOUNDS_MSG,
  OUT_OF_BOUNDS_ERROR_CODE
} from '../workspaceResolver'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

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
