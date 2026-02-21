/**
 * PropertiesPanel — 右侧属性面板
 *
 * 选中节点时显示对应步骤类型的属性表单（折叠分组）；
 * 无选中时显示工作流全局属性（name, description, triggers, config）。
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Input, InputNumber, Select, Typography, Divider, Tag, Switch, Collapse, Checkbox } from 'antd'
import {
  Bot, ShieldCheck, Shuffle, Settings2, X, Plus, Trash2,
  Brain, Zap, RotateCcw, Link2, Database, Lightbulb, Bell, Tag as TagIcon
} from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import type {
  WorkflowLinkedAction,
  WorkflowTriggerDef,
  WorkflowDefConfig,
  WorkflowStepSessionConfig,
  WorkflowStepRetryConfig,
  SessionMemoryPolicy,
  MemoryInjectPolicy,
  WorkflowWorkspaceMode
} from '@prizm/shared'
import { useWorkflowEditorStore } from '../../../store/workflowEditorStore'
import { usePrizmContext } from '../../../context/PrizmContext'
import { INPUT_NODE_ID, OUTPUT_NODE_ID, type StepNodeData, type IONodeData } from './workflowEditorUtils'

const { TextArea } = Input
const { Text } = Typography

export interface PropertiesPanelProps {
  onClose?: () => void
}

export const PropertiesPanel = memo(function PropertiesPanel({ onClose }: PropertiesPanelProps) {
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId)
  const nodes = useWorkflowEditorStore((s) => s.nodes)

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  )

  const isIONode = selectedNode && (selectedNode.id === INPUT_NODE_ID || selectedNode.id === OUTPUT_NODE_ID)
  const panelTitle = isIONode
    ? (selectedNode.id === INPUT_NODE_ID ? '输入参数' : '输出结果')
    : selectedNode ? '步骤属性' : '工作流属性'

  return (
    <div className="wfe-props">
      <div className="wfe-props__header">
        <span className="wfe-props__header-title">
          <Settings2 size={14} />
          {panelTitle}
        </span>
        {onClose && (
          <ActionIcon icon={X} size="small" onClick={onClose} title="关闭属性面板" />
        )}
      </div>
      <div className="wfe-props__body">
        {isIONode ? (
          <IONodeProperties nodeId={selectedNode.id} data={selectedNode.data as IONodeData} />
        ) : selectedNode ? (
          <StepProperties nodeId={selectedNode.id} data={selectedNode.data as StepNodeData} />
        ) : (
          <GlobalProperties />
        )}
      </div>
    </div>
  )
})

// ─── IO Node Properties ───

function IONodeProperties({ nodeId, data }: { nodeId: string; data: IONodeData }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData)

  const isInput = nodeId === INPUT_NODE_ID

  const updateFields = useCallback(
    (fields: IONodeData['ioFields'] | undefined) => {
      updateNodeData(nodeId, { ioFields: fields ?? {} })
    },
    [nodeId, updateNodeData]
  )

  return (
    <div className="wfe-props__form">
      <div className="wfe-props__type-badge">
        <Tag color={isInput ? 'green' : 'orange'}>{isInput ? '输入参数' : '输出结果'}</Tag>
      </div>
      <OutputsEditor
        fields={data.ioFields ?? {}}
        onChange={updateFields}
        fieldLabel={isInput ? '参数' : '输出字段'}
        showDefault={isInput}
      />
    </div>
  )
}

// ─── Outputs / IO Fields Editor ───

function OutputsEditor({
  fields,
  onChange,
  fieldLabel = '字段',
  showDefault = false
}: {
  fields: Record<string, { type?: string; description?: string; default?: unknown }>
  onChange: (fields: Record<string, { type?: string; description?: string; default?: unknown }> | undefined) => void
  fieldLabel?: string
  showDefault?: boolean
}) {
  const entries = useMemo(() => Object.entries(fields), [fields])

  const updateEntry = useCallback((oldKey: string, newKey: string, value: { type?: string; description?: string; default?: unknown }) => {
    const next = { ...fields }
    if (newKey !== oldKey) delete next[oldKey]
    next[newKey] = value
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }, [fields, onChange])

  const removeEntry = useCallback((key: string) => {
    const next = { ...fields }
    delete next[key]
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }, [fields, onChange])

  const addEntry = useCallback(() => {
    const next = { ...fields }
    let name = 'field_1'
    let i = 1
    while (next[name]) { i++; name = `field_${i}` }
    next[name] = { type: 'string', description: '' }
    onChange(next)
  }, [fields, onChange])

  return (
    <div className="wfe-props__form">
      {entries.map(([key, val]) => (
        <div key={key} className="wfe-props__kv-group">
          <div className="wfe-props__kv-row">
            <Input
              size="small"
              style={{ flex: 1 }}
              defaultValue={key}
              placeholder="字段名"
              onBlur={(e) => {
                const newKey = e.target.value.trim().replace(/\s+/g, '_')
                if (newKey && newKey !== key) updateEntry(key, newKey, val)
              }}
            />
            <ActionIcon icon={Trash2} size={14} onClick={() => removeEntry(key)} title={`删除${fieldLabel}`} />
          </div>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={val.type ?? 'string'}
            onChange={(v) => updateEntry(key, key, { ...val, type: v })}
            options={[
              { value: 'string', label: 'string' },
              { value: 'number', label: 'number' },
              { value: 'boolean', label: 'boolean' },
              { value: 'object', label: 'object (JSON)' },
              { value: 'array', label: 'array (JSON)' }
            ]}
          />
          <Input
            size="small"
            value={val.description ?? ''}
            onChange={(e) => updateEntry(key, key, { ...val, description: e.target.value || undefined })}
            placeholder="说明"
            addonBefore="说明"
          />
          {showDefault && (
            <Input
              size="small"
              value={String(val.default ?? '')}
              onChange={(e) => updateEntry(key, key, { ...val, default: e.target.value || undefined })}
              placeholder="默认值"
              addonBefore="默认"
            />
          )}
        </div>
      ))}
      <button type="button" className="wfe-props__add-trigger" onClick={addEntry}>
        <Plus size={12} /> 添加{fieldLabel}
      </button>
    </div>
  )
}

// ─── Step Properties (Collapsible) ───

function StepProperties({ nodeId, data }: { nodeId: string; data: StepNodeData }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData)
  const renameStep = useWorkflowEditorStore((s) => s.renameStep)

  const update = useCallback(
    (patch: Partial<StepNodeData>) => updateNodeData(nodeId, patch),
    [nodeId, updateNodeData]
  )

  const updateSessionConfig = useCallback(
    (patch: Partial<WorkflowStepSessionConfig>) => {
      update({ sessionConfig: { ...(data.sessionConfig ?? {}), ...patch } })
    },
    [data.sessionConfig, update]
  )

  const updateRetryConfig = useCallback(
    (patch: Partial<WorkflowStepRetryConfig>) => {
      update({ retryConfig: { ...(data.retryConfig ?? {}), ...patch } })
    },
    [data.retryConfig, update]
  )

  const typeIcon = data.stepType === 'agent' ? <Bot size={14} />
    : data.stepType === 'approve' ? <ShieldCheck size={14} />
    : <Shuffle size={14} />

  const typeLabel = data.stepType === 'agent' ? 'Agent 步骤'
    : data.stepType === 'approve' ? '审批步骤'
    : '变换步骤'

  const typeColor = data.stepType === 'agent' ? 'blue'
    : data.stepType === 'approve' ? 'gold'
    : 'purple'

  const sc = data.sessionConfig ?? {}
  const rc = data.retryConfig ?? {}

  const collapseItems = []

  // ─── Basic Config ───
  collapseItems.push({
    key: 'basic',
    label: <CollapseLabel icon={<Settings2 size={12} />} text="基础配置" />,
    children: (
      <div className="wfe-props__form">
        <FieldLabel label="步骤 ID" />
        <StepIdInput nodeId={nodeId} label={data.label} renameStep={renameStep} />

        <FieldLabel label="描述 (可选)" />
        <Input
          size="small"
          value={data.description ?? ''}
          onChange={(e) => update({ description: e.target.value || undefined })}
          placeholder="步骤功能描述"
        />

        {data.stepType === 'agent' && (
          <>
            <FieldLabel label="Prompt" />
            <TextArea
              size="small"
              rows={5}
              value={data.prompt ?? ''}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="LLM 执行指令"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />

            <FieldLabel label="模型 (可选)" />
            <Input
              size="small"
              value={data.model ?? ''}
              onChange={(e) => update({ model: e.target.value || undefined })}
              placeholder="默认使用系统模型"
            />

            <FieldLabel label="超时 (ms)" />
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              min={0}
              step={10000}
              value={data.timeoutMs}
              onChange={(v) => update({ timeoutMs: v ?? undefined })}
              placeholder="默认无限制"
            />
          </>
        )}

        {data.stepType === 'approve' && (
          <>
            <FieldLabel label="审批提示" />
            <TextArea
              size="small"
              rows={3}
              value={data.approvePrompt ?? ''}
              onChange={(e) => update({ approvePrompt: e.target.value })}
              placeholder="请审批此步骤"
            />
          </>
        )}

        {data.stepType === 'transform' && (
          <>
            <FieldLabel label="变换表达式" />
            <TextArea
              size="small"
              rows={3}
              value={data.transform ?? ''}
              onChange={(e) => update({ transform: e.target.value })}
              placeholder="dot-path 表达式，如 output.summary"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </>
        )}
      </div>
    )
  })

  // ─── Data Flow ───
  collapseItems.push({
    key: 'dataflow',
    label: <CollapseLabel icon={<Link2 size={12} />} text="数据流" />,
    children: (
      <div className="wfe-props__form">
        <FieldLabel label="输入引用 (可选)" />
        <Input
          size="small"
          value={data.input ?? ''}
          onChange={(e) => update({ input: e.target.value || undefined })}
          placeholder="$prev.output 或 $stepId.output"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />

        <FieldLabel label="条件表达式 (可选)" />
        <Input
          size="small"
          value={data.condition ?? ''}
          onChange={(e) => update({ condition: e.target.value || undefined })}
          placeholder="$stepId.approved"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>
    )
  })

  // ─── Session Advanced Config (Agent only) ───
  if (data.stepType === 'agent') {
    collapseItems.push({
      key: 'session',
      label: <CollapseLabel icon={<Brain size={12} />} text="Session 高级配置" />,
      children: (
        <div className="wfe-props__form">
          <SwitchRow
            label="Thinking 模式"
            checked={sc.thinking ?? false}
            onChange={(v) => updateSessionConfig({ thinking: v })}
          />

          <FieldLabel label="技能" />
          <Select
            mode="tags"
            size="small"
            style={{ width: '100%' }}
            value={sc.skills ?? []}
            onChange={(v) => updateSessionConfig({ skills: v.length > 0 ? v : undefined })}
            placeholder="输入技能名称并回车"
            tokenSeparators={[',']}
          />

          <FieldLabel label="系统提示词 (追加)" />
          <TextArea
            size="small"
            rows={3}
            value={sc.systemPrompt ?? ''}
            onChange={(e) => updateSessionConfig({ systemPrompt: e.target.value || undefined })}
            placeholder="自定义系统指令"
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />

          <FieldLabel label="工具白名单" />
          <Select
            mode="tags"
            size="small"
            style={{ width: '100%' }}
            value={sc.allowedTools ?? []}
            onChange={(v) => updateSessionConfig({ allowedTools: v.length > 0 ? v : undefined })}
            placeholder="留空=全部工具"
            tokenSeparators={[',']}
          />

          <FieldLabel label="允许的 Skills（留空=全部）" />
          <Select
            mode="tags"
            size="small"
            style={{ width: '100%' }}
            value={sc.allowedSkills ?? []}
            onChange={(v) => updateSessionConfig({ allowedSkills: v.length > 0 ? v : undefined })}
            placeholder="留空=全部"
            tokenSeparators={[',']}
          />

          <FieldLabel label="允许的 MCP 服务器（留空=全部）" />
          <McpServerIdsSelect
            value={sc.allowedMcpServerIds ?? []}
            onChange={(v) => updateSessionConfig({ allowedMcpServerIds: v.length > 0 ? v : undefined })}
          />

          <FieldLabel label="工具组" />
          <ToolGroupSelector
            value={sc.toolGroups}
            onChange={(v) => updateSessionConfig({ toolGroups: v })}
          />

          <FieldLabel label="最大工具调用轮次" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={1}
            max={100}
            value={sc.maxTurns}
            onChange={(v) => updateSessionConfig({ maxTurns: v ?? undefined })}
            placeholder="默认不限"
          />

          <FieldLabel label="权限模式" />
          <Select
            size="small"
            style={{ width: '100%' }}
            value={sc.permissionMode}
            onChange={(v) => updateSessionConfig({ permissionMode: v || undefined })}
            allowClear
            placeholder="默认"
            options={[
              { value: 'default', label: '默认 (default)' },
              { value: 'acceptEdits', label: '自动接受编辑 (acceptEdits)' },
              { value: 'bypassPermissions', label: '跳过所有审批 (bypass)' },
              { value: 'plan', label: '仅规划 (plan)' },
              { value: 'dontAsk', label: '拒绝所有审批 (dontAsk)' }
            ]}
          />

          <Divider style={{ margin: '8px 0' }} />

          <FieldLabel label="期望输出格式" />
          <Input
            size="small"
            value={sc.expectedOutputFormat ?? ''}
            onChange={(e) => updateSessionConfig({ expectedOutputFormat: e.target.value || undefined })}
            placeholder="如 JSON、纯文本、Markdown"
          />

          <FieldLabel label="输出 Schema (JSON)" />
          <TextArea
            size="small"
            rows={3}
            value={sc.outputSchema ? JSON.stringify(sc.outputSchema, null, 2) : ''}
            onChange={(e) => {
              if (!e.target.value) {
                updateSessionConfig({ outputSchema: undefined })
                return
              }
              try {
                updateSessionConfig({ outputSchema: JSON.parse(e.target.value) })
              } catch { /* ignore invalid JSON while typing */ }
            }}
            placeholder='{"type":"object","properties":{...}}'
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />

          <FieldLabel label="Schema 重试次数" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={0}
            max={5}
            value={sc.maxSchemaRetries}
            onChange={(v) => updateSessionConfig({ maxSchemaRetries: v ?? undefined })}
            placeholder="默认 2"
          />
        </div>
      )
    })

    // ─── Memory Config ───
    collapseItems.push({
      key: 'memory',
      label: <CollapseLabel icon={<Database size={12} />} text="记忆配置" />,
      children: (
        <div className="wfe-props__form">
          <Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>记忆抽取策略</Text>
          <SwitchRow
            label="跳过每轮抽取"
            checked={sc.memoryPolicy?.skipPerRoundExtract ?? true}
            onChange={(v) => updateSessionConfig({
              memoryPolicy: { ...(sc.memoryPolicy ?? {}), skipPerRoundExtract: v }
            })}
          />
          <SwitchRow
            label="跳过叙述性批量抽取"
            checked={sc.memoryPolicy?.skipNarrativeBatchExtract ?? true}
            onChange={(v) => updateSessionConfig({
              memoryPolicy: { ...(sc.memoryPolicy ?? {}), skipNarrativeBatchExtract: v }
            })}
          />
          <SwitchRow
            label="跳过文档记忆抽取"
            checked={sc.memoryPolicy?.skipDocumentExtract ?? false}
            onChange={(v) => updateSessionConfig({
              memoryPolicy: { ...(sc.memoryPolicy ?? {}), skipDocumentExtract: v }
            })}
          />
          <SwitchRow
            label="跳过对话摘要生成"
            checked={sc.memoryPolicy?.skipConversationSummary ?? true}
            onChange={(v) => updateSessionConfig({
              memoryPolicy: { ...(sc.memoryPolicy ?? {}), skipConversationSummary: v }
            })}
          />

          <Divider style={{ margin: '8px 0' }} />
          <Text type="secondary" style={{ fontSize: 11, marginBottom: 4 }}>记忆注入策略</Text>
          <SwitchRow
            label="注入 User Profile"
            checked={sc.memoryInjectPolicy?.injectProfile ?? true}
            onChange={(v) => updateSessionConfig({
              memoryInjectPolicy: { ...(sc.memoryInjectPolicy ?? {}), injectProfile: v }
            })}
          />
          <FieldLabel label="最大注入条数" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={0}
            max={50}
            value={sc.memoryInjectPolicy?.maxInjectCount}
            onChange={(v) => updateSessionConfig({
              memoryInjectPolicy: { ...(sc.memoryInjectPolicy ?? {}), maxInjectCount: v ?? undefined }
            })}
            placeholder="默认使用全局配置"
          />
        </div>
      )
    })
  }

  // ─── Retry Config (Agent only) ───
  if (data.stepType === 'agent') {
    collapseItems.push({
      key: 'retry',
      label: <CollapseLabel icon={<RotateCcw size={12} />} text="重试配置" />,
      children: (
        <div className="wfe-props__form">
          <FieldLabel label="最大重试次数" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={0}
            max={10}
            value={rc.maxRetries ?? 0}
            onChange={(v) => updateRetryConfig({ maxRetries: v ?? 0 })}
          />

          <FieldLabel label="重试间隔 (ms)" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={0}
            step={1000}
            value={rc.retryDelayMs}
            onChange={(v) => updateRetryConfig({ retryDelayMs: v ?? undefined })}
            placeholder="0"
          />

          <FieldLabel label="重试条件" />
          <Checkbox.Group
            value={rc.retryOn ?? ['failed', 'timeout']}
            onChange={(v) => updateRetryConfig({ retryOn: v as ('failed' | 'timeout')[] })}
            options={[
              { label: '失败 (failed)', value: 'failed' },
              { label: '超时 (timeout)', value: 'timeout' }
            ]}
          />
        </div>
      )
    })
  }

  // ─── Linked Actions ───
  collapseItems.push({
    key: 'linked',
    label: <CollapseLabel icon={<Zap size={12} />} text="联动操作" />,
    children: (
      <LinkedActionsEditor
        actions={data.linkedActions ?? []}
        onChange={(actions) => update({ linkedActions: actions.length > 0 ? actions : undefined })}
      />
    )
  })

  return (
    <div className="wfe-props__form">
      <div className="wfe-props__type-badge">
        {typeIcon}
        <Tag color={typeColor}>{typeLabel}</Tag>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>ID: {nodeId}</Text>
      </div>

      <Collapse
        size="small"
        ghost
        defaultActiveKey={['basic', 'dataflow']}
        items={collapseItems}
        className="wfe-props__collapse"
      />
    </div>
  )
}

