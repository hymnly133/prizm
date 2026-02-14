/**
 * Prizm Scope 定义与说明
 * 用于 MCP、HTTP 等远程连接服务的 scope 配置及 UI 展示
 */

import type { ScopeInfo } from '@prizm/shared'
import { SCOPE_INFOS } from '@prizm/shared'

export type { ScopeInfo } from '@prizm/shared'
export { SCOPE_INFOS } from '@prizm/shared'

/**
 * 获取 scope 说明，自定义 scope 返回通用描述
 */
export function getScopeInfo(scopeId: string): ScopeInfo {
  return (
    SCOPE_INFOS[scopeId] ?? {
      id: scopeId,
      label: scopeId,
      description: `自定义工作区 "${scopeId}"，用于隔离特定项目或场景的数据。`
    }
  )
}

/**
 * 获取所有 scope 的说明（含内置 + 传入的自定义 scope 列表）
 */
export function getScopeInfos(scopeIds: string[]): ScopeInfo[] {
  const seen = new Set<string>()
  const result: ScopeInfo[] = []
  for (const id of scopeIds) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(getScopeInfo(id))
    }
  }
  return result
}
