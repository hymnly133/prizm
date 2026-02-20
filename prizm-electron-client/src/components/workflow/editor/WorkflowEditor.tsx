/**
 * WorkflowEditor — 工作流可视化编辑器主组件
 *
 * 三栏布局：Toolbar (top) + Canvas (center) + PropertiesPanel (right, collapsible)
 * 底部可展开 YAML 预览/编辑面板。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import yaml from 'js-yaml'
import { GitBranch } from 'lucide-react'
import { message } from 'antd'
import type { WorkflowDef, WorkflowDefRecord, WorkflowStepDef } from '@prizm/shared'
import { useWorkflowEditorStore } from '../../../store/workflowEditorStore'
import { nodeTypes } from './nodes'
import { EditorToolbar } from './EditorToolbar'
import { PropertiesPanel } from './PropertiesPanel'
import '../../../styles/workflow-editor.css'

export interface WorkflowEditorProps {
  defRecord?: WorkflowDefRecord
  initialYaml?: string
  onSave: (name: string, yaml: string, description?: string) => Promise<void>
  onRun?: (name: string) => void
  onClose?: () => void
}

function WorkflowEditorInner({
  defRecord,
  initialYaml,
  onSave,
  onRun,
  onClose
}: WorkflowEditorProps) {
  const { fitView } = useReactFlow()

  const nodes = useWorkflowEditorStore((s) => s.nodes)
  const edges = useWorkflowEditorStore((s) => s.edges)
  const onNodesChange = useWorkflowEditorStore((s) => s.onNodesChange)
  const onEdgesChange = useWorkflowEditorStore((s) => s.onEdgesChange)
  const onConnect = useWorkflowEditorStore((s) => s.onConnect)
  const onNodeClick = useWorkflowEditorStore((s) => s.onNodeClick)
  const onPaneClick = useWorkflowEditorStore((s) => s.onPaneClick)
  const loadFromDef = useWorkflowEditorStore((s) => s.loadFromDef)
  const exportToDef = useWorkflowEditorStore((s) => s.exportToDef)
  const workflowName = useWorkflowEditorStore((s) => s.workflowName)
  const setWorkflowMeta = useWorkflowEditorStore((s) => s.setWorkflowMeta)
  const deleteSelected = useWorkflowEditorStore((s) => s.deleteSelected)
  const undo = useWorkflowEditorStore((s) => s.undo)
  const redo = useWorkflowEditorStore((s) => s.redo)
  const reset = useWorkflowEditorStore((s) => s.reset)

  const [yamlMode, setYamlMode] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [saving, setSaving] = useState(false)
  const [propsOpen, setPropsOpen] = useState(true)
  const initRef = useRef(false)

  // Load initial definition
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    if (defRecord?.yamlContent) {
      const parsed = parseYamlToDef(defRecord.yamlContent)
      if (parsed) {
        loadFromDef(parsed)
        setYamlText(defRecord.yamlContent)
      } else {
        loadFromDef({ name: defRecord.name, steps: [] })
        setWorkflowMeta({ name: defRecord.name, description: defRecord.description })
      }
    } else if (initialYaml) {
      const parsed = parseYamlToDef(initialYaml)
      if (parsed) {
        loadFromDef(parsed)
        setYamlText(initialYaml)
      }
    } else {
      reset()
      setWorkflowMeta({ name: 'new_workflow' })
    }

    setTimeout(() => fitView({ padding: 0.2 }), 100)
  }, [defRecord, initialYaml, loadFromDef, setWorkflowMeta, reset, fitView])

  // Cleanup on unmount
  useEffect(() => () => { reset() }, [reset])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        deleteSelected()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, deleteSelected])

  // YAML sync
  const handleToggleYaml = useCallback(() => {
    if (!yamlMode) {
      const def = exportToDef()
      setYamlText(defToYamlString(def))
    }
    setYamlMode((m) => !m)
  }, [yamlMode, exportToDef])

  const handleYamlChange = useCallback((text: string) => {
    setYamlText(text)
    const parsed = parseYamlToDef(text)
    if (parsed) {
      loadFromDef(parsed)
    }
  }, [loadFromDef])

  // Save with client-side validation
  const handleSave = useCallback(async () => {
    const def = exportToDef()
    const errors = validateDef(def)
    if (errors.length > 0) {
      message.error(errors[0])
      return
    }
    setSaving(true)
    try {
      const yamlStr = defToYamlString(def)
      await onSave(def.name, yamlStr, def.description)
      useWorkflowEditorStore.setState({ dirty: false })
    } finally {
      setSaving(false)
    }
  }, [exportToDef, onSave])

  // Run
  const handleRun = useMemo(
    () => onRun ? () => onRun(workflowName) : undefined,
    [onRun, workflowName]
  )

  // Node click handler
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      onNodeClick(node.id)
      setPropsOpen(true)
    },
    [onNodeClick]
  )

  return (
    <div className="wfe-container">
      <EditorToolbar
        onSave={() => void handleSave()}
        onRun={handleRun}
        saving={saving}
        yamlMode={yamlMode}
        onToggleYaml={handleToggleYaml}
      />

      <div className="wfe-main">
        {yamlMode ? (
          <div className="wfe-yaml-panel" style={{ flex: 1, maxHeight: 'none' }}>
            <div className="wfe-yaml-panel__header">
              <span>YAML 编辑</span>
            </div>
            <div className="wfe-yaml-panel__body">
              <textarea
                value={yamlText}
                onChange={(e) => handleYamlChange(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="wfe-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                onPaneClick={onPaneClick}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeStrokeWidth={3}
                  pannable
                  zoomable
                  style={{ width: 120, height: 80 }}
                />
                {nodes.length === 0 && (
                  <div className="wfe-empty-prompt">
                    <div className="wfe-empty-prompt__icon">
                      <GitBranch size={48} />
                    </div>
                    <div className="wfe-empty-prompt__text">
                      空画布
                    </div>
                    <div className="wfe-empty-prompt__hint">
                      点击工具栏"添加步骤"开始构建工作流
                    </div>
                  </div>
                )}
              </ReactFlow>
            </div>
            {propsOpen && (
              <PropertiesPanel onClose={() => setPropsOpen(false)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

// ─── YAML helpers (using js-yaml) ───

function defToYamlString(def: WorkflowDef): string {
  return yaml.dump(def, { lineWidth: 120, noRefs: true, quotingType: '"' })
}

function parseYamlToDef(text: string): WorkflowDef | null {
  try {
    const trimmed = text.trim()
    if (!trimmed) return null

    let raw: unknown
    if (trimmed.startsWith('{')) {
      raw = JSON.parse(trimmed)
    } else {
      raw = yaml.load(trimmed)
    }

    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (!obj.name || typeof obj.name !== 'string') return null

    if (!Array.isArray(obj.steps)) obj.steps = []

    const steps: WorkflowStepDef[] = (obj.steps as Record<string, unknown>[])
      .filter((s) => s && typeof s === 'object' && s.id && s.type)
      .map((s) => {
        const step: WorkflowStepDef = {
          id: String(s.id),
          type: s.type as WorkflowStepDef['type']
        }
        if (typeof s.prompt === 'string') step.prompt = s.prompt
        if (typeof s.approvePrompt === 'string') step.approvePrompt = s.approvePrompt
        if (typeof s.transform === 'string') step.transform = s.transform
        if (typeof s.input === 'string') step.input = s.input
        if (typeof s.condition === 'string') step.condition = s.condition
        if (typeof s.model === 'string') step.model = s.model
        if (typeof s.timeoutMs === 'number') step.timeoutMs = s.timeoutMs
        if (Array.isArray(s.linkedActions)) step.linkedActions = s.linkedActions as WorkflowStepDef['linkedActions']
        return step
      })

    const def: WorkflowDef = { name: obj.name, steps }
    if (typeof obj.description === 'string') def.description = obj.description
    if (obj.args && typeof obj.args === 'object') def.args = obj.args as WorkflowDef['args']
    if (Array.isArray(obj.triggers)) def.triggers = obj.triggers as WorkflowDef['triggers']

    return def
  } catch {
    return null
  }
}

/**
 * 客户端校验 WorkflowDef，返回错误列表。空数组表示通过。
 */
function validateDef(def: WorkflowDef): string[] {
  const errors: string[] = []
  if (!def.name.trim()) errors.push('工作流名称不能为空')
  if (def.steps.length === 0) errors.push('工作流至少需要一个步骤')

  const ids = new Set<string>()
  for (const step of def.steps) {
    if (!step.id.trim()) {
      errors.push('存在空的步骤 ID')
      continue
    }
    if (ids.has(step.id)) {
      errors.push(`步骤 ID "${step.id}" 重复`)
    }
    ids.add(step.id)

    if (step.type === 'agent' && !step.prompt) {
      errors.push(`Agent 步骤 "${step.id}" 缺少 prompt`)
    }
    if (step.type === 'approve' && !step.approvePrompt) {
      errors.push(`审批步骤 "${step.id}" 缺少 approvePrompt`)
    }
    if (step.type === 'transform' && !step.transform) {
      errors.push(`变换步骤 "${step.id}" 缺少 transform 表达式`)
    }
  }
  return errors
}