// ─── Global Properties ───

function GlobalProperties() {
  const workflowName = useWorkflowEditorStore((s) => s.workflowName)
  const workflowDescription = useWorkflowEditorStore((s) => s.workflowDescription)
  const workflowArgs = useWorkflowEditorStore((s) => s.workflowArgs)
  const workflowTriggers = useWorkflowEditorStore((s) => s.workflowTriggers)
  const workflowConfig = useWorkflowEditorStore((s) => s.workflowConfig)
  const setWorkflowMeta = useWorkflowEditorStore((s) => s.setWorkflowMeta)
  const nodes = useWorkflowEditorStore((s) => s.nodes)
  const edges = useWorkflowEditorStore((s) => s.edges)

  const cfg = workflowConfig ?? {}

  const updateConfig = useCallback((patch: Partial<WorkflowDefConfig>) => {
    setWorkflowMeta({ config: { ...cfg, ...patch } })
  }, [cfg, setWorkflowMeta])

  const collapseItems = [
    {
      key: 'meta',
      label: <CollapseLabel icon={<Settings2 size={12} />} text="基本信息" />,
      children: (
        <div className="wfe-props__form">
          <FieldLabel label="工作流名称" required />
          <Input
            size="small"
            value={workflowName}
            onChange={(e) => setWorkflowMeta({ name: e.target.value })}
            placeholder="my_workflow"
          />

          <FieldLabel label="描述" />
          <TextArea
            size="small"
            rows={2}
            value={workflowDescription}
            onChange={(e) => setWorkflowMeta({ description: e.target.value })}
            placeholder="工作流描述"
          />

          <FieldLabel label="版本号" />
          <Input
            size="small"
            value={cfg.version ?? ''}
            onChange={(e) => updateConfig({ version: e.target.value || undefined })}
            placeholder="如 1.0.0"
          />

          <FieldLabel label="标签" />
          <Select
            mode="tags"
            size="small"
            style={{ width: '100%' }}
            value={cfg.tags ?? []}
            onChange={(v) => updateConfig({ tags: v.length > 0 ? v : undefined })}
            placeholder="输入标签并回车"
            tokenSeparators={[',']}
          />
        </div>
      )
    },
    {
      key: 'args',
      label: <CollapseLabel icon={<Lightbulb size={12} />} text="参数 (args)" />,
      children: (
        <>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
            有默认值的参数在运行时可留空，将使用此处默认值；不填默认值即为必填。
          </Text>
          <ArgsEditor
            args={workflowArgs}
            onChange={(args) => setWorkflowMeta({ args })}
          />
        </>
      )
    },
    {
      key: 'triggers',
      label: <CollapseLabel icon={<Zap size={12} />} text="触发器" />,
      children: (
        <TriggersEditor
          triggers={workflowTriggers}
          onChange={(triggers) => setWorkflowMeta({ triggers })}
        />
      )
    },
    {
      key: 'runConfig',
      label: <CollapseLabel icon={<Settings2 size={12} />} text="运行配置" />,
      children: (
        <div className="wfe-props__form">
          <FieldLabel label="总超时 (ms)" />
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            min={0}
            step={60000}
            value={cfg.maxTotalTimeoutMs}
            onChange={(v) => updateConfig({ maxTotalTimeoutMs: v ?? undefined })}
            placeholder="默认无限制"
          />

          <FieldLabel label="错误策略" />
          <Select
            size="small"
            style={{ width: '100%' }}
            value={cfg.errorStrategy ?? 'fail_fast'}
            onChange={(v) => updateConfig({ errorStrategy: v })}
            options={[
              { value: 'fail_fast', label: '立即停止 (fail_fast)' },
              { value: 'continue', label: '跳过失败继续 (continue)' }
            ]}
          />

          <Divider style={{ margin: '8px 0' }} />

          <FieldLabel label="工作空间模式" />
          <Select
            size="small"
            style={{ width: '100%' }}
            value={cfg.workspaceMode ?? 'dual'}
            onChange={(v) => updateConfig({ workspaceMode: v as WorkflowWorkspaceMode })}
            options={[
              { value: 'dual', label: '双层 — 持久 + Run 独立空间' },
              { value: 'shared', label: '共享 — 所有 Run 共用一个空间' },
              { value: 'isolated', label: '隔离 — 每次 Run 全新独立空间' }
            ]}
          />

          <Divider style={{ margin: '8px 0' }} />

          <SwitchRow
            label="完成时发送通知"
            checked={cfg.notifyOnComplete ?? false}
            onChange={(v) => updateConfig({ notifyOnComplete: v })}
          />
          <SwitchRow
            label="失败时发送通知"
            checked={cfg.notifyOnFail ?? false}
            onChange={(v) => updateConfig({ notifyOnFail: v })}
          />
        </div>
      )
    }
  ]

  return (
    <div className="wfe-props__form">
      <Collapse
        size="small"
        ghost
        defaultActiveKey={['meta', 'runConfig']}
        items={collapseItems}
        className="wfe-props__collapse"
      />

      <Divider style={{ margin: '8px 0' }} />
      <div className="wfe-props__stats">
        <Text type="secondary" style={{ fontSize: 11 }}>
          {nodes.length} 个步骤 · {edges.length} 条连接
        </Text>
      </div>
    </div>
  )
}

