/**
 * Custom node types for workflow editor
 */

import { AgentStepNode } from './AgentStepNode'
import { ApproveStepNode } from './ApproveStepNode'
import { TransformStepNode } from './TransformStepNode'
import { InputNode } from './InputNode'
import { OutputNode } from './OutputNode'

export const nodeTypes = {
  agentStep: AgentStepNode,
  approveStep: ApproveStepNode,
  transformStep: TransformStepNode,
  inputNode: InputNode,
  outputNode: OutputNode
} as const

export { AgentStepNode, ApproveStepNode, TransformStepNode, InputNode, OutputNode }
