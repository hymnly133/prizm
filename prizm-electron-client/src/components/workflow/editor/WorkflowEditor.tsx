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
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLanguage } from '@codemirror/lang-yaml'
import { EditorView } from '@codemirror/view'
import { GitBranch } from 'lucide-react'
import { message } from 'antd'
import { useCodeMirrorTheme } from '../../../hooks/useCodeMirrorTheme'
import type {
  WorkflowDef,
  WorkflowDefRecord,
  WorkflowStepDef,
  WorkflowStepSessionConfig,
  WorkflowStepRetryConfig,
  WorkflowDefConfig,
  WorkflowTriggerDef
} from '@prizm/shared'
import { useWorkflowEditorStore } from '../../../store/workflowEditorStore'
import { nodeTypes } from './nodes'
import { EditorToolbar } from './EditorToolbar'
import { PropertiesPanel } from './PropertiesPanel'
import { validateFlowForExport } from './workflowEditorUtils'
import '../../../styles/workflow-editor.css'

export interface WorkflowEditorProps {
  defRecord?: WorkflowDefRecord
  initialYaml?: string
  /** 初始是否以 YAML 模式打开（用于右侧面板 YAML 创建） */
  initialYamlMode?: boolean
  onSave: (name: string, yaml: string, description?: string) => Promise<void>
  onRun?: (name: string) => void
  onClose?: () => void
}

function WorkflowEditorInner({
  defRecord,
  initialYaml,
  initialYamlMode = false,
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

  const [yamlMode, setYamlMode] = useState(initialYamlMode)
  const [yamlText, setYamlText] = useState('')
  const [saving, setSaving] = useState(false)
  const [propsOpen, setPropsOpen] = useState(true)
  const initRef = useRef(false)
  const cmTheme = useCodeMirrorTheme()
  const yamlExtensions = useMemo(
    () => [cmTheme, yamlLanguage(), EditorView.lineWrapping],
    [cmTheme]
  )

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
      if (initialYamlMode) {
        const defaultDef = { name: 'new_workflow', steps: [] }
        setYamlText(defToYamlString(defaultDef))
        loadFromDef(defaultDef)
      }
    }

    setTimeout(() => fitView({ padding: 0.2 }), 100)
  }, [defRecord, initialYaml, initialYamlMode, loadFromDef, setWorkflowMeta, reset, fitView])

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

  // Save: YAML 模式以编辑器内容为准；图模式以 store 为准
  const handleSave = useCallback(async () => {
    if (yamlMode) {
      const parsed = parseYamlToDef(yamlText)
      if (!parsed) {
        message.error('YAML 格式错误或无法解析')
        return
      }
      const errors = validateDef(parsed)
      if (errors.length > 0) {
        message.error(errors[0])
        return
      }
      setSaving(true)
      try {
        const yamlStr = defToYamlString(parsed)
        await onSave(parsed.name, yamlStr, parsed.description)
        useWorkflowEditorStore.setState({ dirty: false })
      } finally {
        setSaving(false)
      }
      return
    }

    const flowError = validateFlowForExport(nodes, edges)
    if (flowError) {
      message.error(flowError)
      return
    }
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
  }, [yamlMode, yamlText, nodes, edges, exportToDef, onSave])

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
              <CodeMirror
                value={yamlText}
                onChange={handleYamlChange}
                extensions={yamlExtensions}
                theme="none"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  indentOnInput: true
                }}
                style={{ height: '100%', minHeight: 320 }}
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
                      点击工具栏「添加步骤」开始构建工作流
                    </div>
                    <div className="wfe-empty-prompt__serial-hint">
                      当前为串行流水线，连线表示执行顺序与数据依赖
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