// ─── Args Editor ───

function ArgsEditor({
  args,
  onChange
}: {
  args: Record<string, { default?: unknown; description?: string; type?: string }> | undefined
  onChange: (args: Record<string, { default?: unknown; description?: string; type?: string }> | undefined) => void
}) {
  const entries = useMemo(() => Object.entries(args ?? {}), [args])

  const updateEntry = useCallback((
    oldKey: string,
    newKey: string,
    value: { default?: unknown; description?: string; type?: string }
  ) => {
    const next = { ...(args ?? {}) }
    if (newKey !== oldKey) delete next[oldKey]
    next[newKey] = value
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }, [args, onChange])

  const removeEntry = useCallback((key: string) => {
    const next = { ...(args ?? {}) }
    delete next[key]
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }, [args, onChange])

  const addEntry = useCallback(() => {
    const next = { ...(args ?? {}) }
    let name = 'param_1'
    let i = 1
    while (next[name]) { i++; name = `param_${i}` }
    next[name] = { description: '' }
    onChange(next)
  }, [args, onChange])

  return (
    <div className="wfe-props__form">
      {entries.map(([key, val]) => (
        <div key={key} className="wfe-props__kv-group">
          <div className="wfe-props__kv-row">
            <Input
              size="small"
              style={{ flex: 1 }}
              defaultValue={key}
              placeholder="参数名"
              onBlur={(e) => {
                const newKey = e.target.value.trim().replace(/\s+/g, '_')
                if (newKey && newKey !== key) updateEntry(key, newKey, val)
              }}
            />
            <ActionIcon icon={Trash2} size={14} onClick={() => removeEntry(key)} title="删除参数" />
          </div>
          <Input
            size="small"
            value={String(val.default ?? '')}
            onChange={(e) => updateEntry(key, key, { ...val, default: e.target.value || undefined })}
            placeholder="默认值（不填即必填；填了即可选，不填时用此值）"
            addonBefore="默认"
          />
          <Input
            size="small"
            value={val.description ?? ''}
            onChange={(e) => updateEntry(key, key, { ...val, description: e.target.value || undefined })}
            placeholder="参数说明"
            addonBefore="说明"
          />
        </div>
      ))}
      <button type="button" className="wfe-props__add-trigger" onClick={addEntry}>
        <Plus size={12} /> 添加参数
      </button>
    </div>
  )
}

