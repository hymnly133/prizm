/**
 * Prizm 内置工具卡片 - LobeHub 风格
 * 按 status (preparing/running/done) 特化展示
 */

import type { ToolCallRecord } from '../types'
import { getToolDisplayName, getToolMetadata } from './ToolMetadataRegistry'

export interface PrizmToolCardProps {
  tc: ToolCallRecord
}

function parseArgsSummary(argsStr: string): string {
  try {
    const obj = JSON.parse(argsStr || '{}') as Record<string, unknown>
    const parts: string[] = []
    if (obj.documentId) parts.push(`文档: ${String(obj.documentId).slice(0, 12)}…`)
    else if (obj.noteId) parts.push(`便签: ${String(obj.noteId).slice(0, 12)}…`)
    else if (obj.todoId) parts.push(`待办: ${String(obj.todoId).slice(0, 12)}…`)
    else if (obj.query) parts.push(`关键词: ${String(obj.query).slice(0, 20)}…`)
    else if (obj.title) parts.push(`标题: ${String(obj.title).slice(0, 20)}…`)
    else if (obj.content) parts.push(`内容: ${String(obj.content).slice(0, 30)}…`)
    return parts.join(' ')
  } catch {
    return ''
  }
}

export function PrizmToolCard({ tc }: PrizmToolCardProps) {
  const status = tc.status ?? 'done'
  const displayName = getToolDisplayName(tc.name)
  const meta = getToolMetadata(tc.name)
  const argsSummary = parseArgsSummary(tc.arguments)

  if (status === 'preparing') {
    return (
      <div className="tool-card-prizm tool-card-status-preparing">
        <div className="tool-card-prizm-header">
          <span className="tool-card-prizm-icon">📋</span>
          <span className="tool-card-prizm-name">{displayName}</span>
        </div>
        <div className="tool-card-prizm-loading">正在准备参数…</div>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="tool-card-prizm tool-card-status-running">
        <div className="tool-card-prizm-header">
          <span className="tool-card-prizm-icon">📋</span>
          <span className="tool-card-prizm-name">{displayName}</span>
        </div>
        {argsSummary && <div className="tool-card-prizm-args-summary">{argsSummary}</div>}
        <div className="tool-card-prizm-loading">正在执行…</div>
      </div>
    )
  }

  return (
    <details className="tool-card-prizm tool-card-status-done">
      <summary className="tool-card-prizm-summary">
        <span className="tool-card-prizm-icon">📋</span>
        <span className="tool-card-prizm-name">{displayName}</span>
        {argsSummary && <span className="tool-card-prizm-args-badge">{argsSummary}</span>}
        {tc.isError && <span className="tool-card-prizm-error">失败</span>}
      </summary>
      <div className="tool-card-prizm-body">
        {tc.arguments && <pre className="tool-card-prizm-args">{tc.arguments || '{}'}</pre>}
        <pre className="tool-card-prizm-result">{tc.result}</pre>
        {meta?.docUrl && (
          <a
            href={meta.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tool-card-prizm-doc-link"
          >
            查看文档
          </a>
        )}
      </div>
    </details>
  )
}