function parseSessionConfig(raw: Record<string, unknown>): WorkflowStepSessionConfig {
  const sc: WorkflowStepSessionConfig = {}
  if (typeof raw.thinking === 'boolean') sc.thinking = raw.thinking
  if (Array.isArray(raw.skills)) sc.skills = raw.skills.filter((s): s is string => typeof s === 'string')
  if (typeof raw.systemPrompt === 'string') sc.systemPrompt = raw.systemPrompt
  if (Array.isArray(raw.allowedTools)) sc.allowedTools = raw.allowedTools.filter((t): t is string => typeof t === 'string')
  if (Array.isArray(raw.allowedSkills)) sc.allowedSkills = raw.allowedSkills.filter((s): s is string => typeof s === 'string')
  if (Array.isArray(raw.allowedMcpServerIds)) sc.allowedMcpServerIds = raw.allowedMcpServerIds.filter((m): m is string => typeof m === 'string')
  if (typeof raw.model === 'string') sc.model = raw.model
  if (typeof raw.maxTurns === 'number') sc.maxTurns = raw.maxTurns
  if (typeof raw.expectedOutputFormat === 'string') sc.expectedOutputFormat = raw.expectedOutputFormat
  if (raw.outputSchema && typeof raw.outputSchema === 'object') sc.outputSchema = raw.outputSchema as Record<string, unknown>
  if (typeof raw.maxSchemaRetries === 'number') sc.maxSchemaRetries = raw.maxSchemaRetries
  if (raw.toolGroups && typeof raw.toolGroups === 'object') sc.toolGroups = raw.toolGroups as Record<string, boolean>
  return sc
}

function parseRetryConfig(raw: Record<string, unknown>): WorkflowStepRetryConfig {
  const rc: WorkflowStepRetryConfig = {}
  if (typeof raw.maxRetries === 'number') rc.maxRetries = raw.maxRetries
  if (typeof raw.retryDelayMs === 'number') rc.retryDelayMs = raw.retryDelayMs
  if (Array.isArray(raw.retryOn)) {
    rc.retryOn = raw.retryOn.filter((v): v is 'failed' | 'timeout' => v === 'failed' || v === 'timeout')
  }
  return rc
}

const VALID_WORKSPACE_MODES = ['dual', 'shared', 'isolated'] as const

function parseConfig(raw: Record<string, unknown>): WorkflowDefConfig {
  const config: WorkflowDefConfig = {}
  if (typeof raw.maxTotalTimeoutMs === 'number') config.maxTotalTimeoutMs = raw.maxTotalTimeoutMs
  if (raw.errorStrategy === 'fail_fast' || raw.errorStrategy === 'continue') config.errorStrategy = raw.errorStrategy
  if (typeof raw.reuseWorkspace === 'boolean') config.reuseWorkspace = raw.reuseWorkspace
  if (typeof raw.cleanBefore === 'boolean') config.cleanBefore = raw.cleanBefore
  if (typeof raw.workspaceMode === 'string' && VALID_WORKSPACE_MODES.includes(raw.workspaceMode as typeof VALID_WORKSPACE_MODES[number])) {
    config.workspaceMode = raw.workspaceMode as WorkflowDefConfig['workspaceMode']
  }
  if (typeof raw.notifyOnComplete === 'boolean') config.notifyOnComplete = raw.notifyOnComplete
  if (typeof raw.notifyOnFail === 'boolean') config.notifyOnFail = raw.notifyOnFail
  if (typeof raw.maxStepOutputChars === 'number' && raw.maxStepOutputChars > 0) {
    config.maxStepOutputChars = Math.floor(raw.maxStepOutputChars)
  }
  if (Array.isArray(raw.tags)) config.tags = raw.tags.filter((t): t is string => typeof t === 'string')
  if (typeof raw.version === 'string') config.version = raw.version
  return config
}