// ─── Triggers Editor (with filter support) ───

const TRIGGER_TYPES = [
  { value: 'cron', label: 'Cron 定时' },
  { value: 'schedule_remind', label: '日程提醒' },
  { value: 'todo_completed', label: 'Todo 完成' },
  { value: 'document_saved', label: '文档保存' }
]

const TRIGGER_FILTER_HINTS: Record<string, string> = {
  cron: 'expression: 0 9 * * 1',
  schedule_remind: 'tag: meeting',
  todo_completed: 'listName: 项目任务',
  document_saved: 'path: reports/'
}

function TriggersEditor({
  triggers,
  onChange
}: {
  triggers: WorkflowTriggerDef[]
  onChange: (triggers: WorkflowTriggerDef[]) => void
}) {
  const updateTrigger = useCallback((idx: number, patch: Partial<WorkflowTriggerDef>) => {
    const next = [...triggers]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }, [triggers, onChange])

  const removeTrigger = useCallback((idx: number) => {
    onChange(triggers.filter((_, i) => i !== idx))
  }, [triggers, onChange])

  const addTrigger = useCallback(() => {
    onChange([...triggers, { type: 'cron' }])
  }, [triggers, onChange])

  const updateFilter = useCallback((idx: number, key: string, value: string, oldKey?: string) => {
    const t = triggers[idx]
    const filter = { ...(t.filter ?? {}) }
    if (oldKey && oldKey !== key) delete filter[oldKey]
    if (value) {
      filter[key] = value
    }
    const next = [...triggers]
    next[idx] = { ...t, filter: Object.keys(filter).length > 0 ? filter : undefined }
    onChange(next)
  }, [triggers, onChange])

  const removeFilterKey = useCallback((idx: number, key: string) => {
    const t = triggers[idx]
    const filter = { ...(t.filter ?? {}) }
    delete filter[key]
    const next = [...triggers]
    next[idx] = { ...t, filter: Object.keys(filter).length > 0 ? filter : undefined }
    onChange(next)
  }, [triggers, onChange])

  const addFilterKey = useCallback((idx: number) => {
    const t = triggers[idx]
    const filter = { ...(t.filter ?? {}) }
    let name = 'key'
    let i = 1
    while (filter[name]) { i++; name = `key_${i}` }
    filter[name] = ''
    const next = [...triggers]
    next[idx] = { ...t, filter }
    onChange(next)
  }, [triggers, onChange])

  return (
    <div className="wfe-props__form">
      {triggers.map((t, i) => (
        <div key={i} className="wfe-props__kv-group">
          <div className="wfe-props__kv-row">
            <Select
              size="small"
              style={{ flex: 1 }}
              value={t.type}
              options={TRIGGER_TYPES}
              onChange={(v) => updateTrigger(i, { type: v })}
            />
            <ActionIcon icon={Trash2} size={14} onClick={() => removeTrigger(i)} title="删除触发器" />
          </div>

          {t.filter && Object.entries(t.filter).map(([fk, fv]) => (
            <div key={fk} className="wfe-props__kv-row" style={{ paddingLeft: 8 }}>
              <Input
                size="small"
                style={{ width: 80 }}
                defaultValue={fk}
                onBlur={(e) => {
                  const newKey = e.target.value.trim()
                  if (newKey && newKey !== fk) updateFilter(i, newKey, fv, fk)
                }}
                placeholder="key"
              />
              <Input
                size="small"
                style={{ flex: 1 }}
                value={fv}
                onChange={(e) => updateFilter(i, fk, e.target.value)}
                placeholder="value"
              />
              <ActionIcon icon={X} size={12} onClick={() => removeFilterKey(i, fk)} title="删除" />
            </div>
          ))}

          <button
            type="button"
            className="wfe-props__add-trigger"
            style={{ fontSize: 11, paddingLeft: 8 }}
            onClick={() => addFilterKey(i)}
          >
            <Plus size={10} /> 添加过滤条件
          </button>
          {!t.filter && (
            <Text type="secondary" style={{ fontSize: 10, paddingLeft: 8 }}>
              提示: {TRIGGER_FILTER_HINTS[t.type] ?? '添加 key=value 过滤条件'}
            </Text>
          )}
        </div>
      ))}
      <button type="button" className="wfe-props__add-trigger" onClick={addTrigger}>
        <Plus size={12} /> 添加触发器
      </button>
    </div>
  )
}

