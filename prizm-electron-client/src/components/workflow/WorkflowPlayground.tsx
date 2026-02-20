/**
 * WorkflowPlayground — 工作流 & 任务管理主面板
 *
 * 4 Tab: 任务 / 工作流运行 / 定义管理 / 执行
 * 嵌入 DevToolsPage 使用。
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Segmented,
  Statistic,
  Row,
  Col,
  Empty,
  Button,
  Space,
  Modal,
  Typography,
  Popconfirm,
  Descriptions,
  Input as AntInput,
  Select
} from 'antd'
import { Flexbox, Input } from '@lobehub/ui'
import {
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  EditOutlined,
  RobotOutlined
} from '@ant-design/icons'
import type { TaskRun, WorkflowRun, WorkflowDefRecord } from '@prizm/shared'
import { useTaskStore, subscribeTaskEvents } from '../../store/taskStore'
import { useWorkflowStore, subscribeWorkflowEvents } from '../../store/workflowStore'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import { ExecutionCard, ExecutionStatusTag, ExecutionResultView } from '../execution'
import { MiniPipelineView } from './WorkflowPipelineView'
import { WorkflowRunDetail } from './WorkflowRunDetail'
import { WorkflowEditor } from './editor'
import { useToolLLMStore } from '../../store/toolLLMStore'

const { Text, Paragraph } = Typography

type TabKey = 'tasks' | 'runs' | 'defs' | 'exec'
type StatusFilter = '全部' | '运行中' | '已完成' | '失败'

const STATUS_FILTER_MAP: Record<StatusFilter, string | undefined> = {
  全部: undefined,
  运行中: 'running',
  已完成: 'completed',
  失败: 'failed'
}

export function WorkflowPlayground() {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const [activeTab, setActiveTab] = useState<TabKey>('tasks')

  // Bind stores
  const taskBind = useTaskStore((s) => s.bind)
  const wfBind = useWorkflowStore((s) => s.bind)

  useEffect(() => {
    if (!manager || !currentScope) return
    const http = manager.getHttpClient()
    taskBind(http, currentScope)
    wfBind(http, currentScope)
  }, [manager, currentScope, taskBind, wfBind])

  // Subscribe to WS events
  useEffect(() => {
    const unsubTask = subscribeTaskEvents()
    const unsubWf = subscribeWorkflowEvents()
    return () => {
      unsubTask()
      unsubWf()
    }
  }, [])

  // Statistics
  const tasks = useTaskStore((s) => s.tasks)
  const runs = useWorkflowStore((s) => s.runs)
  const defs = useWorkflowStore((s) => s.defs)

  const stats = useMemo(() => {
    const t = { total: tasks.length, running: 0, completed: 0, failed: 0 }
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'pending') t.running++
      else if (task.status === 'completed') t.completed++
      else if (task.status === 'failed') t.failed++
    }
    const w = { total: runs.length, running: 0, completed: 0, failed: 0 }
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'pending') w.running++
      else if (run.status === 'completed') w.completed++
      else if (run.status === 'failed') w.failed++
    }
    return { t, w }
  }, [tasks, runs])

  return (
    <div className="wf-playground">
      {/* Stats */}
      <Row gutter={[12, 8]} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Statistic title="任务总数" value={stats.t.total} />
        </Col>
        <Col span={4}>
          <Statistic
            title="任务运行中"
            value={stats.t.running}
            valueStyle={{ color: 'var(--ant-color-primary)' }}
          />
        </Col>
        <Col span={4}>
          <Statistic title="工作流总数" value={stats.w.total} />
        </Col>
        <Col span={4}>
          <Statistic
            title="工作流运行中"
            value={stats.w.running}
            valueStyle={{ color: 'var(--ant-color-primary)' }}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title="已完成"
            value={stats.t.completed + stats.w.completed}
            valueStyle={{ color: 'var(--ant-color-success)' }}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title="失败"
            value={stats.t.failed + stats.w.failed}
            valueStyle={{ color: 'var(--ant-color-error)' }}
          />
        </Col>
      </Row>

      {/* Tabs */}
      <Segmented
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabKey)}
        options={[
          { label: `任务 (${stats.t.total})`, value: 'tasks' },
          { label: `工作流运行 (${stats.w.total})`, value: 'runs' },
          { label: `定义 (${defs.length})`, value: 'defs' },
          { label: '执行', value: 'exec' }
        ]}
        style={{ marginBottom: 16 }}
      />

      {activeTab === 'tasks' && <TasksPanel />}
      {activeTab === 'runs' && <RunsPanel />}
      {activeTab === 'defs' && <DefsPanel />}
      {activeTab === 'exec' && <ExecPanel />}
    </div>
  )
}

