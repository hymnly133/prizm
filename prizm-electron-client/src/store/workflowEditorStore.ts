/**
 * workflowEditorStore — 工作流可视化编辑器专用状态管理
 *
 * 管理画布 nodes/edges、全局元数据、选中状态、dirty 标记、undo/redo 快照。
 */

import { create } from 'zustand'
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection
} from '@xyflow/react'
import { message } from 'antd'
import type { WorkflowDef, WorkflowDefConfig, WorkflowStepType, WorkflowTriggerDef } from '@prizm/shared'
import {
  defToFlow,
  flowToDef,
  applyDagreLayout,
  generateStepId,
  createDefaultStepData,
  INPUT_NODE_ID,
  OUTPUT_NODE_ID,
  type StepNode,
  type StepNodeData,
  type EditorNode,
  type IONodeData
} from '../components/workflow/editor/workflowEditorUtils'

interface Snapshot {
  nodes: EditorNode[]
  edges: Edge[]
}

const MAX_UNDO = 50

export interface WorkflowEditorState {
  nodes: EditorNode[]
  edges: Edge[]

  workflowName: string
  workflowDescription: string
  workflowArgs: WorkflowDef['args']
  workflowOutputs: WorkflowDef['outputs']
  workflowTriggers: WorkflowTriggerDef[]
  workflowConfig: WorkflowDefConfig | undefined

  selectedNodeId: string | null
  dirty: boolean

  undoStack: Snapshot[]
  redoStack: Snapshot[]

  // ReactFlow callbacks
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: (connection: Connection) => void
  onNodeClick: (nodeId: string) => void
  onPaneClick: () => void

  // Mutations
  addStep: (type: WorkflowStepType) => void
  addIONode: (kind: 'input' | 'output') => void
  deleteSelected: () => void
  duplicateSelected: () => void
  updateNodeData: (nodeId: string, data: Partial<StepNodeData> | Partial<IONodeData>) => void
  renameStep: (oldId: string, newId: string) => void
  setWorkflowMeta: (meta: { name?: string; description?: string; args?: WorkflowDef['args']; outputs?: WorkflowDef['outputs']; triggers?: WorkflowTriggerDef[]; config?: WorkflowDefConfig }) => void

  // Serialization
  loadFromDef: (def: WorkflowDef) => void
  exportToDef: () => WorkflowDef
  autoLayout: () => void

  // Undo/redo
  undo: () => void
  redo: () => void

  // Reset
  reset: () => void
}

function snapshot(state: { nodes: EditorNode[]; edges: Edge[] }): Snapshot {
  return {
    nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data } })) as EditorNode[],
    edges: state.edges.map((e) => ({ ...e }))
  }
}

function isIONodeId(id: string): boolean {
  return id === INPUT_NODE_ID || id === OUTPUT_NODE_ID
}