// ─── Linked Actions Editor ───

const LINKED_ACTION_TYPES: { value: WorkflowLinkedAction['type']; label: string }[] = [
  { value: 'create_todo', label: '创建待办' },
  { value: 'update_todo', label: '更新待办' },
  { value: 'create_document', label: '创建文档' },
  { value: 'update_schedule', label: '更新日程' },
  { value: 'notify', label: '发送通知' }
]

const LINKED_ACTION_PARAM_HINTS: Record<string, string> = {
  create_todo: 'title, listName, content',
  update_todo: 'todoId, completed',
  create_document: 'title, content',
  update_schedule: 'scheduleId, status',
  notify: 'title, body'
}

function LinkedActionsEditor({
  actions,
  onChange
}: {
  actions: WorkflowLinkedAction[]
  onChange: (actions: WorkflowLinkedAction[]) => void
}) {
  const updateAction = useCallback((idx: number, patch: Partial<WorkflowLinkedAction>) => {
    const next = [...actions]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }, [actions, onChange])

  const removeAction = useCallback((idx: number) => {
    onChange(actions.filter((_, i) => i !== idx))
  }, [actions, onChange])

  const addAction = useCallback(() => {
    onChange([...actions, { type: 'notify', params: { title: '$prev.output' } }])
  }, [actions, onChange])

  const updateParam = useCallback((idx: number, key: string, value: string, oldKey?: string) => {
    const a = actions[idx]
    const params = { ...a.params }
    if (oldKey && oldKey !== key) delete params[oldKey]
    params[key] = value
    const next = [...actions]
    next[idx] = { ...a, params }
    onChange(next)
  }, [actions, onChange])

  const removeParam = useCallback((idx: number, key: string) => {
    const a = actions[idx]
    const params = { ...a.params }
    delete params[key]
    const next = [...actions]
    next[idx] = { ...a, params }
    onChange(next)
  }, [actions, onChange])

  const addParam = useCallback((idx: number) => {
    const a = actions[idx]
    const params = { ...a.params }
    let name = 'key'
    let i = 1
    while (params[name]) { i++; name = `key_${i}` }
    params[name] = ''
    const next = [...actions]
    next[idx] = { ...a, params }
    onChange(next)
  }, [actions, onChange])

  return (
    <div className="wfe-props__form">
      {actions.map((a, i) => (
        <div key={i} className="wfe-props__kv-group">
          <div className="wfe-props__kv-row">
            <Select
              size="small"
              style={{ flex: 1 }}
              value={a.type}
              options={LINKED_ACTION_TYPES}
              onChange={(v) => updateAction(i, { type: v })}
            />
            <ActionIcon icon={Trash2} size={14} onClick={() => removeAction(i)} title="删除联动" />
          </div>

          {Object.entries(a.params).map(([pk, pv]) => (
            <div key={pk} className="wfe-props__kv-row" style={{ paddingLeft: 8 }}>
              <Input
                size="small"
                style={{ width: 80 }}
                defaultValue={pk}
                onBlur={(e) => {
                  const newKey = e.target.value.trim()
                  if (newKey && newKey !== pk) updateParam(i, newKey, pv, pk)
                }}
                placeholder="key"
              />
              <Input
                size="small"
                value={pv}
                onChange={(e) => updateParam(i, pk, e.target.value)}
                placeholder="$prev.output"
                style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
              />
              <ActionIcon icon={X} size={12} onClick={() => removeParam(i, pk)} title="删除" />
            </div>
          ))}

          <button
            type="button"
            className="wfe-props__add-trigger"
            style={{ fontSize: 11, paddingLeft: 8 }}
            onClick={() => addParam(i)}
          >
            <Plus size={10} /> 添加参数
          </button>
          <Text type="secondary" style={{ fontSize: 10, paddingLeft: 8 }}>
            可用参数: {LINKED_ACTION_PARAM_HINTS[a.type] ?? ''}
          </Text>
        </div>
      ))}
      <button type="button" className="wfe-props__add-trigger" onClick={addAction}>
        <Plus size={12} /> 添加联动操作
      </button>
    </div>
  )
}

