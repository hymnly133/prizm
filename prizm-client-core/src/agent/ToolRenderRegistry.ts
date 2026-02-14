/**
 * 工具自定义展示组件注册表
 * 支持按 toolName 注册自定义 React 组件
 */

import type { ReactNode } from 'react'
import type { ToolCallRecord } from '../types'

export type ToolRenderFn = (props: { tc: ToolCallRecord }) => ReactNode

const registry = new Map<string, ToolRenderFn>()

export function registerToolRender(toolName: string, render: ToolRenderFn): void {
  registry.set(toolName, render)
}

export function getToolRender(toolName: string): ToolRenderFn | undefined {
  return registry.get(toolName)
}

export function unregisterToolRender(toolName: string): void {
  registry.delete(toolName)
}
