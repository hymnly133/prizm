/**
 * Scope 定义与说明
 * 用于 MCP、HTTP 等远程连接服务的 scope 配置及 UI 展示
 */

import { DEFAULT_SCOPE, ONLINE_SCOPE } from './constants'

export interface ScopeInfo {
  id: string
  /** 简短说明，用于 UI 展示 */
  label: string
  /** 详细说明 */
  description: string
}

/** ScopeInfo 子集，用于 API 返回 descriptions 字段 */
export interface ScopeDescription {
  label: string
  description: string
}

/** 内置 scope 的静态说明 */
export const SCOPE_INFOS: Record<string, ScopeInfo> = {
  [DEFAULT_SCOPE]: {
    id: DEFAULT_SCOPE,
    label: '默认工作区',
    description: '默认数据空间，用于通用工作场景。新建客户端未指定 scope 时使用。'
  },
  [ONLINE_SCOPE]: {
    id: ONLINE_SCOPE,
    label: '实时上下文',
    description:
      '用户实时上下文，Electron 客户端常驻显示此 scope 的 TODO 和便签。适合作为 Agent、MCP 的默认操作范围。'
  }
}
