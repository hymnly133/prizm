/**
 * OutputNode — 工作流输出参数节点
 *
 * 位于画布底部，展示工作流 outputs schema，只有 target handle（输入端）。
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { LogOut } from 'lucide-react'
import type { IONodeData } from '../workflowEditorUtils'

function OutputNodeInner({ data, selected }: NodeProps) {
  const d = data as IONodeData
  const fields = d.ioFields ?? {}
  const entries = Object.entries(fields)

  return (
    <div className={`wfe-node wfe-node--output${selected ? ' wfe-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="wfe-handle" />
      <div className="wfe-node__header">
        <LogOut size={14} className="wfe-node__icon" />
        <span className="wfe-node__title">输出结果</span>
      </div>
      <div className="wfe-node__body">
        {entries.length > 0 ? (
          <div className="wfe-node__fields">
            {entries.map(([name, def]) => (
              <span key={name} className="wfe-node__field-tag">
                {name}{def.type ? `: ${def.type}` : ''}
              </span>
            ))}
          </div>
        ) : (
          <span className="wfe-node__preview">(无输出定义)</span>
        )}
      </div>
    </div>
  )
}

export const OutputNode = memo(OutputNodeInner)
