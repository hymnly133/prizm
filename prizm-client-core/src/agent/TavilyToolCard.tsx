/**
 * Tavily 联网搜索工具卡片 - LobeHub 风格
 * 按 status (preparing/running/done) 特化展示
 */

import type { ToolCallRecord } from '../types'
import { getToolDisplayName, getToolMetadata } from './ToolMetadataRegistry'

export interface TavilyToolCardProps {
  tc: ToolCallRecord
}

function parseQuery(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as { query?: string }
    return typeof obj.query === 'string' ? obj.query : ''
  } catch {
    return ''
  }
}

export function TavilyToolCard({ tc }: TavilyToolCardProps) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const meta = getToolMetadata(tc.name)
  const query = parseQuery(tc.arguments)

  if (status === 'preparing') {
    return (
      <div className="tool-card-tavily tool-card-status-preparing">
        <div className="tool-card-tavily-header">
          <span className="tool-card-tavily-icon">🔍</span>
          <span className="tool-card-tavily-name">{displayName}</span>
        </div>
        <div className="tool-card-tavily-loading">正在准备参数…</div>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="tool-card-tavily tool-card-status-running">
        <div className="tool-card-tavily-header">
          <span className="tool-card-tavily-icon">🔍</span>
          <span className="tool-card-tavily-name">{displayName}</span>
        </div>
        {query && <div className="tool-card-tavily-query">{query}</div>}
        <div className="tool-card-tavily-loading">正在搜索…</div>
      </div>
    )
  }

  const resultCount = tc.result ? (tc.result.match(/\n\n---\n\n/g)?.length ?? 0) + 1 : 0

  return (
    <details className="tool-card-tavily tool-card-status-done">
      <summary className="tool-card-tavily-summary">
        <span className="tool-card-tavily-icon">🔍</span>
        <span className="tool-card-tavily-name">{displayName}</span>
        {query && <span className="tool-card-tavily-query-badge">{query}</span>}
        {resultCount > 0 && <span className="tool-card-tavily-count">{resultCount} 条结果</span>}
        {tc.isError && <span className="tool-card-tavily-error">失败</span>}
      </summary>
      <div className="tool-card-tavily-body">
        {query && <div className="tool-card-tavily-query-full">搜索词: {query}</div>}
        <pre className="tool-card-tavily-result">{tc.result}</pre>
        {meta?.docUrl && (
          <a
            href={meta.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tool-card-tavily-doc-link"
          >
            查看 Tavily 文档
          </a>
        )}
      </div>
    </details>
  )
}
