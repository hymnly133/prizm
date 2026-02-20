/**
 * AgentStepNode — Agent 类型步骤的自定义 ReactFlow 节点
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bot, Cpu } from 'lucide-react'
import type { StepNodeData } from '../workflowEditorUtils'

function AgentStepNodeInner({ data, selected }: NodeProps) {
  const d = data as StepNodeData
  const promptPreview = d.prompt
    ? d.prompt.length > 60 ? d.prompt.slice(0, 60) + '…' : d.prompt
    : '(空 prompt)'

  return (
    <div className={`wfe-node wfe-node--agent${selected ? ' wfe-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="wfe-handle" />
      <div className="wfe-node__header">
        <Bot size={14} className="wfe-node__icon" />
        <span className="wfe-node__title">{d.label}</span>
        {d.model && (
          <span className="wfe-node__badge">
            <Cpu size={10} /> {d.model}
          </span>
        )}
      </div>
      <div className="wfe-node__body">
        <span className="wfe-node__preview">{promptPreview}</span>
      </div>
      {d.condition && (
        <div className="wfe-node__condition">条件: {d.condition}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="wfe-handle" />
    </div>
  )
}

export const AgentStepNode = memo(AgentStepNodeInner)
