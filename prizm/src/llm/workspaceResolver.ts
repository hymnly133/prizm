/**
 * 工作区路径解析模块
 * 为所有内置工具提供统一的路径解析、文件夹解析、workspace 类型判定
 */

import path from 'path'
import * as mdStore from '../core/mdStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'

export type WorkspaceType = 'main' | 'session'

/** 解析后的路径结果 */
export interface ResolvedPath {
  fileRoot: string
  relativePath: string
  wsType: WorkspaceType
}

/** 工作区上下文（由 scope + sessionId 构建） */
export interface WorkspaceContext {
  scopeRoot: string
  sessionWorkspaceRoot: string | null
  sessionId: string | null
}

/**
 * 构建工作区上下文
 */
export function createWorkspaceContext(scopeRoot: string, sessionId?: string): WorkspaceContext {
  return {
    scopeRoot,
    sessionWorkspaceRoot: sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null,
    sessionId: sessionId ?? null
  }
}

/**
 * 解析路径参数：支持相对路径和绝对路径。
 * - 相对路径：根据 wsArg 参数选择根目录
 * - 绝对路径：自动检测属于主工作区还是临时工作区，转换为相对路径
 * 返回 ResolvedPath 或 null（路径越界）
 */
export function resolvePath(
  ctx: WorkspaceContext,
  rawPath: string,
  wsArg?: string
): ResolvedPath | null {
  if (path.isAbsolute(rawPath)) {
    const normalized = path.resolve(rawPath)
    // 优先匹配临时工作区（更精确的路径）
    if (ctx.sessionWorkspaceRoot) {
      const normalizedSession = path.resolve(ctx.sessionWorkspaceRoot)
      if (normalized === normalizedSession || normalized.startsWith(normalizedSession + path.sep)) {
        mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId!)
        const rel =
          normalized === normalizedSession ? '' : path.relative(normalizedSession, normalized)
        return { fileRoot: ctx.sessionWorkspaceRoot, relativePath: rel, wsType: 'session' }
      }
    }
    // 再匹配主工作区
    const normalizedRoot = path.resolve(ctx.scopeRoot)
    if (normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep)) {
      const rel = normalized === normalizedRoot ? '' : path.relative(normalizedRoot, normalized)
      return { fileRoot: ctx.scopeRoot, relativePath: rel, wsType: 'main' }
    }
    return null
  }

  // 相对路径：根据 wsArg 决定根目录
  if (wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot) {
    mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId)
    return { fileRoot: ctx.sessionWorkspaceRoot, relativePath: rawPath, wsType: 'session' }
  }
  return { fileRoot: ctx.scopeRoot, relativePath: rawPath, wsType: 'main' }
}

/**
 * 解析文件夹参数为相对路径。
 * 支持相对路径和绝对路径。绝对路径通过 resolvePath 自动匹配工作区。
 * 返回 { folder, wsType } 或 null（越界）。
 */
export function resolveFolder(
  ctx: WorkspaceContext,
  rawFolder: unknown,
  wsArg?: string
): { folder: string; wsType: WorkspaceType } | null {
  if (typeof rawFolder !== 'string' || !rawFolder.trim()) {
    // 无 folder 时根据 wsArg 确定工作区
    const wsType: WorkspaceType =
      wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot ? 'session' : 'main'
    if (wsType === 'session') {
      mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId!)
    }
    return { folder: '', wsType }
  }
  const folder = rawFolder.trim()

  if (path.isAbsolute(folder)) {
    // 使用 resolvePath 进行绝对路径匹配
    const resolved = resolvePath(ctx, folder)
    if (!resolved) return null
    return { folder: resolved.relativePath, wsType: resolved.wsType }
  }

  // 相对路径
  if (!mdStore.validateRelativePath(folder)) return null
  const wsType: WorkspaceType =
    wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot ? 'session' : 'main'
  if (wsType === 'session') {
    mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId!)
  }
  return { folder, wsType }
}

/**
 * 解析 workspace 参数，返回对应的工作区类型和根路径。
 * 用于文档/待办等不需要具体 path 的操作（如 list）。
 */
export function resolveWorkspaceType(
  ctx: WorkspaceContext,
  wsArg: unknown
): { root: string; wsType: WorkspaceType } {
  if (wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot) {
    mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId)
    return { root: ctx.sessionWorkspaceRoot, wsType: 'session' }
  }
  return { root: ctx.scopeRoot, wsType: 'main' }
}

/** 返回 workspace 标签（用于结果提示） */
export function wsTypeLabel(wsType: WorkspaceType): string {
  return wsType === 'session' ? ' [临时工作区]' : ''
}

/** 路径越界的统一错误提示 */
export const OUT_OF_BOUNDS_MSG =
  '路径不在允许的工作区范围内。只能操作主工作区或会话临时工作区内的文件。'