// ─── Tab 1: Tasks ───

function TasksPanel() {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const refreshTasks = useTaskStore((s) => s.refreshTasks)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const runTask = useTaskStore((s) => s.runTask)
  const [filter, setFilter] = useState<StatusFilter>('全部')
  const [resultModal, setResultModal] = useState<TaskRun | null>(null)
  const [quickPrompt, setQuickPrompt] = useState('')
  const [quickLabel, setQuickLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const filtered = useMemo(() => {
    const st = STATUS_FILTER_MAP[filter]
    if (!st) return tasks
    if (st === 'running')
      return tasks.filter((t) => t.status === 'running' || t.status === 'pending')
    return tasks.filter((t) => t.status === st)
  }, [tasks, filter])

  const handleQuickRun = useCallback(async () => {
    if (!quickPrompt.trim()) return
    setSubmitting(true)
    try {
      await runTask({
        prompt: quickPrompt.trim(),
        label: quickLabel.trim() || undefined,
        mode: 'async'
      })
      setQuickPrompt('')
      setQuickLabel('')
    } finally {
      setSubmitting(false)
    }
  }, [quickPrompt, quickLabel, runTask])

  const handleViewResult = useCallback(async (taskId: string) => {
    const store = useTaskStore.getState()
    const detail = await store.getTaskDetail(taskId)
    if (detail) setResultModal(detail)
  }, [])

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as StatusFilter)}
          options={['全部', '运行中', '已完成', '失败']}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refreshTasks()}
        >
          刷新
        </Button>
      </Space>

      {/* Quick execution */}
      <Flexbox horizontal gap={8} align="center" style={{ marginBottom: 12 }}>
        <Input
          placeholder="输入任务 prompt"
          value={quickPrompt}
          onChange={(e) => setQuickPrompt(e.target.value)}
          onPressEnter={() => void handleQuickRun()}
          style={{ flex: 1 }}
        />
        <Input
          placeholder="标签（可选）"
          value={quickLabel}
          onChange={(e) => setQuickLabel(e.target.value)}
          style={{ width: 120 }}
        />
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={submitting}
          disabled={!quickPrompt.trim()}
          onClick={() => void handleQuickRun()}
        >
          执行
        </Button>
      </Flexbox>

      {filtered.length === 0 ? (
        <Empty description="暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        filtered.map((task) => (
          <ExecutionCard
            key={task.id}
            id={task.id}
            label={task.label}
            status={task.status}
            triggerType={task.triggerType}
            parentId={task.parentSessionId}
            durationMs={task.durationMs}
            output={task.output}
            createdAt={task.createdAt}
            onViewResult={handleViewResult}
            onCancel={(id) => void cancelTask(id)}
          />
        ))
      )}

      <Modal
        title="任务结果"
        open={!!resultModal}
        onCancel={() => setResultModal(null)}
        footer={null}
        width={640}
      >
        {resultModal && (
          <div>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="ID">
                <Text copyable style={{ fontSize: 12 }}>
                  {resultModal.id}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <ExecutionStatusTag status={resultModal.status} size="small" />
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {resultModal.durationMs ? `${(resultModal.durationMs / 1000).toFixed(1)}s` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="会话">
                {resultModal.sessionId ? (
                  <Text copyable style={{ fontSize: 12 }}>
                    {resultModal.sessionId}
                  </Text>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
            </Descriptions>
            <ExecutionResultView
              output={resultModal.output}
              structuredData={resultModal.structuredData}
              artifacts={resultModal.artifacts}
              error={resultModal.error}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─── Tab 2: Workflow Runs ───

function RunsPanel() {
  const runs = useWorkflowStore((s) => s.runs)
  const loading = useWorkflowStore((s) => s.loading)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const [filter, setFilter] = useState<StatusFilter>('全部')
  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const { currentScope } = useScope()
  const loadSession = useAgentSessionStore((s) => s.loadSession)

  const handleLoadSession = useCallback(
    (sessionId: string) => {
      if (currentScope) {
        void loadSession(sessionId, currentScope)
      }
    },
    [currentScope, loadSession]
  )

  const filtered = useMemo(() => {
    const st = STATUS_FILTER_MAP[filter]
    if (!st) return runs
    if (st === 'running')
      return runs.filter(
        (r) => r.status === 'running' || r.status === 'pending' || r.status === 'paused'
      )
    return runs.filter((r) => r.status === st)
  }, [runs, filter])

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as StatusFilter)}
          options={['全部', '运行中', '已完成', '失败']}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refreshRuns()}
        >
          刷新
        </Button>
      </Space>

      {filtered.length === 0 ? (
        <Empty description="暂无工作流运行" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        filtered.map((run) => (
          <WorkflowRunCard
            key={run.id}
            run={run}
            onDetail={() => setDetailRunId(run.id)}
            onCancel={() => void cancelRun(run.id)}
          />
        ))
      )}

      <WorkflowRunDetail
        runId={detailRunId}
        open={!!detailRunId}
        onClose={() => setDetailRunId(null)}
        onLoadSession={handleLoadSession}
      />
    </div>
  )
}

function WorkflowRunCard({
  run,
  onDetail,
  onCancel
}: {
  run: WorkflowRun
  onDetail: () => void
  onCancel: () => void
}) {
  const stepIds = Object.keys(run.stepResults)
  const totalDuration = Object.values(run.stepResults).reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0
  )
  const isActive = run.status === 'running' || run.status === 'pending' || run.status === 'paused'

  return (
    <div className="wf-run-item" onClick={onDetail}>
      <div className="wf-run-item__header">
        <Space>
          <Text strong>{run.workflowName}</Text>
          <ExecutionStatusTag status={run.status} size="small" />
        </Space>
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {totalDuration > 0 ? `${(totalDuration / 1000).toFixed(1)}s` : ''}
          </Text>
          {isActive && (
            <Button
              size="small"
              type="link"
              danger
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
            >
              取消
            </Button>
          )}
        </Space>
      </div>
      {stepIds.length > 0 && <MiniPipelineView stepResults={run.stepResults} stepIds={stepIds} />}
      <Text type="secondary" style={{ fontSize: 11 }}>
        {new Date(run.createdAt).toLocaleString()} · {run.id.slice(0, 12)}…
      </Text>
    </div>
  )
}

