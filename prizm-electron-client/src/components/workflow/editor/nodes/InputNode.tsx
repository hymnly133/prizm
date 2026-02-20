/**
 * InputNode — 工作流输入参数节点
 *
 * 位于画布顶部，展示工作流 args schema，只有 source handle（输出端）。
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { LogIn } from 'lucide-react'
import type { IONodeData } from '../workflowEditorUtils'

function InputNodeInner({ data, selected }: NodeProps) {
  const d = data as IONodeData
  const fields = d.ioFields ?? {}
  const entries = Object.entries(fields)

  return (
    <div className={`wfe-node wfe-node--input${selected ? ' wfe-node--selected' : ''}`}>
      <div className="wfe-node__header">
        <LogIn size={14} className="wfe-node__icon" />
        <span className="wfe-node__title">输入参数</span>
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
          <span className="wfe-node__preview">(无参数)</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="wfe-handle" />
    </div>
  )
}

export const InputNode = memo(InputNodeInner)
