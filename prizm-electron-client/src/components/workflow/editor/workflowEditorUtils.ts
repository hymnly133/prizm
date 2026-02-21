/**
 * workflowEditorUtils — WorkflowDef <-> ReactFlow nodes/edges 双向转换 + dagre 自动布局
 */

import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'
import type {
  WorkflowDef,
  WorkflowStepDef,
  WorkflowStepType,
  WorkflowLinkedAction,
  WorkflowTriggerDef,
  WorkflowStepSessionConfig,
  WorkflowStepRetryConfig
} from '@prizm/shared'

// ─── Node Data ───

export interface StepNodeData extends Record<string, unknown> {
  stepType: WorkflowStepType
  label: string
  description?: string
  prompt?: string
  approvePrompt?: string
  transform?: string
  input?: string
  condition?: string
  model?: string
  timeoutMs?: number
  sessionConfig?: WorkflowStepSessionConfig
  retryConfig?: WorkflowStepRetryConfig
  linkedActions?: WorkflowLinkedAction[]
}

/** I/O 节点（Input / Output）的数据结构 */
export interface IONodeData extends Record<string, unknown> {
  nodeKind: 'input' | 'output'
  label: string
  /** 参数 schema: key → { type, description } */
  ioFields: Record<string, { type?: string; description?: string; default?: unknown }>
}

export type StepNode = Node<StepNodeData>
export type IONode = Node<IONodeData>
export type EditorNode = StepNode | IONode

export const INPUT_NODE_ID = '__workflow_input__'
export const OUTPUT_NODE_ID = '__workflow_output__'

const NODE_WIDTH = 220
const NODE_HEIGHT = 80
const VERTICAL_GAP = 60
const HORIZONTAL_GAP = 60

const STEP_REF_PATTERN = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+(?:\.\w+)*)/g

// ─── WorkflowDef -> ReactFlow ───

export function defToFlow(def: WorkflowDef): { nodes: EditorNode[]; edges: Edge[] } {
  const allNodes: EditorNode[] = []
  const allEdges: Edge[] = []
  let yOffset = 0

  // Input node (从 def.args 生成)
  if (def.args && Object.keys(def.args).length > 0) {
    const ioFields: IONodeData['ioFields'] = {}
    for (const [k, v] of Object.entries(def.args)) {
      ioFields[k] = { type: 'string', description: v.description, default: v.default }
    }
    allNodes.push({
      id: INPUT_NODE_ID,
      type: 'inputNode',
      position: { x: 0, y: yOffset },
      data: { nodeKind: 'input', label: '输入参数', ioFields }
    })
    yOffset += NODE_HEIGHT + VERTICAL_GAP
  }

  // Step nodes
  const stepNodes: StepNode[] = def.steps.map((step, i) => ({
    id: step.id,
    type: stepTypeToNodeType(step.type),
    position: { x: 0, y: yOffset + i * (NODE_HEIGHT + VERTICAL_GAP) },
    data: stepDefToNodeData(step)
  }))
  allNodes.push(...stepNodes)

  // Step edges
  const stepEdges = buildEdges(def.steps)
  allEdges.push(...stepEdges)

  // Input → first step edge
  if (allNodes.some((n) => n.id === INPUT_NODE_ID) && stepNodes.length > 0) {
    allEdges.push({
      id: `${INPUT_NODE_ID}->${stepNodes[0].id}`,
      source: INPUT_NODE_ID,
      target: stepNodes[0].id,
      animated: true
    })
  }

  // Output node (从 def.outputs 生成)
  if (def.outputs && Object.keys(def.outputs).length > 0) {
    yOffset += def.steps.length * (NODE_HEIGHT + VERTICAL_GAP)
    const ioFields: IONodeData['ioFields'] = {}
    for (const [k, v] of Object.entries(def.outputs)) {
      ioFields[k] = { type: v.type, description: v.description }
    }
    allNodes.push({
      id: OUTPUT_NODE_ID,
      type: 'outputNode',
      position: { x: 0, y: yOffset },
      data: { nodeKind: 'output', label: '输出结果', ioFields }
    })

    // last step → Output edge
    if (stepNodes.length > 0) {
      allEdges.push({
        id: `${stepNodes[stepNodes.length - 1].id}->${OUTPUT_NODE_ID}`,
        source: stepNodes[stepNodes.length - 1].id,
        target: OUTPUT_NODE_ID,
        animated: true
      })
    }
  }

  const laidOut = applyDagreLayout(allNodes as StepNode[], allEdges)
  return { nodes: laidOut, edges: allEdges }
}