// ─── Tab 3: Defs ───

function DefsPanel() {
  const defs = useWorkflowStore((s) => s.defs)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const deleteDef = useWorkflowStore((s) => s.deleteDef)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addYaml, setAddYaml] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editorDef, setEditorDef] = useState<WorkflowDefRecord | null>(null)
  const [showNewEditor, setShowNewEditor] = useState(false)

  // AI create/edit via Tool LLM
  const [showAI, setShowAI] = useState(false)
  const [aiIntent, setAiIntent] = useState('')
  const [aiSessionId, setAiSessionId] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const toolLLMStart = useToolLLMStore((s) => s.start)
  const toolLLMRefine = useToolLLMStore((s) => s.refine)
  const toolLLMConfirm = useToolLLMStore((s) => s.confirm)
  const toolLLMCancel = useToolLLMStore((s) => s.cancel)
  const aiSession = useToolLLMStore((s) => aiSessionId ? s.sessions[aiSessionId] : undefined)
  const { manager: _mgr } = usePrizmContext()
  const { currentScope: _scope } = useScope()
  const tlBind = useToolLLMStore((s) => s.bind)

  useEffect(() => {
    if (!_mgr || !_scope) return
    tlBind(_mgr.getHttpClient(), _scope)
  }, [_mgr, _scope, tlBind])

  const handleAIStart = useCallback(async () => {
    if (!aiIntent.trim()) return
    setAiLoading(true)
    try {
      const sid = await toolLLMStart(aiIntent.trim())
      if (sid) setAiSessionId(sid)
    } finally {
      setAiLoading(false)
    }
  }, [aiIntent, toolLLMStart])

  const handleAIConfirm = useCallback(async () => {
    if (!aiSessionId) return
    const ok = await toolLLMConfirm(aiSessionId)
    if (ok) {
      setShowAI(false)
      setAiSessionId(null)
      setAiIntent('')
      void refreshDefs()
    }
  }, [aiSessionId, toolLLMConfirm, refreshDefs])

  const handleAICancel = useCallback(() => {
    if (aiSessionId) toolLLMCancel(aiSessionId)
    setShowAI(false)
    setAiSessionId(null)
    setAiIntent('')
  }, [aiSessionId, toolLLMCancel])

  const handleRegister = useCallback(async () => {
    if (!addName.trim() || !addYaml.trim()) return
    setSubmitting(true)
    try {
      await registerDef(addName.trim(), addYaml.trim(), addDesc.trim() || undefined)
      setShowAdd(false)
      setAddName('')
      setAddDesc('')
      setAddYaml('')
    } finally {
      setSubmitting(false)
    }
  }, [addName, addYaml, addDesc, registerDef])

  const handleEditorSave = useCallback(
    async (name: string, yaml: string, description?: string) => {
      await registerDef(name, yaml, description)
    },
    [registerDef]
  )

  const handleEditorRun = useCallback(
    (name: string) => {
      void runWorkflow({ workflow_name: name })
    },
    [runWorkflow]
  )

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button size="small" type="primary" icon={<RobotOutlined />} onClick={() => setShowAI(true)}>
          AI 创建
        </Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setShowNewEditor(true)}>
          可视化创建
        </Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setShowAdd(true)}>
          YAML 注册
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshDefs()}>
          刷新
        </Button>
      </Space>

      {defs.length === 0 ? (
        <Empty description="暂无工作流定义" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        defs.map((def) => (
          <DefCard
            key={def.id}
            def={def}
            onEdit={() => setEditorDef(def)}
            onDelete={() => void deleteDef(def.id)}
          />
        ))
      )}

      {/* YAML registration modal */}
      <Modal
        title="注册工作流定义"
        open={showAdd}
        onCancel={() => setShowAdd(false)}
        onOk={() => void handleRegister()}
        confirmLoading={submitting}
        okButtonProps={{ disabled: !addName.trim() || !addYaml.trim() }}
      >
        <Flexbox gap={12}>
          <Input placeholder="名称" value={addName} onChange={(e) => setAddName(e.target.value)} />
          <Input
            placeholder="描述（可选）"
            value={addDesc}
            onChange={(e) => setAddDesc(e.target.value)}
          />
          <AntInput.TextArea
            placeholder="YAML 定义"
            rows={10}
            value={addYaml}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAddYaml(e.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
        </Flexbox>
      </Modal>

      {/* Visual editor modal — edit existing */}
      <Modal
        open={!!editorDef}
        onCancel={() => setEditorDef(null)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        {editorDef && (
          <WorkflowEditor
            defRecord={editorDef}
            onSave={handleEditorSave}
            onRun={handleEditorRun}
            onClose={() => setEditorDef(null)}
          />
        )}
      </Modal>

      {/* Visual editor modal — new workflow */}
      <Modal
        open={showNewEditor}
        onCancel={() => setShowNewEditor(false)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        <WorkflowEditor
          onSave={handleEditorSave}
          onRun={handleEditorRun}
          onClose={() => setShowNewEditor(false)}
        />
      </Modal>

      {/* AI create/edit modal */}
      <Modal
        title={<><RobotOutlined /> AI 工作流构建器</>}
        open={showAI}
        onCancel={handleAICancel}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Flexbox gap={12}>
          {!aiSessionId && (
            <>
              <AntInput.TextArea
                placeholder="描述你想创建的工作流，例如：创建一个每日数据处理流程，包含数据获取、清洗和报告生成三个步骤"
                rows={3}
                value={aiIntent}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAiIntent(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) { e.preventDefault(); void handleAIStart() }
                }}
              />
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={() => void handleAIStart()}
                loading={aiLoading}
                disabled={!aiIntent.trim()}
              >
                开始生成
              </Button>
            </>
          )}

          {aiSession && (
            <>
              {aiSession.currentYaml && (
                <div style={{
                  background: 'var(--ant-color-fill-quaternary, #f5f5f5)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  maxHeight: 300,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap'
                }}>
                  {aiSession.currentYaml}
                </div>
              )}

              {aiSession.streamingText && (
                <Paragraph type="secondary" style={{ fontSize: 13 }}>
                  {aiSession.streamingText}
                </Paragraph>
              )}

              {aiSession.error && (
                <Paragraph type="danger">{aiSession.error}</Paragraph>
              )}

              {(aiSession.status === 'preview' || aiSession.status === 'error') && (
                <Space>
                  <Button danger onClick={handleAICancel}>取消</Button>
                  <Button
                    type="primary"
                    onClick={() => void handleAIConfirm()}
                    disabled={!aiSession.currentYaml}
                  >
                    确认注册
                  </Button>
                </Space>
              )}

              {(aiSession.status === 'generating' || aiSession.status === 'refining') && (
                <Paragraph type="secondary">生成中…</Paragraph>
              )}
            </>
          )}
        </Flexbox>
      </Modal>
    </div>
  )
}