function parseTrigger(raw: unknown): WorkflowTriggerDef | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const validTypes = ['cron', 'schedule_remind', 'todo_completed', 'document_saved']
  if (!t.type || !validTypes.includes(t.type as string)) return null
  return {
    type: t.type as WorkflowTriggerDef['type'],
    filter: t.filter as Record<string, string> | undefined
  }
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
        if (typeof (s as Record<string, unknown>).description === 'string') step.description = (s as Record<string, unknown>).description as string
        if (typeof (s as Record<string, unknown>).prompt === 'string') step.prompt = (s as Record<string, unknown>).prompt as string
        if (typeof (s as Record<string, unknown>).approvePrompt === 'string') step.approvePrompt = (s as Record<string, unknown>).approvePrompt as string
        if (typeof (s as Record<string, unknown>).transform === 'string') step.transform = (s as Record<string, unknown>).transform as string
        if (typeof (s as Record<string, unknown>).input === 'string') step.input = (s as Record<string, unknown>).input as string
        if (typeof (s as Record<string, unknown>).condition === 'string') step.condition = (s as Record<string, unknown>).condition as string
        if (typeof (s as Record<string, unknown>).model === 'string') step.model = (s as Record<string, unknown>).model as string
        if (typeof (s as Record<string, unknown>).timeoutMs === 'number') step.timeoutMs = (s as Record<string, unknown>).timeoutMs as number
        const sObj = s as Record<string, unknown>
        if (sObj.sessionConfig && typeof sObj.sessionConfig === 'object') {
          step.sessionConfig = parseSessionConfig(sObj.sessionConfig as Record<string, unknown>)
        }
        if (sObj.retryConfig && typeof sObj.retryConfig === 'object') {
          step.retryConfig = parseRetryConfig(sObj.retryConfig as Record<string, unknown>)
        }
        if (Array.isArray(sObj.linkedActions)) step.linkedActions = sObj.linkedActions as WorkflowStepDef['linkedActions']
        return step
      })

    const def: WorkflowDef = { name: obj.name as string, steps }
    if (typeof obj.description === 'string') def.description = obj.description
    if (obj.args && typeof obj.args === 'object') def.args = obj.args as WorkflowDef['args']
    if (obj.outputs && typeof obj.outputs === 'object') def.outputs = obj.outputs as WorkflowDef['outputs']
    if (Array.isArray(obj.triggers)) {
      def.triggers = obj.triggers.map(parseTrigger).filter((t): t is WorkflowTriggerDef => t != null)
    }
    if (obj.config && typeof obj.config === 'object') {
      def.config = parseConfig(obj.config as Record<string, unknown>)
    }

    return def
  } catch {
    return null
  }
}

/** 与服务端 parser 一致的 $stepId 引用匹配 */
const STEP_REF_PATTERN = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+(?:\.\w+)*)/g

/**
 * 客户端校验 WorkflowDef，返回错误列表。空数组表示通过。
 * 包含 input/condition 中 $stepId 的前序存在性校验，与服务端 parser 规则一致。
 */
function validateDef(def: WorkflowDef): string[] {
  const errors: string[] = []
  if (!def.name.trim()) errors.push('工作流名称不能为空')
  if (def.steps.length === 0) errors.push('工作流至少需要一个步骤')

  const ids = new Set<string>()
  const stepIdsInOrder = def.steps.map((s) => s.id)

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]
    if (!step.id.trim()) {
      errors.push('存在空的步骤 ID')
      continue
    }
    if (ids.has(step.id)) {
      errors.push(`步骤 ID "${step.id}" 重复`)
    }
    ids.add(step.id)

    const previousIds = new Set(stepIdsInOrder.slice(0, i))
    for (const field of ['input', 'condition'] as const) {
      const value = step[field]
      if (typeof value !== 'string') continue
      STEP_REF_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = STEP_REF_PATTERN.exec(value)) !== null) {
        const refId = match[1]
        if (refId === 'prev' || refId === 'args') continue
        if (!previousIds.has(refId)) {
          errors.push(
            `步骤 "${step.id}" 的 ${field} 引用了不存在的步骤 "$${refId}"，可用的前序步骤: ${[...previousIds].join(', ') || '(无)'}`
          )
        }
      }
    }

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