function stepTypeToNodeType(type: WorkflowStepType): string {
  switch (type) {
    case 'agent': return 'agentStep'
    case 'approve': return 'approveStep'
    case 'transform': return 'transformStep'
    default: return 'agentStep'
  }
}

function stepDefToNodeData(step: WorkflowStepDef): StepNodeData {
  return {
    stepType: step.type,
    label: step.id,
    description: step.description,
    prompt: step.prompt,
    approvePrompt: step.approvePrompt,
    transform: step.transform,
    input: step.input,
    condition: step.condition,
    model: step.model,
    timeoutMs: step.timeoutMs,
    sessionConfig: step.sessionConfig,
    retryConfig: step.retryConfig,
    linkedActions: step.linkedActions
  }
}

function buildEdges(steps: WorkflowStepDef[]): Edge[] {
  const edges: Edge[] = []
  const edgeIds = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    let hasExplicitInput = false

    // Parse $stepId references from input and condition fields
    for (const field of ['input', 'condition'] as const) {
      const value = step[field]
      if (typeof value !== 'string') continue

      STEP_REF_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = STEP_REF_PATTERN.exec(value)) !== null) {
        const refId = match[1]
        if (refId === 'args') continue

        let sourceId: string
        if (refId === 'prev') {
          if (i === 0) continue
          sourceId = steps[i - 1].id
        } else {
          const found = steps.findIndex((s) => s.id === refId)
          if (found < 0) continue
          sourceId = refId
        }

        const eid = `${sourceId}->${step.id}`
        if (!edgeIds.has(eid)) {
          edgeIds.add(eid)
          edges.push({
            id: eid,
            source: sourceId,
            target: step.id,
            label: step.condition ? '条件' : undefined,
            animated: field === 'condition'
          })
          hasExplicitInput = true
        }
      }
    }

    // Implicit sequential connection
    if (!hasExplicitInput && i > 0) {
      const eid = `${steps[i - 1].id}->${step.id}`
      if (!edgeIds.has(eid)) {
        edgeIds.add(eid)
        edges.push({
          id: eid,
          source: steps[i - 1].id,
          target: step.id
        })
      }
    }
  }

  return edges
}

// ─── ReactFlow -> WorkflowDef ───

