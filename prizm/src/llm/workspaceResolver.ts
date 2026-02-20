/**
 * 工作区路径解析模块
 * 为所有内置工具提供统一的路径解析、文件夹解析、workspace 类型判定
 */

import path from 'path'
import * as mdStore from '../core/mdStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'

export type WorkspaceType = 'main' | 'session' | 'workflow' | 'granted'

/** 解析后的路径结果 */
export interface ResolvedPath {
  fileRoot: string
  relativePath: string
  wsType: WorkspaceType
}

/** 工作区上下文（由 scope + sessionId + 可选 workflowWorkspace 构建） */
export interface WorkspaceContext {
  scopeRoot: string
  sessionWorkspaceRoot: string | null
  workflowWorkspaceRoot: string | null
  sessionId: string | null
}

/**
 * 构建工作区上下文
 */
export function createWorkspaceContext(
  scopeRoot: string,
  sessionId?: string,
  workflowWorkspaceDir?: string
): WorkspaceContext {
  return {
    scopeRoot,
    sessionWorkspaceRoot: sessionId ? getSessionWorkspaceDir(scopeRoot, sessionId) : null,
    workflowWorkspaceRoot: workflowWorkspaceDir ?? null,
    sessionId: sessionId ?? null
  }
}

/**
 * 解析路径参数：支持相对路径和绝对路径。
 * - 相对路径：根据 wsArg 参数选择根目录
 * - 绝对路径：自动检测属于主工作区、临时工作区或授权路径，转换为相对路径
 * - grantedPaths：用户显式授权的外部文件/文件夹路径
 * 返回 ResolvedPath 或 null（路径越界）
 */
export function resolvePath(
  ctx: WorkspaceContext,
  rawPath: string,
  wsArg?: string,
  grantedPaths?: string[]
): ResolvedPath | null {
  if (path.isAbsolute(rawPath)) {
    const normalized = path.resolve(rawPath)
    // 优先匹配 workflow 工作区（最精确）
    if (ctx.workflowWorkspaceRoot) {
      const normalizedWf = path.resolve(ctx.workflowWorkspaceRoot)
      if (normalized === normalizedWf || normalized.startsWith(normalizedWf + path.sep)) {
        const rel = normalized === normalizedWf ? '' : path.relative(normalizedWf, normalized)
        return { fileRoot: ctx.workflowWorkspaceRoot, relativePath: rel, wsType: 'workflow' }
      }
    }
    // 再匹配 session 临时工作区
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
    // 检查授权路径
    if (grantedPaths?.length) {
      for (const granted of grantedPaths) {
        const normalizedGranted = path.resolve(granted)
        if (
          normalized === normalizedGranted ||
          normalized.startsWith(normalizedGranted + path.sep)
        ) {
          const parentDir = path.dirname(normalizedGranted)
          const rel = path.relative(parentDir, normalized)
          return { fileRoot: parentDir, relativePath: rel, wsType: 'granted' }
        }
      }
    }
    return null
  }

  // 相对路径：根据 wsArg 决定根目录
  if (wsArg === 'workflow' && ctx.workflowWorkspaceRoot) {
    return { fileRoot: ctx.workflowWorkspaceRoot, relativePath: rawPath, wsType: 'workflow' }
  }
  if (wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot) {
    mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId)
    return { fileRoot: ctx.sessionWorkspaceRoot, relativePath: rawPath, wsType: 'session' }
  }
  // 有 workflow 工作区时默认使用它（BG Session 在 workflow 上下文中）
  if (ctx.workflowWorkspaceRoot && !wsArg) {
    return { fileRoot: ctx.workflowWorkspaceRoot, relativePath: rawPath, wsType: 'workflow' }
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
  wsArg?: string,
  grantedPaths?: string[]
): { folder: string; wsType: WorkspaceType } | null {
  if (typeof rawFolder !== 'string' || !rawFolder.trim()) {
    const wsType = resolveDefaultWsType(ctx, wsArg)
    if (wsType === 'session') {
      mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId!)
    }
    return { folder: '', wsType }
  }
  const folder = rawFolder.trim()

  if (path.isAbsolute(folder)) {
    const resolved = resolvePath(ctx, folder, undefined, grantedPaths)
    if (!resolved) return null
    return { folder: resolved.relativePath, wsType: resolved.wsType }
  }

  // 相对路径
  if (!mdStore.validateRelativePath(folder)) return null
  const wsType = resolveDefaultWsType(ctx, wsArg)
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
  if (wsArg === 'workflow' && ctx.workflowWorkspaceRoot) {
    return { root: ctx.workflowWorkspaceRoot, wsType: 'workflow' }
  }
  if (wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot) {
    mdStore.ensureSessionWorkspace(ctx.scopeRoot, ctx.sessionId)
    return { root: ctx.sessionWorkspaceRoot, wsType: 'session' }
  }
  if (ctx.workflowWorkspaceRoot && !wsArg) {
    return { root: ctx.workflowWorkspaceRoot, wsType: 'workflow' }
  }
  return { root: ctx.scopeRoot, wsType: 'main' }
}

/** 返回 workspace 标签（用于结果提示），独占一行避免与内容混淆 */
export function wsTypeLabel(wsType: WorkspaceType): string {
  if (wsType === 'workflow') return '\n(工作流工作区)'
  if (wsType === 'session') return '\n(临时工作区)'
  if (wsType === 'granted') return '\n(授权路径)'
  return ''
}

/** 根据 wsArg 和上下文确定默认工作区类型 */
function resolveDefaultWsType(ctx: WorkspaceContext, wsArg?: string): WorkspaceType {
  if (wsArg === 'workflow' && ctx.workflowWorkspaceRoot) return 'workflow'
  if (wsArg === 'session' && ctx.sessionId && ctx.sessionWorkspaceRoot) return 'session'
  if (ctx.workflowWorkspaceRoot && !wsArg) return 'workflow'
  return 'main'
}

/** 路径越界的统一错误提示 */
export const OUT_OF_BOUNDS_MSG =
  '路径不在允许的工作区范围内。只能操作主工作区、工作流工作区、会话临时工作区或用户授权的路径内的文件。'

/** 路径越界错误标识符，客户端可据此识别需要授权的情况 */
export const OUT_OF_BOUNDS_ERROR_CODE = 'OUT_OF_BOUNDS'
