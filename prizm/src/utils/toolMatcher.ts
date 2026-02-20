/**
 * 共享工具匹配与路径提取函数
 *
 * 统一 hookRegistry / permissionManager / DefaultAgentAdapter 中的重复实现。
 */

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