export function flowToDef(
  nodes: EditorNode[],
  edges: Edge[],
  meta: {
    name: string
    description?: string
    args?: WorkflowDef['args']
    outputs?: WorkflowDef['outputs']
    triggers?: WorkflowTriggerDef[]
    config?: WorkflowDef['config']
  }
): WorkflowDef {
  // Separate IO nodes from step nodes
  const stepNodes = nodes.filter((n) => n.id !== INPUT_NODE_ID && n.id !== OUTPUT_NODE_ID) as StepNode[]
  const inputNode = nodes.find((n) => n.id === INPUT_NODE_ID)
  const outputNode = nodes.find((n) => n.id === OUTPUT_NODE_ID)

  // Filter IO-related edges for topological sort
  const stepEdges = edges.filter((e) => e.source !== INPUT_NODE_ID && e.target !== OUTPUT_NODE_ID)

  // Topological sort based on edges
  const sorted = topologicalSort(stepNodes, stepEdges)

  const steps: WorkflowStepDef[] = sorted.map((node) => {
    const d = node.data as StepNodeData
    const step: WorkflowStepDef = {
      id: d.label || node.id,
      type: d.stepType
    }

    if (d.description) step.description = d.description
    if (d.prompt !== undefined && d.prompt !== '') step.prompt = d.prompt
    if (d.approvePrompt !== undefined && d.approvePrompt !== '') step.approvePrompt = d.approvePrompt
    if (d.transform !== undefined && d.transform !== '') step.transform = d.transform
    if (d.input) step.input = d.input
    if (d.condition) step.condition = d.condition
    if (d.model) step.model = d.model
    if (d.timeoutMs != null) step.timeoutMs = d.timeoutMs
    if (d.sessionConfig && hasAnyValue(d.sessionConfig)) step.sessionConfig = d.sessionConfig
    if (d.retryConfig && hasAnyValue(d.retryConfig)) step.retryConfig = d.retryConfig
    if (d.linkedActions?.length) step.linkedActions = d.linkedActions

    return step
  })

  // 从 InputNode 数据导出 args（优先使用节点数据，fallback 到 meta.args）
  let args = meta.args
  if (inputNode) {
    const ioData = inputNode.data as IONodeData
    if (ioData.ioFields && Object.keys(ioData.ioFields).length > 0) {
      args = {}
      for (const [k, v] of Object.entries(ioData.ioFields)) {
        args[k] = { default: v.default, description: v.description }
      }
    }
  }

  // 从 OutputNode 数据导出 outputs（优先使用节点数据，fallback 到 meta.outputs）
  let outputs = meta.outputs
  if (outputNode) {
    const ioData = outputNode.data as IONodeData
    if (ioData.ioFields && Object.keys(ioData.ioFields).length > 0) {
      outputs = {}
      for (const [k, v] of Object.entries(ioData.ioFields)) {
        outputs[k] = { type: v.type, description: v.description }
      }
    }
  }

  const def: WorkflowDef = {
    name: meta.name,
    steps
  }
  if (meta.description) def.description = meta.description
  if (args && Object.keys(args).length > 0) def.args = args
  if (outputs && Object.keys(outputs).length > 0) def.outputs = outputs
  if (meta.triggers?.length) def.triggers = meta.triggers
  if (meta.config && hasAnyValue(meta.config)) def.config = meta.config

  return def
}

function topologicalSort(nodes: StepNode[], edges: Edge[]): StepNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  }

  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    adj.get(e.source)?.push(e.target)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  /** Stable sort: first by node.id (lexicographic), then by position.y */
  const sortQueue = (a: string, b: string) => {
    const cmpId = a.localeCompare(b)
    if (cmpId !== 0) return cmpId
    return (nodeMap.get(a)?.position.y ?? 0) - (nodeMap.get(b)?.position.y ?? 0)
  }
  queue.sort(sortQueue)

  const result: StepNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodeMap.get(id)
    if (node) result.push(node)

    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
    queue.sort(sortQueue)
  }

  // Append any remaining nodes not in graph (disconnected)
  for (const n of nodes) {
    if (!result.includes(n)) result.push(n)
  }

  return result
}

// ─── Dagre Layout ───

export function applyDagreLayout(
  nodes: StepNode[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): StepNode[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: HORIZONTAL_GAP,
    ranksep: VERTICAL_GAP,
    marginx: 40,
    marginy: 40
  })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2
      }
    }
  })
}

// ─── Helpers ───

export function generateStepId(type: WorkflowStepType, existingIds: Set<string>): string {
  const prefix = type === 'agent' ? 'agent' : type === 'approve' ? 'approve' : 'transform'
  let counter = 1
  let id = `${prefix}_${counter}`
  while (existingIds.has(id)) {
    counter++
    id = `${prefix}_${counter}`
  }
  return id
}