function DefCard({
  def,
  onEdit,
  onDelete
}: {
  def: WorkflowDefRecord
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="wf-def-item">
      <div className="wf-def-item__header">
        <div>
          <Text strong>{def.name}</Text>
          {def.description && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {def.description}
            </Text>
          )}
        </div>
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={onEdit}
            title="可视化编辑"
          />
          <Popconfirm title="确定删除此工作流定义？" onConfirm={onDelete}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        ID: {def.id.slice(0, 12)}… · 更新于 {new Date(def.updatedAt).toLocaleString()}
      </Text>
      {def.yamlContent && (
        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{ fontSize: 11, marginTop: 4, marginBottom: 0, fontFamily: 'monospace' }}
        >
          {def.yamlContent}
        </Paragraph>
      )}
    </div>
  )
}

// ─── Tab 4: Exec ───

function ExecPanel() {
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const runTask = useTaskStore((s) => s.runTask)
  const defs = useWorkflowStore((s) => s.defs)
  const [mode, setMode] = useState<'name' | 'yaml'>('name')
  const [wfName, setWfName] = useState('')
  const [wfYaml, setWfYaml] = useState('')
  const [wfArgs, setWfArgs] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const selectedDef = useMemo(() => {
    if (mode !== 'name' || !wfName) return null
    return defs.find((d) => d.name === wfName) ?? null
  }, [mode, wfName, defs])

  const argsHints = useMemo(() => {
    if (!selectedDef?.yamlContent) return null
    const pattern = /\$args\.([a-zA-Z_][a-zA-Z0-9_.]*)/g
    const keys = new Set<string>()
    let match
    while ((match = pattern.exec(selectedDef.yamlContent)) !== null) {
      keys.add(match[1])
    }
    return keys.size > 0 ? Array.from(keys) : null
  }, [selectedDef])

  const handleExecWorkflow = useCallback(async () => {
    setSubmitting(true)
    setLastResult(null)
    try {
      let args: Record<string, unknown> | undefined
      if (wfArgs.trim()) {
        try {
          args = JSON.parse(wfArgs)
        } catch {
          setLastResult('参数 JSON 格式错误')
          return
        }
      }
      const payload =
        mode === 'name' ? { workflow_name: wfName.trim(), args } : { yaml: wfYaml.trim(), args }

      const result = await runWorkflow(payload)
      setLastResult(result ? `工作流已启动 (runId: ${result.runId})` : '启动失败')
    } catch (err) {
      setLastResult(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [mode, wfName, wfYaml, wfArgs, runWorkflow])

  const handleExecTask = useCallback(async () => {
    if (!taskPrompt.trim()) return
    setSubmitting(true)
    setLastResult(null)
    try {
      const result = await runTask({ prompt: taskPrompt.trim(), mode: 'async' })
      setLastResult(result ? `任务已启动 (id: ${result.id})` : '启动失败')
    } catch (err) {
      setLastResult(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [taskPrompt, runTask])

  return (
    <div>
      <Typography.Title level={5}>快速执行工作流</Typography.Title>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => setMode(v as 'name' | 'yaml')}
          options={[
            { label: '按名称', value: 'name' },
            { label: '内联 YAML', value: 'yaml' }
          ]}
        />
      </Space>

      <Flexbox gap={8} style={{ marginBottom: 12 }}>
        {mode === 'name' ? (
          <Select
            showSearch
            placeholder="选择工作流"
            value={wfName || undefined}
            onChange={(v) => setWfName(v)}
            allowClear
            onClear={() => setWfName('')}
            style={{ width: '100%' }}
            notFoundContent={
              <Empty description="暂无已注册工作流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            }
            options={defs.map((d) => ({
              value: d.name,
              label: (
                <Flexbox horizontal gap={8} align="center">
                  <span>{d.name}</span>
                  {d.description && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {d.description}
                    </Text>
                  )}
                </Flexbox>
              )
            }))}
          />
        ) : (
          <AntInput.TextArea
            placeholder="YAML 工作流定义"
            rows={6}
            value={wfYaml}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWfYaml(e.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
        )}
        {argsHints && (
          <div
            style={{
              padding: '6px 10px',
              background: 'var(--ant-color-fill-quaternary)',
              borderRadius: 6,
              fontSize: 12
            }}
          >
            <Text type="secondary">需要的参数: </Text>
            {argsHints.map((key) => (
              <Text key={key} code style={{ marginRight: 6, fontSize: 11 }}>
                {key}
              </Text>
            ))}
          </div>
        )}
        <Input
          placeholder={
            argsHints
              ? `参数 JSON，例: {${argsHints.map((k) => `"${k}": "..."`).join(', ')}}`
              : '参数 JSON（可选），例: {"key": "value"}'
          }
          value={wfArgs}
          onChange={(e) => setWfArgs(e.target.value)}
        />
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={submitting}
          disabled={mode === 'name' ? !wfName.trim() : !wfYaml.trim()}
          onClick={() => void handleExecWorkflow()}
        >
          执行工作流
        </Button>
      </Flexbox>

      <Typography.Title level={5}>快速执行任务</Typography.Title>
      <Flexbox horizontal gap={8} style={{ marginBottom: 12 }}>
        <Input
          placeholder="任务 prompt"
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          onPressEnter={() => void handleExecTask()}
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={submitting}
          disabled={!taskPrompt.trim()}
          onClick={() => void handleExecTask()}
        >
          执行任务
        </Button>
      </Flexbox>

      {lastResult && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 6,
            marginTop: 8
          }}
        >
          <Text style={{ fontSize: 13 }}>{lastResult}</Text>
        </div>
      )}
    </div>
  )
}
