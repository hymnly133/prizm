/**
 * 资源引用注册表 — 类型定义
 */

import type { ResourceType } from '@prizm/shared'

/** 资源引用项（列表/补全用） */
export interface ResourceRefItem {
  id: string
  type: ResourceType
  title: string
  /** 字符长度（内容量估算） */
  charCount: number
  updatedAt: number
  /** 附加分组/状态标签 */
  groupOrStatus?: string
}

/** 资源引用详情（解析用，含全文） */
export interface ResourceRefDetail extends ResourceRefItem {
  content: string
  summary?: string
}

/** 资源引用定义 — 每种资源类型注册一个 */
export interface ResourceRefDef {
  type: ResourceType
  /** 在指定 scope 内列出资源（listable=true 的类型必须实现） */
  list?(scope: string, limit?: number): Promise<ResourceRefItem[]>
  /** 在指定 scope 内按 ID 解析资源详情 */
  resolve(scope: string, id: string): Promise<ResourceRefDetail | null>
  /** 跨 scope 按 ID 解析（遍历所有 scope 查找） */
  crossScopeResolve?(id: string): Promise<{ scope: string; detail: ResourceRefDetail } | null>
}