export function createDefaultStepData(type: WorkflowStepType, id: string): StepNodeData {
  const base: StepNodeData = { stepType: type, label: id }
  switch (type) {
    case 'agent':
      base.prompt = ''
      break
    case 'approve':
      base.approvePrompt = '请审批此步骤'
      break
    case 'transform':
      base.transform = ''
      break
  }
  return base
}

/** Check if an object has any non-undefined/null/empty value */
function hasAnyValue(obj: object): boolean {
  return Object.values(obj).some((v) => {
    if (v == null) return false
    if (typeof v === 'string') return v.length > 0
    if (Array.isArray(v)) return v.length > 0
    return true
  })
}

// ─── Export validation (serial pipeline) ───

/**
 * Validates that the flow forms a single serial chain: each step has at most one incoming
 * and one outgoing step-edge; exactly one head (0 in-edges) and one tail (0 out-edges);
 * no isolated or disconnected steps.
 * Returns the first error message or empty string if valid.
 */
export function validateFlowForExport(nodes: EditorNode[], edges: Edge[]): string {
  const stepNodes = nodes.filter(
    (n) => n.id !== INPUT_NODE_ID && n.id !== OUTPUT_NODE_ID
  ) as StepNode[]
  const stepEdges = edges.filter(
    (e) => e.source !== INPUT_NODE_ID && e.target !== OUTPUT_NODE_ID
  )

  if (stepNodes.length === 0) {
    return '工作流至少需要一个步骤'
  }

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const n of stepNodes) {
    inDegree.set(n.id, 0)
    outDegree.set(n.id, 0)
  }
  for (const e of stepEdges) {
    if (inDegree.has(e.target)) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    if (outDegree.has(e.source)) outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1)
  }

  const heads = stepNodes.filter((n) => inDegree.get(n.id) === 0)
  const tails = stepNodes.filter((n) => outDegree.get(n.id) === 0)

  if (heads.length === 0) {
    return '存在环路或所有步骤都有前驱，无法确定起始步骤。请保证有且仅有一条从首步到末步的串行链。'
  }
  if (heads.length > 1) {
    return '存在多个无前驱的步骤（分支或孤立节点）。当前仅支持串行流水线，请连接成单链。'
  }
  if (tails.length === 0) {
    return '存在环路，无法确定结束步骤。请保证有且仅有一条从首步到末步的串行链。'
  }
  if (tails.length > 1) {
    return '存在多个无后继的步骤（分支或孤立节点）。当前仅支持串行流水线，请连接成单链。'
  }

  for (const n of stepNodes) {
    const id = n.id
    const inD = inDegree.get(id) ?? 0
    const outD = outDegree.get(id) ?? 0
    const isHead = heads[0].id === id
    const isTail = tails[0].id === id
    if (!isHead && !isTail) {
      if (inD !== 1 || outD !== 1) {
        return `步骤「${(n.data as StepNodeData).label || id}」应有且仅有 1 个前驱和 1 个后继，当前为 ${inD} 个前驱、${outD} 个后继。请连接成单链。`
      }
    } else if (isHead && !isTail && (inD !== 0 || outD !== 1)) {
      return `起始步骤「${(n.data as StepNodeData).label || id}」应有 0 个前驱、1 个后继。请检查连线。`
    } else if (!isHead && isTail && (inD !== 1 || outD !== 0)) {
      return `结束步骤「${(n.data as StepNodeData).label || id}」应有 1 个前驱、0 个后继。请检查连线。`
    }
  }

  // Single-node chain: head === tail, both inDegree and outDegree 0 (no step-edges)
  if (stepNodes.length === 1) {
    const id = stepNodes[0].id
    if ((inDegree.get(id) ?? 0) > 0 || (outDegree.get(id) ?? 0) > 0) {
      return '单步骤工作流不应有步骤之间的连线。请移除多余连线。'
    }
  }

  return ''
}
