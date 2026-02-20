/**
 * TransformStepNode — 数据变换类型步骤的自定义 ReactFlow 节点
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Shuffle } from 'lucide-react'
import type { StepNodeData } from '../workflowEditorUtils'

function TransformStepNodeInner({ data, selected }: NodeProps) {
  const d = data as StepNodeData
  const preview = d.transform
    ? d.transform.length > 50 ? d.transform.slice(0, 50) + '…' : d.transform
    : '(变换表达式)'

  return (
    <div className={`wfe-node wfe-node--transform${selected ? ' wfe-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="wfe-handle" />
      <div className="wfe-node__header">
        <Shuffle size={14} className="wfe-node__icon" />
        <span className="wfe-node__title">{d.label}</span>
      </div>
      <div className="wfe-node__body">
        <span className="wfe-node__preview wfe-node__preview--mono">{preview}</span>
      </div>
      {d.condition && (
        <div className="wfe-node__condition">条件: {d.condition}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="wfe-handle" />
    </div>
  )
}

export const TransformStepNode = memo(TransformStepNodeInner)
