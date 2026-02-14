/**
 * 统一工具卡片入口 - 根据 name 与 status 分发到对应组件
 */

import type { ToolCallRecord } from '../types'
import { getToolDisplayName, isPrizmTool, isTavilyTool } from './ToolMetadataRegistry'
import { getToolRender } from './ToolRenderRegistry'
import { PrizmToolCard } from './PrizmToolCard'
import { TavilyToolCard } from './TavilyToolCard'

export interface ToolCallCardProps {
  tc: ToolCallRecord
}

export function ToolCallCard({ tc }: ToolCallCardProps) {
  const customRender = getToolRender(tc.name)
  if (customRender) {
    return <>{customRender({ tc })}</>
  }

  if (isTavilyTool(tc.name)) {
    return <TavilyToolCard tc={tc} />
  }

  if (isPrizmTool(tc.name)) {
    return <PrizmToolCard tc={tc} />
  }

  return <DefaultToolCard tc={tc} />
}

function DefaultToolCard({ tc }: { tc: ToolCallRecord }) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)

  if (status === 'preparing') {
    return (
      <div className="tool-card-default tool-card-status-preparing">
        <span className="tool-card-default-name">{displayName}</span>
        <span className="tool-card-default-loading">正在准备参数…</span>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="tool-card-default tool-card-status-running">
        <span className="tool-card-default-name">{displayName}</span>
        <span className="tool-card-default-loading">正在执行…</span>
        {tc.arguments && <pre className="tool-card-default-args">{tc.arguments}</pre>}
      </div>
    )
  }

  return (
    <details className="tool-card-default tool-card-status-done">
      <summary className="tool-card-default-summary">
        <span className="tool-card-default-name">{displayName}</span>
        {tc.isError && <span className="tool-card-default-error">失败</span>}
      </summary>
      <pre className="tool-card-default-args">{tc.arguments || '{}'}</pre>
      <pre className="tool-card-default-result">{tc.result}</pre>
    </details>
  )
}