// ─── MCP Server IDs Select (workflow sessionConfig) ───

function McpServerIdsSelect({
  value,
  onChange
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient() ?? null
  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!http) {
      setServers([])
      return
    }
    http
      .listMcpServers()
      .then((list) => setServers(list.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => setServers([]))
  }, [http])

  if (servers.length === 0) {
    return (
      <Select
        mode="tags"
        size="small"
        style={{ width: '100%' }}
        value={value}
        onChange={(v) => onChange(v)}
        placeholder="输入 MCP 服务器 ID，留空=全部"
        tokenSeparators={[',']}
      />
    )
  }
  return (
    <Select
      mode="multiple"
      size="small"
      style={{ width: '100%' }}
      value={value}
      onChange={(v) => onChange(v)}
      placeholder="留空=全部"
      options={servers.map((s) => ({ label: s.name, value: s.id }))}
      maxTagCount="responsive"
    />
  )
}

// ─── Tool Group Selector ───

const TOOL_GROUPS = [
  { id: 'workspace', label: '工作空间', description: '文件读写操作' },
  { id: 'document', label: '文档管理', description: '文档 CRUD' },
  { id: 'todo', label: '待办事项', description: 'Todo 增删改查' },
  { id: 'terminal', label: '终端命令', description: '执行 Shell 命令' },
  { id: 'knowledge', label: '知识检索', description: '记忆/搜索工具' },
  { id: 'search', label: '网络搜索', description: 'Web 搜索' },
  { id: 'schedule', label: '日程管理', description: '日程 CRUD' },
  { id: 'mcp', label: 'MCP 工具', description: '外部 MCP 服务器' }
]

