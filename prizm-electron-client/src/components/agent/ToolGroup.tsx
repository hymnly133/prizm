/**
 * ToolGroup — 精简模式下连续工具调用的分组折叠容器
 *
 * 显示一个可点击的摘要头："N 个工具调用 [成功/失败统计]"
 * 点击展开显示 inline badge 列表。
 */
import { memo, useState, useCallback } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import { Icon } from '@lobehub/ui'
import type { ToolCallRecord } from '@prizm/client-core'
import { ToolCallBadge } from './ToolCallBadge'

export interface ToolGroupProps {
  tools: ToolCallRecord[]
}

export const ToolGroup = memo(function ToolGroup({ tools }: ToolGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const errorCount = tools.filter((t) => t.isError).length
  const successCount = tools.length - errorCount

  return (
    <div className="tool-group">
      <div className="tool-group__header" role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
      }}>
        <Icon icon={Wrench} size={12} />
        <span>{tools.length} 个工具调用</span>
        <span className={`tool-group__stats${errorCount > 0 ? ' tool-group__stats--has-error' : ''}`}>
          {errorCount > 0
            ? `${successCount} 成功, ${errorCount} 失败`
            : '全部成功'}
        </span>
        <ChevronDown
          size={12}
          className={`tool-group__chevron${expanded ? ' tool-group__chevron--open' : ''}`}
        />
      </div>
      {expanded && (
        <div className="tool-group__badges">
          {tools.map((tc) => (
            <ToolCallBadge key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  )
})
