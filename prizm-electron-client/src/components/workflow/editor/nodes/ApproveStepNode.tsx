/**
 * ApproveStepNode — 审批类型步骤的自定义 ReactFlow 节点
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ShieldCheck } from 'lucide-react'
import type { StepNodeData } from '../workflowEditorUtils'

function ApproveStepNodeInner({ data, selected }: NodeProps) {
  const d = data as StepNodeData
  const preview = d.approvePrompt
    ? d.approvePrompt.length > 60 ? d.approvePrompt.slice(0, 60) + '…' : d.approvePrompt
    : '(审批提示)'

  return (
    <div className={`wfe-node wfe-node--approve${selected ? ' wfe-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="wfe-handle" />
      <div className="wfe-node__header">
        <ShieldCheck size={14} className="wfe-node__icon" />
        <span className="wfe-node__title">{d.label}</span>
      </div>
      <div className="wfe-node__body">
        <span className="wfe-node__preview">{preview}</span>
      </div>
      {d.condition && (
        <div className="wfe-node__condition">条件: {d.condition}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="wfe-handle" />
    </div>
  )
}

export const ApproveStepNode = memo(ApproveStepNodeInner)