export const useWorkflowEditorStore = create<WorkflowEditorState>()((set, get) => ({
  nodes: [],
  edges: [],
  workflowName: '',
  workflowDescription: '',
  workflowArgs: undefined,
  workflowOutputs: undefined,
  workflowTriggers: [],
  workflowConfig: undefined,
  selectedNodeId: null,
  dirty: false,
  undoStack: [],
  redoStack: [],

  onNodesChange: (changes) => {
    // Prevent removal of IO nodes
    const filteredChanges = changes.filter((c) => {
      if (c.type === 'remove' && isIONodeId(c.id)) return false
      return true
    })
    set((state) => ({
      nodes: applyNodeChanges(filteredChanges, state.nodes as Node[]) as EditorNode[],
      dirty: true
    }))
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      dirty: true
    }))
  },

  onConnect: (connection) => {
    const { nodes, edges } = get()
    const source = connection.source!
    const target = connection.target!

    // Serial pipeline: each step node may have at most one outgoing edge to another step node
    const isStepNode = (id: string) => id !== INPUT_NODE_ID && id !== OUTPUT_NODE_ID
    if (isStepNode(source) && isStepNode(target)) {
      const hasOutToStep = edges.some(
        (e) => e.source === source && e.target !== OUTPUT_NODE_ID
      )
      if (hasOutToStep) {
        message.warning('当前仅支持串行流水线，每步只能有一个后继步骤。请先断开已有连线再连接。')
        return
      }
    }

    pushUndo(get)
    const id = `${source}->${target}`
    if (edges.some((e) => e.id === id)) return

    set({
      edges: [...edges, { id, source, target, animated: false }],
      dirty: true
    })
  },

  onNodeClick: (nodeId) => {
    set({ selectedNodeId: nodeId })
  },

  onPaneClick: () => {
    set({ selectedNodeId: null })
  },

  addStep: (type) => {
    const { nodes, edges } = get()
    pushUndo(get)

    const existingIds = new Set(nodes.map((n) => n.id))
    const id = generateStepId(type, existingIds)
    const data = createDefaultStepData(type, id)

    // Insert before output node if present, otherwise after the last step node
    const outputIdx = nodes.findIndex((n) => n.id === OUTPUT_NODE_ID)
    const stepNodes = nodes.filter((n) => !isIONodeId(n.id))
    const lastStepNode = stepNodes[stepNodes.length - 1]
    const y = lastStepNode ? lastStepNode.position.y + 140 : 40
    const x = lastStepNode ? lastStepNode.position.x : 100

    const newNode: StepNode = {
      id,
      type: type === 'agent' ? 'agentStep' : type === 'approve' ? 'approveStep' : 'transformStep',
      position: { x, y },
      data
    }

    const newEdges = [...edges]
    // Remove edge from last step to output, we'll re-link
    if (lastStepNode && outputIdx >= 0) {
      const edgeToOutput = newEdges.findIndex((e) => e.source === lastStepNode.id && e.target === OUTPUT_NODE_ID)
      if (edgeToOutput >= 0) newEdges.splice(edgeToOutput, 1)
    }
    if (lastStepNode) {
      newEdges.push({ id: `${lastStepNode.id}->${id}`, source: lastStepNode.id, target: id })
    }
    if (outputIdx >= 0) {
      newEdges.push({ id: `${id}->${OUTPUT_NODE_ID}`, source: id, target: OUTPUT_NODE_ID })
    }

    // Insert before output node if it exists
    const newNodes = [...nodes]
    if (outputIdx >= 0) {
      newNodes.splice(outputIdx, 0, newNode)
      // Shift output node down
      const oNode = newNodes[outputIdx + 1]
      if (oNode) oNode.position = { ...oNode.position, y: y + 140 }
    } else {
      newNodes.push(newNode)
    }

    set({
      nodes: newNodes as EditorNode[],
      edges: newEdges,
      selectedNodeId: id,
      dirty: true
    })
  },

  addIONode: (kind) => {
    const { nodes, edges } = get()
    const nodeId = kind === 'input' ? INPUT_NODE_ID : OUTPUT_NODE_ID
    if (nodes.some((n) => n.id === nodeId)) return

    pushUndo(get)
    const stepNodes = nodes.filter((n) => !isIONodeId(n.id))

    const ioNode: EditorNode = {
      id: nodeId,
      type: kind === 'input' ? 'inputNode' : 'outputNode',
      position: kind === 'input'
        ? { x: 100, y: 0 }
        : { x: 100, y: (stepNodes[stepNodes.length - 1]?.position.y ?? 0) + 140 },
      data: { nodeKind: kind, label: kind === 'input' ? '输入参数' : '输出结果', ioFields: {} } as IONodeData
    }

    const newNodes = [...nodes]
    const newEdges = [...edges]

    if (kind === 'input') {
      newNodes.unshift(ioNode)
      if (stepNodes.length > 0) {
        newEdges.push({ id: `${nodeId}->${stepNodes[0].id}`, source: nodeId, target: stepNodes[0].id, animated: true })
      }
    } else {
      newNodes.push(ioNode)
      if (stepNodes.length > 0) {
        newEdges.push({ id: `${stepNodes[stepNodes.length - 1].id}->${nodeId}`, source: stepNodes[stepNodes.length - 1].id, target: nodeId, animated: true })
      }
    }

    set({ nodes: newNodes, edges: newEdges, selectedNodeId: nodeId, dirty: true })
  },

  deleteSelected: () => {
    const { selectedNodeId, nodes, edges } = get()
    if (!selectedNodeId) return
    if (isIONodeId(selectedNodeId)) return
    pushUndo(get)

    set({
      nodes: nodes.filter((n) => n.id !== selectedNodeId),
      edges: edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
      selectedNodeId: null,
      dirty: true
    })
  },

  duplicateSelected: () => {
    const { selectedNodeId, nodes, edges } = get()
    if (!selectedNodeId || isIONodeId(selectedNodeId)) return
    const sourceNode = nodes.find((n) => n.id === selectedNodeId)
    if (!sourceNode) return
    pushUndo(get)

    const d = sourceNode.data as StepNodeData
    const existingIds = new Set(nodes.map((n) => n.id))
    const newId = generateStepId(d.stepType, existingIds)
    const newNode: StepNode = {
      id: newId,
      type: sourceNode.type,
      position: { x: sourceNode.position.x + 40, y: sourceNode.position.y + 100 },
      data: { ...d, label: newId }
    }

    set({
      nodes: [...nodes, newNode] as EditorNode[],
      selectedNodeId: newId,
      dirty: true
    })
  },

  updateNodeData: (nodeId, data) => {
    const { nodes } = get()
    pushUndo(get)

    const nextNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    ) as EditorNode[]
    set({
      nodes: nextNodes,
      dirty: true
    })
  },

  renameStep: (oldId, newId) => {
    const { nodes, edges, selectedNodeId } = get()
    if (oldId === newId) return
    if (nodes.some((n) => n.id !== oldId && n.id === newId)) return
    pushUndo(get)

    const refPattern = new RegExp(`\\$${oldId}\\.`, 'g')
    const replacement = `$${newId}.`

    const mappedNodes = nodes.map((n) => {
      if (n.id === oldId) {
        return { ...n, id: newId, data: { ...n.data, label: newId } }
      }
      const d = n.data as Record<string, unknown>
      const updates: Partial<StepNodeData> = {}
      if (typeof d.input === 'string') updates.input = d.input.replace(refPattern, replacement)
      if (typeof d.condition === 'string') updates.condition = d.condition.replace(refPattern, replacement)
      if (Object.keys(updates).length === 0) return n
      return { ...n, data: { ...n.data, ...updates } }
    })
    const newNodes: EditorNode[] = mappedNodes as EditorNode[]

    const newEdges = edges.map((e) => {
      const src = e.source === oldId ? newId : e.source
      const tgt = e.target === oldId ? newId : e.target
      if (src === e.source && tgt === e.target) return e
      return { ...e, id: `${src}->${tgt}`, source: src, target: tgt }
    })

    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: selectedNodeId === oldId ? newId : selectedNodeId,
      dirty: true
    })
  },

  setWorkflowMeta: (meta) => {
    set((state) => ({
      ...(meta.name !== undefined ? { workflowName: meta.name } : {}),
      ...(meta.description !== undefined ? { workflowDescription: meta.description } : {}),
      ...(meta.args !== undefined ? { workflowArgs: meta.args } : {}),
      ...(meta.outputs !== undefined ? { workflowOutputs: meta.outputs } : {}),
      ...(meta.triggers !== undefined ? { workflowTriggers: meta.triggers } : {}),
      ...(meta.config !== undefined ? { workflowConfig: meta.config } : {}),
      dirty: true
    }))
  },

  loadFromDef: (def) => {
    const { nodes, edges } = defToFlow(def)
    set({
      nodes: nodes as EditorNode[],
      edges,
      workflowName: def.name,
      workflowDescription: def.description ?? '',
      workflowArgs: def.args,
      workflowOutputs: def.outputs,
      workflowTriggers: def.triggers ?? [],
      workflowConfig: def.config,
      selectedNodeId: null,
      dirty: false,
      undoStack: [],
      redoStack: []
    })
  },

  exportToDef: () => {
    const { nodes, edges, workflowName, workflowDescription, workflowArgs, workflowOutputs, workflowTriggers, workflowConfig } = get()
    return flowToDef(nodes, edges, {
      name: workflowName,
      description: workflowDescription || undefined,
      args: workflowArgs,
      outputs: workflowOutputs,
      triggers: workflowTriggers,
      config: workflowConfig
    })
  },

  autoLayout: () => {
    const { nodes, edges } = get()
    pushUndo(get)
    const stepNodes = nodes.filter((n) => !isIONodeId(n.id)) as StepNode[]
    const laidOut = applyDagreLayout(stepNodes, edges)
    const positionMap = new Map(laidOut.map((n) => [n.id, n.position]))
    const newNodes: EditorNode[] = nodes.map((n) =>
      positionMap.has(n.id) ? { ...n, position: positionMap.get(n.id)! } : n
    ) as EditorNode[]
    set({ nodes: newNodes, dirty: true })
  },

  undo: () => {
    const { undoStack, nodes, edges, redoStack } = get()
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, snapshot({ nodes, edges })].slice(-MAX_UNDO),
      dirty: true
    })
  },

  redo: () => {
    const { redoStack, nodes, edges, undoStack } = get()
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    set({
      nodes: next.nodes,
      edges: next.edges,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, snapshot({ nodes, edges })].slice(-MAX_UNDO),
      dirty: true
    })
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      workflowName: '',
      workflowDescription: '',
      workflowArgs: undefined,
      workflowOutputs: undefined,
      workflowTriggers: [],
      workflowConfig: undefined,
      selectedNodeId: null,
      dirty: false,
      undoStack: [],
      redoStack: []
    })
  }
}))

// Push current state to undo stack (debounced: skip if identical to last snapshot)
function pushUndo(get: () => WorkflowEditorState): void {
  const { nodes, edges, undoStack } = get()
  const snap = snapshot({ nodes, edges })
  useWorkflowEditorStore.setState({
    undoStack: [...undoStack, snap].slice(-MAX_UNDO),
    redoStack: []
  })
}