function ToolGroupSelector({
  value,
  onChange
}: {
  value?: Record<string, boolean>
  onChange: (v: Record<string, boolean> | undefined) => void
}) {
  const current = value ?? {}

  return (
    <div className="wfe-props__form" style={{ gap: 2 }}>
      {TOOL_GROUPS.map((g) => (
        <div key={g.id} className="wfe-props__switch-row" title={g.description}>
          <span className="wfe-props__switch-label" style={{ fontSize: 12 }}>
            {g.label}
            <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>{g.description}</Text>
          </span>
          <Switch
            size="small"
            checked={current[g.id] ?? true}
            onChange={(checked) => {
              const next = { ...current, [g.id]: checked }
              const allTrue = Object.values(next).every(Boolean)
              onChange(allTrue ? undefined : next)
            }}
          />
        </div>
      ))}
    </div>
  )
}

// ─── Step ID Input (commits on blur/enter) ───

function StepIdInput({ nodeId, label, renameStep }: { nodeId: string; label: string; renameStep: (oldId: string, newId: string) => void }) {
  const [draft, setDraft] = useState(label)

  const commit = useCallback(() => {
    const trimmed = draft.trim().replace(/\s+/g, '_')
    if (trimmed && trimmed !== nodeId) {
      renameStep(nodeId, trimmed)
    } else {
      setDraft(nodeId)
    }
  }, [draft, nodeId, renameStep])

  useEffect(() => { setDraft(label) }, [label])

  return (
    <Input
      size="small"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPressEnter={commit}
      placeholder="step_id"
    />
  )
}

// ─── Shared Components ───

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <div className="wfe-props__label">
      {label}
      {required && <span style={{ color: 'var(--ant-color-error)', marginLeft: 2 }}>*</span>}
    </div>
  )
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="wfe-props__switch-row">
      <span className="wfe-props__switch-label">{label}</span>
      <Switch size="small" checked={checked} onChange={onChange} />
    </div>
  )
}

function CollapseLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="wfe-props__collapse-label">
      {icon}
      {text}
    </span>
  )
}
