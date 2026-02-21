/**
 * 共享工具匹配与路径提取函数
 *
 * 统一 hookRegistry / permissionManager / DefaultAgentAdapter 中的重复实现。
 */

import type { InteractDetails } from '../core/toolPermission/types'

/**
 * 简单的 glob 匹配：支持 * 通配和精确匹配。
 * 用于工具名 pattern 匹配（hook toolMatcher / permission rule toolPattern）。
 */
export function matchToolPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === value
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

/**
 * 从工具参数中提取涉及的文件路径。
 * 检查常用的路径参数名：path / from / to。
 */
export function extractToolPaths(args: Record<string, unknown>): string[] {
  const paths: string[] = []
  if (typeof args.path === 'string' && args.path.trim()) paths.push(args.path.trim())
  if (typeof args.from === 'string' && args.from.trim()) paths.push(args.from.trim())
  if (typeof args.to === 'string' && args.to.trim()) paths.push(args.to.trim())
  return paths
}

/**
 * 从工具名 + 参数提取交互详情，按工具类型返回不同的 InteractDetails。
 */
export function extractInteractDetails(
  toolName: string,
  args: Record<string, unknown>
): InteractDetails {
  const action = typeof args.action === 'string' ? args.action : ''

  if (toolName === 'prizm_file') {
    const paths = extractToolPaths(args)
    return { kind: 'file_access', paths }
  }

  if (toolName.startsWith('prizm_terminal_')) {
    const command = typeof args.command === 'string' ? args.command : toolName
    const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
    return { kind: 'terminal_command', command, cwd }
  }

  if (toolName === 'prizm_document') {
    const docId = typeof args.documentId === 'string' ? args.documentId : ''
    const title = typeof args.title === 'string' ? args.title : ''
    const desc = action === 'delete'
      ? `Delete document "${title || docId}"`
      : action === 'create'
        ? `Create document "${title}"`
        : `Update document "${title || docId}"`
    return {
      kind: 'destructive_operation',
      resourceType: 'document',
      resourceId: docId,
      description: desc
    }
  }

  if (toolName === 'prizm_cron') {
    const jobId = typeof args.jobId === 'string' ? args.jobId : ''
    const name = typeof args.name === 'string' ? args.name : ''
    const desc = action === 'delete'
      ? `Delete cron job "${name || jobId}"`
      : `Create cron job "${name}"`
    return {
      kind: 'destructive_operation',
      resourceType: 'cron_job',
      resourceId: jobId,
      description: desc
    }
  }

  const paths = extractToolPaths(args)
  if (paths.length > 0) {
    return { kind: 'file_access', paths }
  }

  return {
    kind: 'custom',
    title: toolName,
    description: `Tool ${toolName} requires approval (action: ${action || 'unknown'})`
  }
}

/** 从工具参数中提取 action 字段 */
export function extractToolAction(args: Record<string, unknown>): string {
  const a = args.action ?? args.mode
  return typeof a === 'string' ? a : ''
}
